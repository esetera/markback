# Markback

The person reviews screens by drawing on them in a local page. You push screenshots with the `review` command; they mark them up and press Send; you read each mark back as a request. Everything is plain files under `~/.review-wizard`, so any agent that can run a shell command can use it. Each section below is a skill; where one says "use the `read-marks` skill", read that section.

`review` is `bin/review` in the Markback folder. If it is not on the PATH, use `node review.mjs` in the Markback folder in its place. It needs Node 22.6 or later, and nothing else.

Working on Markback itself? This file is made from `skills/*/SKILL.md` by `node scripts/agents-md.mjs`: change the skills, not this file, and run `npm test`.

## markback

_Start Markback in a project, or from one sentence: the person is drawing on their app's screens within a minute, with nothing to paste. Use when someone types /markback, wants to see or review their app, or says what they want built._

The goal is the person drawing on their own app's screens within a minute. Never ask them for an address. Open the review for them, and give them its address only when you cannot open it yourself.

Start from what the person said.

### In their project

Run this in the project's folder:

```bash
review project
```

It finds how the app runs, takes pictures of its main screens, and names the review after the folder. If your desktop session can open the review in its built-in browser, use `review project --no-open` and open the printed URL there yourself. If that fails, run `review open --app "<review name>"` to open their regular browser.

- **"Your app runs with npm run dev, and it is not running":** starting it runs their code. Ask them first, in one line. On a yes, run `review project --yes`.
- **"needs a small Chrome from Google":** that is a download. Ask them first, in one line, saying what it is and how big. On a yes, run the same command again with `--fetch-browser`.
- **"There is no app in this folder yet":** make the first screen from what they said (below).

### No app yet

1. Infer what the application needs: its main screen, its real content, what a person does first. Do not ask questions.
2. Write that one screen as a single HTML file, `index.html`, with believable content. No build step, and no back end yet.
3. Run `review project` again. It finds the page and opens the first review.

### Then

Tell them they can draw and press **Send**. From here you keep the review going yourself, and they never run a command: use the `read-marks` skill to wait for their answer and act on it, and the `push-screens` skill after each visible change you make, for as long as this session works on the project.

For a single-screen project, `review project --no-open` can also capture and push the next round. It uses the same review name and screen. Wait for that round in the same session.

If a command fails or nothing shows, run `review check` and tell the person what it says.

If `review` is not found, use `node review.mjs` in the Markback folder in its place.

## push-screens

_Put screenshots in front of the person to review and mark up. Use after any change to a user interface, a designed document or a slide, instead of pasting pictures in chat._

The person reviews by drawing on real screens in a local page. In a session using Markback, push a review as soon as a meaningful visible change is ready to check. Push the screens that changed and include the earlier pictures when you have them. The person can review directly on the page.

### Start it

```bash
review start
```

It prints the address, by default http://localhost:5741. If `review` is not found, use `node review.mjs` in the Markback folder in its place. If the port is taken: `review start --port 5742`. Pushing only writes files, so it works with the page closed, or where a sandbox stops `start` from seeing it.

### Push one screen at a time

```bash
review push --app "My app" --screen "Home" --mode light --after after.png --before before.png --check "Does the heading line up?"
```

- Light and dark are separate screens: push each with its `--mode`.
- `--before` is the picture from before the change, at the same size. The page then marks where the picture changed, so you need not describe the change.
- `--check` is what to look at, ten words or fewer. Ask a question. It can be given up to three times. It is read at a glance, so do not say what you did or why.
- `--kind qa` (the default): something built, to check. `--kind proposal`: a new idea to shape, shown loudly as Proposal.
- Pushing the same app, screen and mode again starts the next round on that step. The marks sent on the last round come along by themselves: the page shows each at its place and asks whether it is fixed. Do not repeat them with `--check`.
- `--from "Codex"` says who pushed it. The default is Claude.
- Pictures are copied, so temporary files are fine. PNG, JPEG, WebP and SVG all work.
- Do not push hundreds of pages when ten will do. Offer a sample first.

### A PDF

```bash
review pdf brochure.pdf --check "Is the cover right?"
```

Each page becomes a screen, named Page 1, Page 2 and so on, under the file's name (or `--app`). It shows the first 30 pages; ask for others with `--pages 31-60`, or one page with `--pages 4`. Push it again after a change and each page starts its next round, with where it changed marked. Two PDFs with the same file name share one review, so give `--app` to keep them apart. It takes `--kind`, `--item` and `--from` as `push` does. On a Mac it needs nothing more. Anywhere else it needs `pdftoppm`, which comes with Poppler.

### The words in the picture

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

### Then

If the review is not open yet, open it for them: in the desktop session's built-in browser when there is one, or in their regular browser with `review open --app "My app"`. `review project` opens it too, unless you gave it `--no-open`. The open page shows each new round by itself, so do not open it again. Tell them they can draw and press **Send**, then use the `read-marks` skill to wait for the answers yourself.

## read-marks

_Read what the person marked on screens pushed for review and act on each mark. Use after pushing screens, or when the person says they have finished reviewing._

