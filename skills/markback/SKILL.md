---
name: markback
description: Start Markback in a project, or from one sentence: the person is drawing on their app's screens within a minute, with nothing to paste. Use when someone types /markback, wants to see or review their app, or says what they want built.
argument-hint: "[what you want, if there is no app yet]"
---

The goal is the person drawing on their own app's screens within a minute. Never ask them for an address, and never hand them one to paste.

They said: $ARGUMENTS

## In their project

Run this in the project's folder:

```bash
review project
```

It finds how the app runs, takes pictures of its main screens, names the review after the folder, and opens the review page in their browser. Then tell them: "I've opened it. Draw on what you want changed, then press Send." Stop there.

- **"Your app runs with npm run dev, and it is not running":** starting it runs their code. Ask them first, in one line. On a yes, run `review project --yes`.
- **"There is no app in this folder yet":** make the first screen from what they said (below).

## No app yet

1. Infer what the application needs: its main screen, its real content, what a person does first. Do not ask questions.
2. Write that one screen as a single HTML file, `index.html`, with believable content. No build step, and no back end yet.
3. Run `review project` again. It finds the page and opens it.

## Then

To act on what comes back, use the `read-marks` skill.

If `review` is not found, use `node <markback folder>/review.mjs` in its place (in Claude Code, `node "${CLAUDE_PLUGIN_ROOT}/review.mjs"`).
