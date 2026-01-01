---
name: read-marks
description: Read what the person marked on screens pushed for review and act on each mark. Use after pushing screens, or when the person says they have finished reviewing.
---

Every mark is a request. Do not ask whether to act on it: do it, unless it is a choice only the person can make.

## Wait

Run this in the background so it wakes you when they answer:

```bash
review wait --app "My app" --all --timeout 7200
```

`--all` waits until every screen is answered. Without it, the first answer ends the wait.

## Read

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

## Act

1. Open the marked picture.
2. Make one change per mark, with the typed notes as the explanation.
3. Check your change on the real screen.
4. Take the same screenshots again and push them under the same names. That starts the next round.

Keep a list of the marks and tick each one when it is done, so none is lost.