Every mark is a request. Do not ask whether to act on it: do it, unless it is a choice only the person can make.

### Wait

After pushing a round, tell the person they can press **Send** or **Looks good**. Then wait for them yourself: they do not have to tell you they have finished, and they never run a command.

```bash
review wait --app "My app" --all --timeout 7200
```

It ends when they have answered, and prints the answers. How you run it depends on your tool:

- **Your tool can run a command in the background and wake you when it ends** (Claude Code can): run it in the background and end your turn. You are woken when they answer. Do not poll it.
- **It cannot** (Codex): run it in the foreground and wait for it. If your tool stops the command before they have answered, run it again.

`--all` waits until every queued screen has an answer for its current round. Without `--all`, the first new answer ends the wait. If the command ends with "before the timeout", they have not finished: run it again, unless they asked to stop. Nothing is lost: it gives every answer when the last one comes. If it says the review is set aside, tell the person and stop waiting until they bring it back. Act on each answer once. The review is over when every screen is approved, or when they ask to stop. In a new session, start by reading what is pending.

### Read

```bash
review read --app "My app" --latest
review read --app "My app" --latest --json
```

Each answer has:

- `verdict`: `changes` or `approved`. Approved means leave that screen alone.
- `kind`: `qa` or `proposal`.
- `notes`: what they typed or spoke.
- `shapes`: each with `type` (box, arrow, text, freehand, words, pin) and `box` in the picture's own pixels. An arrow has `from` and `to`. Text has `text`. A pin is something said at a spot: `at` is the spot and `text` is what was said.
- `words` on a shape: the words under that mark, when the picture was pushed with its words. `element` is the element they are all in. Search the code for them to find what the mark is about. A shape of type `words` is words the person chose, in `text`.
- `asked`: the marks and notes from earlier rounds, on a screen pushed again. Each has `n`, the `round` it was asked in, and the mark's own `type`, `text` and `words`. `box` is its place: for an arrow or a pin, a 48 pixel square round the head or the spot. `said` is what the person said of it: `fixed`, `stands`, or `null` when they did not tick it or did not look (a `noComment` answer). `cameBack: true` means they had ticked it fixed, and it came back.
- `annotatedImage`: the picture with the marks burned in. **Open it before you change anything.** A box round something says more than its numbers.
- `afterImage`, `beforeImage`, `round`.

### Act

1. Open the marked picture.
2. Make one change per mark, with the typed notes as the explanation.
3. Check your change on the real screen.
4. Take the changed screenshots again and push them under the same names and modes. The open page shows the new round by itself, so do not open it again. Tell the person the next round is ready, then wait again.

Earlier marks that still stand, came back or were not ticked are still to do: act on them as on new marks. Leave the ones said fixed alone.

Keep a list of the marks and tick each one when it is done, so none is lost.

## workflow-sketches

_Draw a workflow as a simple architect's sketch for the person to check and mark up. Use when a feature has a multi-step flow, or to check who may do what and what triggers it._

A workflow can only be checked when it says who may do each step and what makes it happen. A plain flowchart hides what goes wrong. Keep it simple.

### Rules for a sheet

- One question a sheet. One row of boxes, eight at most. Two branches at most, as notes.
- Each box: a short step name, who may do it, what triggers it, in a few words.
- No routes, status codes or file names on the picture. They go in a separate file.
- Draw from the real code, not from memory or the plan. Where the code differs from what was intended, add `"mark": 1` to that box for a red tag, and say so in a note.

### Draw it

Write the sheet as JSON:

```json
{
  "title": "An order reaches the warehouse",
  "name": "Order workflow",
  "sheet": "1 of 3",
  "boxes": [
    { "step": "Customer orders", "who": "Customer", "when": "Fills in the form" },
    { "step": "Joins the queue", "who": "Automatic", "when": "Form arrives", "tell": "Mails the warehouse" },
    { "step": "Staff pick it", "who": "Any staff", "when": "Order is waiting", "mark": 1 }
  ],
  "notes": ["Withdrawn: it ends here"]
}
```

Then make the picture and push it:

```bash
review sketch --in sheet.json --out sheet.svg
review push --app "Order workflow" --screen "1 An order reaches the warehouse" --after sheet.svg --check "Is this who may do each step?"
```

## ideas-and-queue

_Answer the person's requests for improvement ideas and work through their queue in order. Use when asked to watch for idea requests, or to pick up queued work from the review page._

The review page has two pages at /work.html: Ideas and Queue. They read the same files you do. The page cannot think, so requests wait for you.

### Ideas

Wait for a request, in the background:

```bash
review ideas wait --timeout 3600
```

Then **really study the target first**: read its code, run it, look at its screens. A generic idea is worth nothing. Post each idea:

```bash
review ideas post --request <id> --what "Sort the list by last change" --why "Finding today's work takes three clicks" --size S
```

One short line for what. One for why. Size is S, M or L. The request closes when enough have come; `review ideas close --request <id>` closes it sooner.

### Queue

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
