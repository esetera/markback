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
- `asked`: the marks and notes from earlier rounds, on a screen pushed again. Each has `n`, the `round` it was asked in, and the mark's own `type`, `box`, `text` and `words`. `said` is what the person said of it: `fixed`, `stands`, or `null` when they did not tick it. `cameBack: true` means they had ticked it fixed, and it came back.
- `annotatedImage`: the picture with the marks burned in. **Open it before you change anything.** A box round something says more than its numbers.
- `afterImage`, `beforeImage`, `round`.

## Act

1. Open the marked picture.
2. Make one change per mark, with the typed notes as the explanation.
3. Check your change on the real screen.
4. Take the changed screenshots again and push them under the same names and modes. The open page shows the new round by itself, so do not open it again. Tell the person the next round is ready, then wait again.

Earlier marks that still stand, came back or were not ticked are still to do: act on them as on new marks. Leave the ones said fixed alone.

Keep a list of the marks and tick each one when it is done, so none is lost.
