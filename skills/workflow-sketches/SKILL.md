---
name: workflow-sketches
description: Draw a workflow as a simple architect's sketch for the person to check and mark up. Use when a feature has a multi-step flow, or to check who may do what and what triggers it.
---

A workflow can only be checked when it says who may do each step and what makes it happen. A plain flowchart hides what goes wrong. Keep it simple.

## Rules for a sheet

- One question a sheet. One row of boxes, eight at most. Two branches at most, as notes.
- Each box: a short step name, who may do it, what triggers it, in a few words.
- No routes, status codes or file names on the picture. They go in a separate file.
- Draw from the real code, not from memory or the plan. Where the code differs from what was intended, add `"mark": 1` to that box for a red tag, and say so in a note.

## Draw it

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
