---
name: first-mark
description: From one sentence or a running app to the person's first mark, in about a minute. Use when someone says what they want built and wants to see it, or names an app to review.
argument-hint: "[what you want, or your app's address]"
---

The goal is a screen the person can draw on within a minute. Speed matters more than polish: their marks will do the rest.

They said: $ARGUMENTS

## If it is an address, or an app is already running

```bash
review start
review see http://localhost:3000 --app "My app"
```

## If it is a sentence

1. Infer what the application needs: its main screen, its real content, what a person does first. Do not ask questions.
2. Write that one screen as a single HTML file, with believable content. No build step, and no back end yet.
3. Show it:

```bash
review start
review see "file://$PWD/first.html" --app "My app" --kind proposal
```

## Then

Tell them the page's address and say: draw on anything, then press Send. Stop there. To act on what comes back, use the `read-marks` skill.

If `review` is not found, use `node "${CLAUDE_PLUGIN_ROOT}/review.mjs"` in its place.
