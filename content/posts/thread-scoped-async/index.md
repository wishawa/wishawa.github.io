+++
title = "Scoped threads in Rust, and why its async version would be unsound"
date = 2022-11-01

[extra]
hidden = true

[taxonomies]
categories = ["Tech"]
tags = ["Async UI", "Rust"]
+++

Disclaimer: this post contains a lot of oversimplification

## Fearless concurrency with scoped threads
No standard library API demonstrate Rust's "Fearless Concurrency" motto better than `std::thread::scope`.

Take a look at the example code from [the documentation](https://doc.rust-lang.org/nightly/std/thread/fn.scope.html).
```rust
let mut a = vec![1, 2, 3];
let mut x = 0;

thread::scope(|s| {
    s.spawn(|| {
        println!("hello from the first scoped thread");
        // We can borrow `a` here.
        dbg!(&a);
    });
    s.spawn(|| {
        println!("hello from the second scoped thread");
        // We can even mutably borrow `x` here,
        // because no other threads are using it.
        x += a[0] + a[2];
    });
    println!("hello from the main thread");
});

// After the scope, we can modify and access our variables again:
a.push(4);
```

We're spawning two scoped threads that *borrow and modify the main thread's data*.

In other languages, borrowing and mutating between threads requires great care, and produces memory races if done even subtly wrong. You don't have to worry about such issues in Rust; the Rust compiler prevents all memory race for you.

Scoped threads was introduced in 2015. Unfortunately, that first version [was unsound](https://github.com/rust-lang/rust/issues/24292) and had to be removed before Rust reached 1.0. Recently, the API was redesigned and had since been added to the standard library of Rust 1.63 (released August 2022) onward.

Let's examine how it works...

## Controlling threads' lifetimes
Borrows in Rust have lifetimes. `thread::scope` allows your threads to borrow data... for the lifetime of `'life`.

In the example code shown earlier, `'life` would be a segment in the code. Like this

```rust
let mut a = vec![1, 2, 3];
let mut x = 0;

// ------------------+
//                   |
//   this is 'life   |
//                   |
// ------------------+

a.push(4);
```

To create threads, you create closures with lifetime not smaller than `'life`. Rust usual lifetime rules apply here: within `'life`, your closures can't borrow things that someone else is mutating or mutate things that someone else is borrowing.

The job of `thread::scope` is to spawn your closures into threads. The closures are only guaranteed to be valid within `'life`, so these threads **must start and end within `'life`**.

```rust
let mut a = vec![1, 2, 3];
let mut x = 0;

let my_closure_1 = || { /* ... */ };
let my_closure_2 = || { /* ... */ };

// -------------------------------------+
//    -- spawn the closures here! --    |
//                                      |
//            this is 'life             |
//                                      |
//   -- make sure they end by here --   |
// -------------------------------------+

a.push(4);
```

The start part is easy enough: just spawn the closures! The end part is much harder: `thread::scope` needs to ensure that the we don't progress beyond `'life` before all the threads have finished.

To accomplish this, `thread::scope` gives you a [`Scope`](https://doc.rust-lang.org/stable/std/thread/struct.Scope.html) object called `s`. To spawn each closure, you do `s.spawn(closure)`. This spawns the closure into a thread, and *records the existence of that thread within `s`*.

Once all the threads have been spawned, `thread::scope` will go into [an infinite loop](https://doc.rust-lang.org/1.64.0/src/std/thread/scoped.rs.html#149). It will only break from this loop once all the threads spawned by `s` have completed.

At this point we know that all the closures have been dropped. The work of `thread::scope` is done. It returns. We exit the lifetime `'life`.

Overall, expanding `thread::scope` would give something like this

```rust
let mut a = vec![1, 2, 3];
let mut x = 0;

let my_closure_1 = || { /* ... */ };
let my_closure_2 = || { /* ... */ };

//           start of 'life
// --------------------------------------
s.spawn(my_closure_1);
s.spawn(my_closure_2);

while s.num_remaining_threads() > 0 {}
// --------------------------------------
//            end of 'life

a.push(4);
```

## Async version of scoped threads

### What's a future?
A [future](https://doc.rust-lang.org/std/future/trait.Future.html) is like a pausable closure. It gets *polled*, driving it to run some code. It then *pauses* to wait for something to happen. When that thing happens, the future gets polled again and run more code...

### What's a task?
Tasks are the async equivalent of threads. They are futures that have been placed under control of the *executor*. The executor will schedule and execute tasks, similar to how the OS schedule and execute threads.

### Imagining scoped tasks

An async version of `thread::scope` would probably look something like this
```rust
let mut a = vec![1, 2, 3];
let mut x = 0;

scoped_tasks(|s| {
    // spawn a task for the executor to run
    s.spawn(async { // <-- a future instead of a closure
        println!("hello from the first scoped task");
        dbg!(&a);
    });
    s.spawn(async {
        println!("hello from the second scoped task");
        x += a[0] + a[2];
    });
    println!("hello from the main future");
}).await; // <-- note the await

a.push(4);
```
Note how it spawns futures as tasks instead of closures as threads. Also note that we need to await it.

## Unsoundness of scoped tasks
What is it that make scoped_tasks unsound while scope threads is sound? The critical difference is in the "wait for all threads/tasks to complete" step.

In the sync version, we use an infinite loop to wait for the threads to complete. In async Rust, waiting should be done the async way: instead of looping, `scoped_tasks` would pause and wait to be polled again once all the tasks have completed.

Let's see how this make it unsound.

1. We create a future `fut_1` that we want to spawn. `fut_1` has lifetime no smaller than `'life`.

	```rust
	let fut_1 = async { ... };
	```
2. The lifetime `'life` starts.

	```rust
	//            start of 'life
	// -------------------------------------
	```
3. We call `scoped_tasks`.

	This is an async function, so it returns a future. Let's call this future `x`.

	```rust
	let x = task::scope(|s| {
		s.spawn(fut_1);
	});
	```

4. Usually, we would do `x.await` to let the future be polled to completion automatically.
	Instead, to demonstrate unsoundness, we will poll `x` manually.

	```rust
	// x.await; <-- what we usually do
	x.poll(...);
	```
	This will cause the future `x` to do work. In this case, it spawns `fut_1`.

5. `x` is now waiting for the spawned task of `fut_1` to complete.
	
	In the sync version, this step would involve looping until the thread completes. In our async version, the future `x` pauses and expects to be polled again once `fut_1` completes.

	**But there is nothing to guarantee that the rest of the program will respect `x`'s decision to pause!**

6. Instead of waiting and polling `x` again at appropriate time, let's just **not care about `x` anymore**. We're not going to wait for the spawned task to complete. We're not going to poll `x` again.

7. Our code simply progresses forward to the end of `'life`.

	```rust
	// -------------------------------------
	//             end of 'life
	```

See the unsoundness? The future `fut_1` is only guaranteed to last within `'life`. We have gone beyond the end of `'life`, yet the task of `fut_1` is still running in the executor. We're running `fut_1` beyond it's lifetime!

## It's unsound. Now what?

First, it's not so bad. As you can see, the process to bring out the unsoundness of `task::scope` is pretty contrived. The "manually poll `x`" step (step 4) is not something you do in everyday code.

Still, unsound is unsound. We can't just expose `task::scope` as a safe function and expect people to use it the correct way.

### Alternative solutions

The easiest fix is to simply expose `task::scope` as `unsafe`, and document that user must not ignore the future returned from the function.

Another solution is to make `task::scope` work more similarly to `thread::scope`, specifically by making it use infinite loop to wait. This is in essence the approach taken by the [async-scoped crate](https://crates.io/crates/async-scoped).

However, having an infinite loop in async code "blocks the executor" and removes many benefits of async. This can become a real issue if you need to use scoped tasks in many places, or if you are in an environment such as browser WASM, where blocking is totally unacceptable.

### New approach: scoped_async_spawn

[Async UI](https://wishawa.github.io/posts/async-ui-intro/) falls into both of the aforementioned criteria: it needs to spawn a task for every UI component, and also be able to run in the browser. To make Async UI work, I made [scoped_async_spawn](https://crates.io/crates/scoped-async-spawn), which uses [Pin](https://doc.rust-lang.org/std/pin/struct.Pin.html) and runtime checks to make sure that the spawning future (the `x` in our example) can't be ignored.

The mechanism of scoped_async_spawn is a blog-post worth of content in itself, so I'll make a separate post about it soon. Stay tuned!