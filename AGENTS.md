# Markback

The person reviews screens by drawing on them in a local page. You push screenshots with the `review` command; they mark them up and press Send; you read each mark back as a request. Everything is plain files under `~/.review-wizard`, so any agent that can run a shell command can use it. Each section below is a skill; where one says "use the `read-marks` skill", read that section.

`review` is `bin/review` in the Markback folder. If it is not on the PATH, use `node review.mjs` in the Markback folder in its place. It needs Node 22.6 or later, and nothing else.

Working on Markback itself? This file is made from `skills/*/SKILL.md` by `node scripts/agents-md.mjs`: change the skills, not this file, and run `npm test`.

## markback

_Start Markback in a project, or from one sentence: the person is drawing on their app's screens within a minute, with nothing to paste. Use when someone types /markback, wants to see or review their app, or says what they want built._

The goal is the person drawing on their own app's screens within a minute. Never ask them for an address. Open the review for them, and give them its address only when you cannot open it yourself.

Start from what the person said.

If `review` is not found, use `node review.mjs` in the Markback folder in its place.

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

Once the first review is open, set up wake as described in the `ideas-and-queue` skill. In Codex Desktop, use the chat's native heartbeat and let the turn end after the first push. Do not register a subprocess or start a blocking wait when the Desktop heartbeat is active.

For sessions without a Desktop heartbeat, keep listening after each round: start `review work wait --by "your name"` as the `ideas-and-queue` skill says, and when it ends, do what it prints. An approved proposal is an instruction to build, not a question.

If a command fails or nothing shows, run `review check` and tell the person what it says.

## push-screens

_Put screenshots in front of the person to review and mark up. Use after any change to a user interface, a designed document or a slide, instead of pasting pictures in chat._

The person reviews by drawing on real screens in a local page. In a session using Markback, push a review as soon as a meaningful visible change is ready to check. Push the screens that changed and include the earlier pictures when you have them. The person can review directly on the page.

If `review` is not found, use `node review.mjs` in the Markback folder in its place.

### Start it

```bash
review start
```

It prints the address, by default http://localhost:5741. If the port is taken: `review start --port 5742`. Pushing only writes files, so it works with the page closed, or where a sandbox stops `start` from seeing it.

### Push one screen at a time

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

If `review` is not found, use `node review.mjs` in the Markback folder in its place.

### Wait

In Codex Desktop, when the chat's native Markback heartbeat is active, end the turn after a push. The next check reads this review's marks with `review wake poll --app <slug>`. Use the wait below for sessions without the Desktop heartbeat.

After pushing a round, tell the person they can press **Send** or **Looks good**. Then wait for them yourself: they do not have to tell you they have finished, and they never run a command.

```bash
review wait --app "My app" --all --timeout 7200 --by "your name"
```

It ends when they have answered, and prints the answers. How you run it depends on your tool:

- **Your tool can run a command in the background and wake you when it ends** (Claude Code can): run it in the background and end your turn. You are woken when they answer. Do not poll it.
- **It cannot** (Codex): run it in the foreground and wait for it. If your tool stops the command before they have answered, run it again.

`--all` waits until every queued screen has an answer for its current round. Without `--all`, the first new answer ends the wait. If the command ends with "before the timeout", they have not finished: run it again, unless they asked to stop. Nothing is lost: it gives every answer when the last one comes. If it says the review is set aside, tell the person and stop waiting until they bring it back. Act on each answer once. The review is over when every screen is approved, or when they ask to stop. In a new session, start by reading what is pending.

`--by` names you on the page, which shows the person whether an agent is listening. Do not go idle when this wait is over. After any round, and whenever you would otherwise stop, start `review work wait --by "your name"` in the same way (see the `ideas-and-queue` skill). When it ends, do what it prints: take an approved item and build it without asking, read new marks, answer a request for ideas.

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
- `annotatedImage`: the picture with the marks burned in. **Open it before you change anything.** A box round something says more than its numbers.
- `afterImage`, `beforeImage`, `round`.

### Say what you read

A mark can be read more than one way. Before you change anything, say back what you take each mark to mean, in one short line a mark:

```bash
review inferred --app "My app" --screen "Home" --mode light --mark 1 --text "Make Book the main button"
```

`--mark` is the mark's number as `review read` gives it. When `review read` shows more than one answer on a screen, each has `Answer: <time>` at the end of its first line: add `--answer <time>` for the one you read. Say what you will do, in twelve words or fewer, not what the mark looks like. The person sees each line beside its mark, and answers **Yes, that** or corrects it in a few words.

Do not wait for them: go on with the work. Run `review wait --app "My app" --by "your name"` in the background as you work; it ends when they answer a line. `review read --app "My app" --latest` shows each line with what they said back. A correction stands in place of your reading: do what it says, and undo what you did on the wrong reading.

### Act

1. Open the marked picture.
2. Make one change per mark, with the typed notes as the explanation.
3. Check your change on the real screen.
4. Take the changed screenshots again and push them under the same names and modes. The open page shows the new round by itself, so do not open it again. Tell the person the next round is ready, then wait again.

Keep a list of the marks and tick each one when it is done, so none is lost.

## workflow-sketches

_Draw a workflow as a simple architect's sketch for the person to check and mark up. Use when a feature has a multi-step flow, or to check who may do what and what triggers it._

A workflow can only be checked when it says who may do each step and what makes it happen. A plain flowchart hides what goes wrong. Keep it simple.

If `review` is not found, use `node review.mjs` in the Markback folder in its place.

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

