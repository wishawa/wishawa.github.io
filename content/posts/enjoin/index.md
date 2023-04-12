
+++
title = "A syntax-level async join macro supporting branching control flow and shared mutable borrowing"
description = ""
date = 2023-04-09

[extra]
hidden = true

[taxonomies]
categories = ["Tech"]
tags = ["Rust"]
+++

The macro is called *enjoin*. It is [on GitHub here](https://github.com/wishawa/enjoin) and [on crates.io here](https://crates.io/crates/enjoin).

## Existing join implementations

In the Rust async world, concurrency is usually achieved through joining. Joining is not trivial, and there is no built-in support in the language, so we need to rely on libraries.

All the async join implementations out there
(including
[futures'](https://docs.rs/futures/latest/futures/macro.join.html),
[tokio's](https://docs.rs/tokio/latest/tokio/macro.join.html), [nightly stdlib's](https://doc.rust-lang.org/std/future/macro.join.html) and
[futures-concurrency](https://docs.rs/futures-concurrency/latest/futures_concurrency/future/trait.Join.html))
work on top of the *Future* abstraction; if you want to join pieces of async code, you pass them in as async blocks, which get converted to Future objects automatically.

The problem is that **async blocks are not simply blocks of async code**. They behave much more like closures than blocks. Converting regular blocks of async code to async blocks means

* We lose the ability to jump out with branching control flow (`break`/`continue`).
* Error propagation (with `?`) becomes more difficult.
* All our variables' lifetimes get replaced by a single opaque lifetime (of the async block).

## Syntax-level join

The ***enjoin*** library pretends not to operate on *Future*. It takes in regular blocks of code, and, as far as the user is concerned, magically run those blocks concurrently.

Of course the actual implementation is not magic. The macro secretly transform the blocks into async blocks so they can be polled concurrently. What is special is that the transformation does much more than just adding the word `async`...

### Branching statements

To make branching statements (`break '_`, `continue '_`, `?`, `return`) work from inside async blocks, we replace each of them with a statement to return a special enum variant. The polling code can then match the returned enum and perform the branching.

### Shared mutable borrows

We also let async blocks share mutable borrows as long as they don't cross any await yieldpoint. This is done by parsing through all the blocks to find shared borrows, and putting all those in a RefCell. Each joinee block keeps the RefCell locked for itself during its synchronous execution, unlocking and relocking across await yieldpoints. Since joining is concurrent rather than parallel, only one block can be executing synchronously at a time, so the RefCell will never panic (it can almost be an UnsafeCell - more on that in the [limitations](#limitations) section below).

<details>

<summary>Aside: is automatic RefCell-ing horrible design?</summary>

Indiscriminate automatic RefCell-ing would definitely be horrible design, but that is not what we're doing here. What *enjoin* is doing is merely working around the issue that async blocks blend all captured variable lifetimes into one opaque, encompassing lifetime. This workaround is completely internal; *enjoin* could switch to [GhostCell](https://plv.mpi-sws.org/rustbelt/ghostcell/) in [the shiny future](https://rust-lang.github.io/wg-async/vision/submitted_stories/status_quo/barbara_wants_to_use_ghostcell.html) and users won't notice anything (indeed, being GhostCell-compatible is another indication that our use of RefCell is well under control).

You can think of *enjoin*'s borrowing behavior as an extreme, twisted extension to non-lexical lifetimes; lifetime follows execution, not lexical scope; joinee blocks are executed in lockstep, and the borrow lifetimes follow that.

</details>

Since this feature has imperfect implementation (more about that below), it is made optional. Use `enjoin::join_auto_borrow!` if you want it; use `enjoin::join!` if you don't.


## `try_join!`, `race!`, `try_race!`, and `select!`

A nice effect of having branching statements is that *enjoin* does not need to provide racing or fallible variants; such behaviors are already possible with `enjoin::join!`. Here's an example use of *enjoin* for racing futures.

```rust
let res = 'race: {
	enjoin::join!(
		{ break 'race work_1().await },
		{ break 'race work_2().await }
	);
};
```

<details>

<summary>What would fallible join (a.k.a. try join) look like?</summary>

```rust
let res: Result<(_, _), _> = 'join: {
	Ok(enjoin::join!(
		{
			match do_something().await {
				Ok(r) => r,
				Err(e) => break 'join Err(e),
			}
		},
		{
			do_work().await;
			123
		}
	))
};
```

But remember that *enjoin* supports the `?` operator, so in many cases you could simply use `?` inside join and have error propagation without any extra effort.

```rust
async fn fetch_and_save() -> Result<(), Error> {
    enjoin::join!(
        {
            let data = fetch_data_1().await?;
            save_data(data).await?;
        },
        {
            let data = fetch_data_2().await?;
            save_data(data).await?;
        }
    );
}
```

</details>

With the shared mutable borrowing feature enabled, *enjoin* becomes yet more powerful, eclipsing even `futures::select!`. With `select!`, you attach synchronous code to run after each input future, and optionally break out from there. With *enjoin*, you can chain synchronous and asynchronous code freely in each block, and break out at any time.

## Limitations

The *enjoin* macro does a bit more than what macros were meant to do, so there are cases where it fails or falls short.

* If branching statements and/or captured variables are hidden in another macro, *enjoin* wouldn't be able to transform them. This will usually cause compilation failure.

	```rust
	enjoin::join!({ vec![
		// enjoin can't see the code in this vec!
	] });
	```

* If an `await` is hidden inside a macro, `join_auto_borrow!` won't be able to unlock the RefCell for the yieldpoint, leading to a RefCell panic. This limitation means you can't nest `enjoin::join!` within itself, and can't use `tokio::join!` inside `enjoin::join!`.

* With only syntactic information, *enjoin* can only guess whether or not a name is a borrowed variable, and whether or not that borrow is mutable. We have heuristics, but even so the macro may end up RefCell-ing immutable borrows, constants, or function pointers sometimes. You can avoid this by following Rust's naming convention (such as using CamelCase for types) and explicitly writing `(&mut var).method()` or `(&var).method()`.

* If there is an error with code inside the macro, the compiler spits out very confusing error messages. This problem is not really specific to *enjoin*, but it seems to be more severe here. I cope by using Rust Analyzer's "inline macro" action to temporarily expand the macro.

## Sample expansion

This nonsensical piece of code has `break '_`, `return`, `?`, and shared mutable borrowing (of the `done` variable).

```rust
enjoin::join_auto_borrow!(
    {
        let res = do_thing_a().await;
        if res > 3 {
            return Some("hello");
        } else {
            done += 1;
            if done == 2 {
                break 'a;
            }
        }
    },
    {
        let _res = do_thing_b().await?;
        done += 1;
    }
);
```

Be warned the output is a huge wall of code!

<details>
<summary>See what code the macro produces</summary>

```rust
{
    let borrows_cell = ::std::cell::RefCell::new((&mut done,));
    enum OutputEnum<Return, Keep> {
        Keep(Keep),
        Return(Return),
        Break_a(()),
    }
    impl<Return, Keep> OutputEnum<Return, Keep> {
        fn convert_breaking<TargetType>(
            self,
        ) -> ::core::ops::ControlFlow<OutputEnum<Return, TargetType>, Keep> {
            match self {
                Self::Keep(e) => ::core::ops::ControlFlow::Continue(e),
                Self::Return(e) => ::core::ops::ControlFlow::Break(OutputEnum::Return(e)),
                Self::Break_a(_) => ::core::ops::ControlFlow::Break(OutputEnum::Break_a(())),
            }
        }
    }
    let mut pinned_futs = (
        ::core::pin::pin!(async {
          OutputEnum::Keep({
            let mut borrows =  ::std::cell::RefCell::borrow_mut(&borrows_cell);
            let res = ((do_thing_a(),{
              ::core::mem::drop(borrows);
            },).0.await,{
              borrows =  ::std::cell::RefCell::borrow_mut(&borrows_cell);
            }).0;
            if res > 3 {
              return OutputEnum::Return((Some("hello")));
            } else {
              (*borrows.0) += 1;
              if (*borrows.0) == 2 {
                return OutputEnum::Break_a(());
              }
            }
          })
        }),
        ::core::pin::pin!(async {
            OutputEnum::Keep({
                let mut borrows = ::std::cell::RefCell::borrow_mut(&borrows_cell);
                let _res = (match ::enjoin::polyfill::Try::branch(
                    (
                        (do_thing_b(), {
                            ::core::mem::drop(borrows);
                        })
                            .0
                            .await,
                        {
                            borrows = ::std::cell::RefCell::borrow_mut(&borrows_cell);
                        },
                    )
                        .0,
                ) {
                    ::core::ops::ControlFlow::Break(b) => {
                        return OutputEnum::Return(
                            (::enjoin::polyfill::FromResidual::from_residual(b)),
                        )
                    }
                    ::core::ops::ControlFlow::Continue(c) => c,
                });
                (*borrows.0) += 1;
            })
        }),
    );
    let mut num_left = 2usize;
    let mut ouputs = (::core::option::Option::None, ::core::option::Option::None);
    match ::core::future::poll_fn(|poll_cx| {
        if ::core::option::Option::is_none(&ouputs.0) {
            match ::core::future::Future::poll(
                ::core::pin::Pin::as_mut(&mut pinned_futs.0),
                poll_cx,
            ) {
                ::core::task::Poll::Ready(r) => match OutputEnum::convert_breaking(r) {
                    ::core::ops::ControlFlow::Continue(v) => {
                        num_left -= 1;
                        ouputs.0 = ::core::option::Option::Some(v)
                    }
                    ::core::ops::ControlFlow::Break(b) => return ::core::task::Poll::Ready(b),
                },
                ::core::task::Poll::Pending => {}
            }
        }
        if ::core::option::Option::is_none(&ouputs.1) {
            match ::core::future::Future::poll(
                ::core::pin::Pin::as_mut(&mut pinned_futs.1),
                poll_cx,
            ) {
                ::core::task::Poll::Ready(r) => match OutputEnum::convert_breaking(r) {
                    ::core::ops::ControlFlow::Continue(v) => {
                        num_left -= 1;
                        ouputs.1 = ::core::option::Option::Some(v)
                    }
                    ::core::ops::ControlFlow::Break(b) => return ::core::task::Poll::Ready(b),
                },
                ::core::task::Poll::Pending => {}
            }
        }
        if num_left == 0 {
            ::core::task::Poll::Ready(OutputEnum::Keep((
                ::core::option::Option::unwrap(::core::option::Option::take(&mut ouputs.0)),
                ::core::option::Option::unwrap(::core::option::Option::take(&mut ouputs.1)),
            )))
        } else {
            ::core::task::Poll::Pending
        }
    })
    .await
    {
        OutputEnum::Keep(e) => e,
        OutputEnum::Return(e) => return e,
        OutputEnum::Break_a(_) => break 'a,
    }
}
```

</details>

## End

Discuss this post on [Reddit](TODO add link).