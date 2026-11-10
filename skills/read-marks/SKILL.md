---
name: read-marks
description: Read what the person marked on screens pushed for review and act on each mark. Use after pushing screens, or when the person says they have finished reviewing.
---

Every mark is a request. Do not ask whether to act on it: do it, unless it is a choice only the person can make.

## Wait

After pushing a round, tell the person they can press **Send** or **Looks good**. Then wait for them yourself: they do not have to tell you they have finished, and they never run a command.

```bash
review wait --app "My app" --all --timeout 7200
```

It ends when they have answered, and prints the answers. How you run it depends on your tool:

- **Your tool can run a command in the background and wake you when it ends** (Claude Code can): run it in the background and end your turn. You are woken when they answer. Do not poll it.
- **It cannot** (Codex): run it in the foreground and wait for it. If your tool stops the command before they have answered, run it again.

`--all` waits until every queued screen has an answer for its current round. Without `--all`, the first new answer ends the wait. If the command ends with "before the timeout", they have not finished: run it again, unless they asked to stop. Nothing is lost: it gives every answer when the last one comes. If it says the review is set aside, tell the person and stop waiting until they bring it back. Act on each answer once. The review is over when every screen is approved, or when they ask to stop. In a new session, start by reading what is pending.

## Read

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

## Say what you read

A mark can be read more than one way. Before you change anything, say back what you take each mark to mean, in one short line a mark:

```bash
review inferred --app "My app" --screen "Home" --mode light --mark 1 --text "Make Book the main button"
```

`--mark` is the mark's number as `review read` gives it. Say what you will do, in twelve words or fewer, not what the mark looks like. The person sees each line beside its mark, and answers **Yes, that** or corrects it in a few words.

Do not wait for them: go on with the work. Run `review wait --app "My app"` in the background as you work; it ends when they answer a line. `review read --app "My app" --latest` shows each line with what they said back. A correction stands in place of your reading: do what it says, and undo what you did on the wrong reading.

## Act

1. Open the marked picture.
2. Make one change per mark, with the typed notes as the explanation.
3. Check your change on the real screen.
4. Take the changed screenshots again and push them under the same names and modes. The open page shows the new round by itself, so do not open it again. Tell the person the next round is ready, then wait again.

Keep a list of the marks and tick each one when it is done, so none is lost.
