
+++
title = "Six fun things to do with Rust operator overloading"
description = "abusing overloading to make custom syntax and more..."
date = 2023-01-19

[extra]
hide_notice = true

[taxonomies]
categories = ["Tech"]
tags = ["Rust"]
+++

![Winnie the Pooh meme: the regular Pooh has at `dot_product([1.2, 3.6, 2.2], [4.0, 5.0, 6.1])` while the suit one has `[1.2, 3.6, 2.2] *dot* [4.0, 5.0, 6.1]`](dot-product-pooh.jpg)

*I am **not** endorsing the code in this post.*

## C++ Input/Output
Instead of
```rust
stdin().read_line(&mut buffer).unwrap();
println!("Hello I am {name}!!!");
```
we can overload the shift operators on `cin` and `cout` to allow
```rust
cin >> &mut buffer;
cout << "Hello I am " << name << "!!!" << endl;
```

## Variadic Functions
Instead of
```rust
std::cmp::max(x, y);
[w, x, y, z].into_iter().max();
```
we can make
```rust
// max+ is like std::cmp::max but better
// it supports >2 arguments
max+(x, y);
max+(w, x, y, z);
```

## More Concise Builders
Here's a more serious one. Builder pattern sometimes involve a lot of repeated method calls. Take for example this usage of the [warp web framework](https://github.com/seanmonstar/warp).
```rust
let hi = warp::path("hello")
    .and(warp::path::param())
    .and(warp::header("user-agent"))
    .map(|param: String, agent: String| {
        format!("Hello {}, whose agent is {}", param, agent)
    });
```
What if the API look like this instead?
```rust
let hi = warp::path("hello")
	+	warp::path::param()
	+	warp::header("user-agent")
	>>	|param: String, agent: String| {
			format!("Hello {}, whose agent is {}", param, agent)
		};
```

## Infix Functions
Instead of
```rust
x.pow(y);
dot_product(a, b);
a.cross(b.cross(c).cross(d))
```
we can make
```rust
x ^pow^ y;
a *dot* b;
a *cross* (b *cross* c *cross* d);
```

[Lots of people](https://github.com/rust-lang/rfcs/issues/1579) wanted this!

## Doublefish
`std::mem` provides these functions
```rust
size_of::<T>();
size_of_val(&value);
```
Turbofish enthusiasts would enjoy `size_of` but not so much `size_of_val`, so let's make our own improved version of `size_of_val` that's more turbofishy
```rust
size_of::<T>();
size_of_val<<&value>>();
```

## Join and Race
Futures combinators can have short-circuiting behaviors
```rust
// quit if any of the 3 errors
(fut1, fut2, fut3).try_join().await;

// quit if any of the 3 succeeds
(fut4, fut5, fut6).race_ok().await;
```
let's communicate this through `&` and `|`
```rust
(TryJoin >> fut1 & fut2 & fut3).await;
(RaceOk >> fut4 | fut5 | fut6).await;
```

# Useful Links
- [Discuss this on Reddit](https://www.reddit.com/r/rust/comments/10golkq)
- [Playground](https://play.rust-lang.org/?version=stable&mode=debug&edition=2021&gist=71da59351b0988249a69014e6b191353) containing the implementations behind some of the code shown here
- [std::ops docs](https://doc.rust-lang.org/std/ops/index.html)
- [Rust operators precedence table](https://doc.rust-lang.org/reference/expressions.html#expression-precedence)