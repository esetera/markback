---
name: ideas-and-queue
description: Keep listening for work from the review page, take approved items from the queue and build them, and answer requests for ideas. Use after any review round, whenever you would otherwise stop, or when told to take the next item from the Markback queue.
---

The review page has two pages at /work.html: Ideas and Queue. They read the same files you do. The page cannot think, so work waits for you. If you do not listen, approved work is not built and nobody knows.

## Keep listening

If a Codex Desktop heartbeat is active for this review, it handles the marks. For sessions without that heartbeat, start this after any round and whenever you would otherwise stop:

```bash
review work wait --by "your name"
```

It ends when there is something for an agent to do. It prints what, and the exact next command: an item in the queue that nobody has taken, a request for ideas, or answers that nobody has read. Run it the way the `read-marks` skill says for `review wait`: in the background where your tool wakes you when a command ends (Claude Code does), in the foreground where it does not (Codex). When it ends, do what it prints, without asking: take the top item and build it, read the marks and act on them, answer the request. Then start it again. If it ends with "before the timeout", run it again.

**An approved proposal is an instruction to build, not a question.** The person approved it on the page. Do not ask them again.

While it runs, the page shows the person that you are listening. When no agent listens and work waits, the page says so, and the person may give you a line such as "Take the next item from the Markback queue and build it" or "Read my marks in Markback and act on them". Then run `review work`, which prints the same list at once, and do what it says.

## Wake

### Codex Desktop

When automatic pickup is requested, set up a native heartbeat in this chat after the first screenshot is pushed. Use the app's scheduled-task tool to create one active heartbeat in the current chat, with a one-minute interval or the shortest interval the app supports. Reuse an existing Markback heartbeat for this review. Put the actual project folder, app slug, absolute path to the installed review CLI, and any project-specific `REVIEW_HOME` in its prompt. The heartbeat's instructions should say:

> In this project, run the installed Markback CLI's `review wake poll --app <slug>`. If the review is complete, stop this heartbeat and unregister it with `review wake desktop --app <slug> --off`. If wake is off or there are no marks, end quietly. Otherwise open each marked picture, apply its notes and shapes, verify the changes, and push an updated screenshot under the same screen name. Keep the heartbeat in this chat for further rounds.

Once the app confirms the heartbeat is active, run `review wake desktop --app <slug>` from this chat. The person only draws and presses **Send**. End the turn so the heartbeat can run. Do not start `review wait`, `review work wait`, or `codex exec resume` for this review. If the native scheduler is unavailable, report that and use the ordinary foreground review workflow.

### Claude Code and other command-based agents

The person must never have to start you by hand. Say once, in the project's folder, how the review page's server can start you. Each project has its own command, so setting one never changes another project's:

```bash
review wake set --run "claude -p '{prompt}' --continue" --by "Claude"
```

That line is for Claude Code: a run with no window that continues the last conversation in that folder. For another tool, give its own command for a run with no window that continues its last session, with `{prompt}` where the words for you go. Read the tool's own help for the real flags, and do not guess them. If you cannot confirm a form, set nothing and tell the person.

When work on this project's reviews waits and no agent has listened for a minute, the server runs that command in this folder, with a fixed prompt that names this project and its reviews and says to run `review work` and do what it says. In the project's folder, `review work` lists only that project's work. Take only that: another project's work is not yours. Work on a review no project has pushed starts nobody. If the project has pushed no review yet, add `--app "<review name>"` to `wake set`. It runs one at a time, rests 30 seconds after each run, and does not run again for the same work within ten minutes. You run with the permissions the person already gave your tool: Markback adds none. Do not put a flag that skips permission prompts in the command. `review wake show` says what is set for this project (`--all` for every project), `review wake off` stops it, and `review wake clear` removes it. A run that goes on for 30 minutes no longer stops a new one. The person can also turn it off in the page's menu, where the command is shown. Nothing on the page can set or change the command.

In Claude Code with the Markback plugin, two hooks also keep you listening: when you are about to stop and work waits, you are told to take it. Without the plugin, put them in the project once with `review install-skills --hooks`, and take them out with `review install-skills --remove-hooks`. They only hold you for work on this project's own reviews.

## Ideas

`review work wait` ends when a request for ideas comes. To wait only for requests:

```bash
review ideas wait --timeout 3600
```

Then **really study the target first**: read its code, run it, look at its screens. A generic idea is worth nothing. Post each idea:

```bash
review ideas post --request <id> --what "Sort the list by last change" --why "Finding today's work takes three clicks" --size S
```

One short line for what. One for why. Size is S, M or L. The request closes when enough have come; `review ideas close --request <id>` closes it sooner.

## Queue

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
