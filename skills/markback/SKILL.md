---
name: markback
description: "Start Markback in a project, or from one sentence: the person is drawing on their app's screens within a minute, with nothing to paste. Use when someone types /markback, wants to see or review their app, or says what they want built."
argument-hint: "[what you want, if there is no app yet]"
---

The goal is the person drawing on their own app's screens within a minute. Never ask them for an address. Open the review for them, and give them its address only when you cannot open it yourself.

They said: $ARGUMENTS

## In their project

Run this in the project's folder:

```bash
review project
```

It finds how the app runs, takes pictures of its main screens, and names the review after the folder. If your desktop session can open the review in its built-in browser, use `review project --no-open` and open the printed URL there yourself. If that fails, run `review open --app "<review name>"` to open their regular browser.

- **"Your app runs with npm run dev, and it is not running":** starting it runs their code. Ask them first, in one line. On a yes, run `review project --yes`.
- **"needs a small Chrome from Google":** that is a download. Ask them first, in one line, saying what it is and how big. On a yes, run the same command again with `--fetch-browser`.
- **"No Chrome or Edge here":** your sandbox has none. Follow "In a sandbox" in the `push-screens` skill: take the screenshots yourself and push them.
- **"There is no app in this folder yet":** make the first screen from what they said (below).

## No app yet

1. Infer what the application needs: its main screen, its real content, what a person does first. Do not ask questions.
2. Write that one screen as a single HTML file, `index.html`, with believable content. No build step, and no back end yet.
3. Run `review project` again. It finds the page and opens the first review.

## Then

Tell them they can draw and press **Send**. From here you keep the review going yourself, and they never run a command: use the `read-marks` skill to wait for their answer and act on it, and the `push-screens` skill after each visible change you make, for as long as this session works on the project.

For a single-screen project, `review project --no-open` can also capture and push the next round. It uses the same review name and screen. Wait for that round in the same session.

If a command fails or nothing shows, run `review check` and tell the person what it says.

If `review` is not found, use `node <markback folder>/review.mjs` in its place (in Claude Code, `node "${CLAUDE_PLUGIN_ROOT}/review.mjs"`).
