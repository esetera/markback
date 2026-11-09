# Markback

The person reviews screens by drawing on them in a local page. You push screenshots with the `review` command; they mark them up and press Send; you read each mark back as a request. Everything is plain files under `~/.review-wizard`, so any agent that can run a shell command can use it. Each section below is a skill; where one says "use the `read-marks` skill", read that section.

`review` is `bin/review` in the Markback folder. If it is not on the PATH, use `node review.mjs` in the Markback folder in its place. It needs Node 22.6 or later, and nothing else.

Working on Markback itself? This file is made from `skills/*/SKILL.md` by `node scripts/agents-md.mjs`: change the skills, not this file, and run `npm test`.

## first-mark

_From one sentence or a running app to the person's first mark, in about a minute. Use when someone says what they want built and wants to see it, or names an app to review._

The goal is a screen the person can draw on within a minute. Speed matters more than polish: their marks will do the rest.

Start from what the person said.

### If it is an address, or an app is already running

```bash
review start
review see http://localhost:3000 --app "My app"
```

### If it is a sentence

1. Infer what the application needs: its main screen, its real content, what a person does first. Do not ask questions.
2. Write that one screen as a single HTML file, with believable content. No build step, and no back end yet.
3. Show it:

```bash
review start
review see "file://$PWD/first.html" --app "My app" --kind proposal
```

### Then

Tell them the page's address and say: draw on anything, then press Send. Stop there. To act on what comes back, use the `read-marks` skill.

If `review` is not found, use `node review.mjs` in the Markback folder in its place.

## push-screens

_Put screenshots in front of the person to review and mark up. Use after any change to a user interface, a designed document or a slide, instead of pasting pictures in chat._

The person reviews by drawing on real screens in a local page. Push the screens, tell them it is ready, and stop. Do not paste the pictures in chat.

### Start it

```bash
review start
```

It prints the address, by default http://localhost:5741. If `review` is not found, use `node review.mjs` in the Markback folder in its place. If the port is taken: `review start --port 5742`.

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

### Then

Tell the person the page is ready, with the address. To get the answers, use the `read-marks` skill.

## read-marks

_Read what the person marked on screens pushed for review and act on each mark. Use after pushing screens, or when the person says they have finished reviewing._

Every mark is a request. Do not ask whether to act on it: do it, unless it is a choice only the person can make.

### Wait

Run this in the background so it wakes you when they answer:

```bash
review wait --app "My app" --all --timeout 7200
```

`--all` waits until every screen is answered. Without it, the first answer ends the wait.

### Read

```bash
review read --app "My app" --latest
review read --app "My app" --latest --json
```

Each answer has:

- `verdict`: `changes` or `approved`. Approved means leave that screen alone.
- `kind`: `qa` or `proposal`.
- `notes`: what they typed or spoke.
- `shapes`: each with `type` (box, arrow, text, freehand) and `box` in the picture's own pixels. An arrow has `from` and `to`. Text has `text`.
- `annotatedImage`: the picture with the marks burned in. **Open it before you change anything.** A box round something says more than its numbers.
- `afterImage`, `beforeImage`, `round`.

### Act

1. Open the marked picture.
2. Make one change per mark, with the typed notes as the explanation.
3. Check your change on the real screen.
4. Take the same screenshots again and push them under the same names. That starts the next round.

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