_Keep listening for work from the review page, take approved items from the queue and build them, and answer requests for ideas. Use after any review round, whenever you would otherwise stop, or when told to take the next item from the Markback queue._

The review page has two pages at /work.html: Ideas and Queue. They read the same files you do. The page cannot think, so work waits for you. If you do not listen, approved work is not built and nobody knows.

### Keep listening

If a Codex Desktop heartbeat is active for this review, it handles the marks. For sessions without that heartbeat, start this after any round and whenever you would otherwise stop:

```bash
review work wait --by "your name"
```

It ends when there is something for an agent to do. It prints what, and the exact next command: an item in the queue that nobody has taken, a request for ideas, or answers that nobody has read. Run it the way the `read-marks` skill says for `review wait`: in the background where your tool wakes you when a command ends (Claude Code does), in the foreground where it does not (Codex). When it ends, do what it prints, without asking: take the top item and build it, read the marks and act on them, answer the request. Then start it again. If it ends with "before the timeout", run it again.

**An approved proposal is an instruction to build, not a question.** The person approved it on the page. Do not ask them again.

While it runs, the page shows the person that you are listening. When no agent listens and work waits, the page says so, and the person may give you a line such as "Take the next item from the Markback queue and build it" or "Read my marks in Markback and act on them". Then run `review work`, which prints the same list at once, and do what it says.

### Wake

#### Codex Desktop

When automatic pickup is requested, set up a native heartbeat in this chat after the first screenshot is pushed. Use the app's scheduled-task tool to create one active heartbeat in the current chat, with a one-minute interval or the shortest interval the app supports. Reuse an existing Markback heartbeat for this review. Put the actual project folder, app slug, absolute path to the installed review CLI, and any project-specific `REVIEW_HOME` in its prompt. The heartbeat's instructions should say:

> In this project, run the installed Markback CLI's `review wake poll --app <slug>`. If the review is complete, stop this heartbeat and unregister it with `review wake desktop --app <slug> --off`. If wake is off or there are no marks, end quietly. Otherwise open each marked picture, apply its notes and shapes, verify the changes, and push an updated screenshot under the same screen name. Keep the heartbeat in this chat for further rounds.

Once the app confirms the heartbeat is active, run `review wake desktop --app <slug>` from this chat. The person only draws and presses **Send**. End the turn so the heartbeat can run. Do not start `review wait`, `review work wait`, or `codex exec resume` for this review. If the native scheduler is unavailable, report that and use the ordinary foreground review workflow.

#### Claude Code and other command-based agents

The person must never have to start you by hand. Say once, in the project's folder, how the review page's server can start you. Each project has its own command, so setting one never changes another project's:

```bash
review wake set --run "claude -p '{prompt}' --continue" --by "Claude"
```

That line is for Claude Code: a run with no window that continues the last conversation in that folder. For another tool, give its own command for a run with no window that continues its last session, with `{prompt}` where the words for you go. Read the tool's own help for the real flags, and do not guess them. If you cannot confirm a form, set nothing and tell the person.

When work on this project's reviews waits and no agent has listened for a minute, the server runs that command in this folder, with a fixed prompt that names this project and its reviews and says to run `review work` and do what it says. In the project's folder, `review work` lists only that project's work. Take only that: another project's work is not yours. Work on a review no project has pushed starts nobody. If the project has pushed no review yet, add `--app "<review name>"` to `wake set`. It runs one at a time, rests 30 seconds after each run, and does not run again for the same work within ten minutes. You run with the permissions the person already gave your tool: Markback adds none. Do not put a flag that skips permission prompts in the command. `review wake show` says what is set for this project (`--all` for every project), `review wake off` stops it, and `review wake clear` removes it. A run that goes on for 30 minutes no longer stops a new one. The person can also turn it off in the page's menu, where the command is shown. Nothing on the page can set or change the command.

In Claude Code with the Markback plugin, two hooks also keep you listening: when you are about to stop and work waits, you are told to take it. Without the plugin, put them in the project once with `review install-skills --hooks`, and take them out with `review install-skills --remove-hooks`. They only hold you for work on this project's own reviews.

If `review` is not found, use `node review.mjs` in the Markback folder in its place.

### Ideas

`review work wait` ends when a request for ideas comes. To wait only for requests:

```bash
review ideas wait --timeout 3600
```

Then **really study the target first**: read its code, run it, look at its screens. A generic idea is worth nothing. Post each idea:

```bash
review ideas post --request <id> --what "Sort the list by last change" --why "Finding today's work takes three clicks" --size S
```

One short line for what. One for why. Size is S, M or L. The request closes when enough have come; `review ideas close --request <id>` closes it sooner.

### Queue

The person sets the order by dragging. `review work wait` ends when an item is in the queue. Always take the top:

```bash
review take --by "your name"
```

It prints the item, why it matters, what to do next, and every note. Then:

- **A proposal:** develop the UX, take screenshots, and push them with `--kind proposal --item <id>`.
- **Build it:** the person approved the proposal. Build it, and push the real screens with `--kind qa --item <id>`.

Pushing with `--item` moves it to Ready for you. Their answers move it on by themselves: marks send it back to the queue for another round (read them with the `read-marks` skill), and approval takes it onward. When they approve a proposal it is back in the queue as Build it: take it and build it at once.

**Read the notes again while you work.** The person may add some at any time:

```bash
review show --item <id>
```

Leave a note of your own with `review note --item <id> --text "..."`. Use `review stage --item <id> --to queued` to hand one back.
