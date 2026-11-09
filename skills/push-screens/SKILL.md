---
name: push-screens
description: Put screenshots in front of the person to review and mark up. Use after any change to a user interface, a designed document or a slide, instead of pasting pictures in chat.
---

The person reviews by drawing on real screens in a local page. Push the screens, tell them it is ready, and stop. Do not paste the pictures in chat.

## Start it

```bash
review start
```

It prints the address, by default http://localhost:5741. If `review` is not found, use `node "${CLAUDE_PLUGIN_ROOT}/review.mjs"` in its place. If the port is taken: `review start --port 5742`.

## Push one screen at a time

```bash
review push --app "My app" --screen "Home" --mode light --after after.png --before before.png --check "Does the heading line up?"
```

- Light and dark are separate screens: push each with its `--mode`.
- `--before` is the picture from before the change, at the same size. The page then marks where the picture changed, so you need not describe the change.
- `--check` is what to look at, ten words or fewer. Ask a question. It can be given up to three times. It is read at a glance, so do not say what you did or why.
- `--kind qa` (the default): something built, to check. `--kind proposal`: a new idea to shape, shown loudly as Proposal.
- Pushing the same app, screen and mode again starts the next round on that step.
- `--from "Codex"` says who pushed it. The default is Claude.
- Pictures are copied, so temporary files are fine. PNG, JPEG, WebP and SVG all work.
- Do not push hundreds of pages when ten will do. Offer a sample first.

## Then

Tell the person the page is ready, with the address. To get the answers, use the `read-marks` skill.
