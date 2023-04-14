
+++
title = "A syntax-level async join macro supporting branching control flow and synchronous shared mutable borrowing"
description = ""
date = 2023-04-09

[taxonomies]
categories = ["Tech"]
tags = ["Rust"]
+++

The macro is called *enjoin*. It is [on GitHub here](https://github.com/wishawa/enjoin) and [on crates.io here](https://crates.io/crates/enjoin).

## Existing join implementations

All the async join implementations out there
(including
[futures'](https://docs.rs/futures/latest/futures/macro.join.html),
[tokio's](https://docs.rs/tokio/latest/tokio/macro.join.html), [nightly stdlib's](https://doc.rust-lang.org/std/future/macro.join.html) and
[futures-concurrency](https://docs.rs/futures-concurrency/latest/futures_concurrency/future/trait.Join.html))
work on top of the *Future* abstraction; if you want to join pieces of async code, you pass them in as async blocks, which get converted to *Future* objects automatically.

The problem is that **async blocks are not simply blocks of async code**. They behave much more like closures than blocks. Converting regular blocks of async code to async blocks means

* We lose the ability to jump out with branching control flow (`break`/`continue`).
	<details>
	<summary>

	Example code

	</summary>
	{{ code_compile_fail() }}
	
	```rust
	loop {
		futures::join!(
			async {
				if should_break().await {
					// [E0267]: `break` inside of an `async` block
					break;
				}
			},
			async {
				// ...
			}
		);
	}
	```
	</details>
* Error propagation (with `?`) becomes more difficult.
	<details>
	<summary>

	Example code

	</summary>
	
	{{ code_compile_fail() }}

	```rust
	futures::join!(
		async {
			// [E0277]: the `?` operator can only be used in an async block that returns `Result` or `Option`
			do_thing().await?;
		},
		// ...
	);
	```
	</details>
	
* <a id="closure-lifetime-issue"></a>All our variables' lifetimes get replaced by the opaque, encompassing lifetime of the async block. This same inconvenience [frequently](https://stackoverflow.com/questions/49703990/cant-borrow-mutably-within-two-different-closures-in-the-same-scope) [comes](https://stackoverflow.com/questions/64947703/a-variable-modified-by-two-closures) [up](https://users.rust-lang.org/t/is-there-a-nicer-way-to-have-two-closures-have-mutable-access-to-the-same-variable/46311) when working with closures.

## Syntax-level join

Since these annoyances come with futures / async blocks, the first step to fixing them is to have a new API for joining. The *enjoin* library pretends not to operate on *Future* objects. The macro instead takes in regular blocks of code, and, as far as the user is concerned, magically run those blocks concurrently.

Of course the actual implementation is not magic. The macro still secretly transforms the blocks into async blocks so they can be polled concurrently. What is special is that the transformation does much more than just adding the word `async`...

### Branching statements

To make branching statements (`break '_`, `continue '_`, `?`, `return`) work from inside async blocks, we replace each of them with a statement to return a special enum variant. The polling code can then match the returned enum and perform the branching.

### Shared mutable borrows

We also let async blocks share mutable borrows as long as they don't cross any await yieldpoint. This is done by parsing through all the blocks to find shared borrows, and putting all those in a RefCell. Each block being joined keeps the RefCell locked for itself during its synchronous execution, unlocking and relocking across yieldpoints. Since joining is concurrent rather than parallel, only one block can be executing synchronously at a time, so the RefCell will not panic (it can almost be an UnsafeCell - more on that in the [limitations](#limitations) section below).

<details>

<summary>

Is automatic RefCell-ing horrible design?

</summary>

Indiscriminate automatic RefCell-ing is definitely horrible, but that isn't what we're doing here. What *enjoin* is doing is merely working around the issue mentioned <a href="#closure-lifetime-issue">above</a>. This workaround is completely internal; *enjoin* could [switch to GhostCell in the future](https://rust-lang.github.io/wg-async/vision/submitted_stories/status_quo/barbara_wants_to_use_ghostcell.html) and users won't notice anything (in fact, being compatible with GhostCell is another indication that our use of RefCell is well under control).

From a user's perspective, think of *enjoin*'s borrowing behavior as an extremely twisted extension to non-lexical lifetimes; lifetime follows execution, not lexical scope; joinee blocks are executed in lockstep, so the borrow lifetimes follow that.

</details>

Since this feature has imperfect implementation (more about that [below](#limitations)), it is made optional. Use `enjoin::join_auto_borrow!` if you want it; use `enjoin::join!` if you don't.


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

<summary>

What would fallible join (`try_join`) look like?

</summary>

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

With the shared mutable borrowing feature enabled, *enjoin* becomes yet more powerful, eclipsing even `futures::select!`. With `select!`, you attach synchronous code to run after each input future, and optionally break out from there. With `join_auto_borrow!`, you can chain synchronous and asynchronous code freely in each block, and break out at any time.

## Limitations

The *enjoin* macro does a bit more than what macros were meant to do, so there are cases where it fails or falls short.

* If branching statements and/or captured variables are hidden in another macro, *enjoin* wouldn't be able to transform them. This will usually cause compilation failure.

* If an `await` is hidden inside a macro, `join_auto_borrow!` won't be able to unlock the RefCell for the yieldpoint, leading to a RefCell panic.

* With only syntactic information, *enjoin* can only guess whether or not a name is a borrowed variable, and whether or not that borrow is mutable. We have heuristics, but even so the macro may end up RefCell-ing immutable borrows, constants, or function pointers.

## End

Discuss this post on [Reddit](TODO add link).

See *enjoin* on [GitHub](https://github.com/wishawa/enjoin), [crates.io](https://crates.io/crates/enjoin), and [docs.rs](https://docs.rs/enjoin).