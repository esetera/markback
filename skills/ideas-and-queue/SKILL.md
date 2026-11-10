---
name: ideas-and-queue
description: Answer the person's requests for improvement ideas and work through their queue in order. Use when asked to watch for idea requests, or to pick up queued work from the review page.
---

The review page has two pages at /work.html: Ideas and Queue. They read the same files you do. The page cannot think, so requests wait for you.

If `review` is not found, use `node <Markback folder>/review.mjs` in its place. The Markback folder is two folders up from this SKILL.md: the one that holds `skills`.

## Ideas

Wait for a request, in the background:

```bash
review ideas wait --timeout 3600
```

Then **really study the target first**: read its code, run it, look at its screens. A generic idea is worth nothing. Post each idea:

```bash
review ideas post --request <id> --what "Sort the list by last change" --why "Finding today's work takes three clicks" --size S
```

One short line for what. One for why. Size is S, M or L. The request closes when enough have come; `review ideas close --request <id>` closes it sooner.

## Queue

The person sets the order by dragging. Always take the top:

```bash
review take --by "your name"
```

It prints the item, why it matters, what to do next, and every note. Then:

- **A proposal:** develop the UX, take screenshots, and push them with `--kind proposal --item <id>`.
- **Build it:** the person approved the proposal. Build it, and push the real screens with `--kind qa --item <id>`.

Pushing with `--item` moves it to Ready for you. Their answers move it on by themselves: marks send it back to the queue for another round (read them with the `read-marks` skill), and approval takes it onward.

**Read the notes again while you work.** The person may add some at any time:

```bash
review show --item <id>
```

Leave a note of your own with `review note --item <id> --text "..."`. Use `review stage --item <id> --to queued` to hand one back.
