---
name: push-screens
description: Put screenshots in front of the person to review and mark up. Use after any change to a user interface, a designed document or a slide, instead of pasting pictures in chat.
---

The person reviews by drawing on real screens in a local page. In a session using Markback, push a review as soon as a meaningful visible change is ready to check. Push the screens that changed and include the earlier pictures when you have them. The person can review directly on the page.

## Start it

```bash
review start
```

It prints the address, by default http://localhost:5741. If `review` is not found, use `node <markback folder>/review.mjs` in its place (in Claude Code, `node "${CLAUDE_PLUGIN_ROOT}/review.mjs"`). If the port is taken: `review start --port 5742`. Pushing only writes files, so it works with the page closed, or where a sandbox stops `start` from seeing it.

## In a sandbox

Some agents run commands in a sandbox that drops environment variables, cannot write outside the project, or has no Chrome. There, run this once, in the project's folder:

```bash
review project --store .markback-store
```

It writes `.markback`, a small file that names the store. Every `review` command in this folder, or below it, then uses that store, with no setting needed. Add `--port 5760` to name the port too.

- Push your own screenshots with `review push`. Without Chrome, `review see` and `review project` stop at once and say so.
- You cannot start the page from the sandbox, and you do not need to. Pushing writes files, and says so. Ask the person to run `review start` in the project's folder, outside the sandbox. The page then shows everything you pushed.
- `review wait` and `review read` work as usual: they read the same files.
- When it says the store is not in `.gitignore`, add it there, or tell the person.
- `--home <folder>` with any command names the store for that command. It wins over `REVIEW_HOME`, which wins over `.markback`.

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

## A PDF

```bash
review pdf brochure.pdf --check "Is the cover right?"
```

Each page becomes a screen, named Page 1, Page 2 and so on, under the file's name (or `--app`). It shows the first 30 pages; ask for others with `--pages 31-60`, or one page with `--pages 4`. Push it again after a change and each page starts its next round, with where it changed marked. Two PDFs with the same file name share one review, so give `--app` to keep them apart. It takes `--kind`, `--item` and `--from` as `push` does. On a Mac it needs nothing more. Anywhere else it needs `pdftoppm`, which comes with Poppler.

## The words in the picture

A screenshot is only pixels, so a box says where and not what. With a list of the words in the picture, every mark comes back with the words under it and the element they are in. `review see`, `review project` and `review pdf` make the list themselves. For a screenshot from your own browser tool, make the list in the page, at the same window size and scroll as the screenshot, and give it with `--words`:

```js
// Playwright here. Any tool that runs JavaScript in the page and gives back its value will do.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const script = execFileSync('review', ['words-script'], { encoding: 'utf8' }) // one expression: its value is the list
await page.screenshot({ path: 'home.png' }) // the window, not the full page
writeFileSync('home-words.json', JSON.stringify(await page.evaluate(script)))
execFileSync('review', ['push', '--app', 'My app', '--screen', 'Home', '--after', 'home.png', '--words', 'home-words.json'])
```

The list is JSON: `{ "size": { "w": 1440, "h": 900 }, "words": [{ "t": "Saturday", "x": 795, "y": 1038, "w": 132, "h": 34, "el": "div.item > b" }] }`. `size` is the picture's width and height. Each word has its box in the picture's own pixels, from the top left. Words are in reading order. `el` is the element the word is in, and can be left out. A screenshot saved at another scale is fine: `push` fits the list to the picture. A list that is not right is refused in one line: push again without `--words` then, since a picture without words is better than no picture. The script reads the text the window shows and what its form fields show, never a password. It leaves out frames, closed shadow roots and text a style sheet adds. Markback does not read words off a bare picture.

## Then

If the review is not open yet, open it for them: in the desktop session's built-in browser when there is one, or in their regular browser with `review open --app "My app"`. `review project` opens it too, unless you gave it `--no-open`. The open page shows each new round by itself, so do not open it again. Tell them they can draw and press **Send**, then use the `read-marks` skill to wait for the answers yourself.
