---
name: inbox
description: Manages the keepr inbox – things the user still has to clarify before they become a task (open questions, unclear ideas, "check whether …") – capture, list, add notes, mark clarified/dropped, turn into a task. Use when the user says /inbox, "add to inbox", "that still needs clarifying", "note that as an open question", "I'm not sure yet if that's a task", "what's still unclear", or in German "muss noch geklärt werden", "noch klären", "schreib das in die inbox", "notier das als offene frage", "was ist noch offen zu klären". Not for saving AI answers (use keep) or for clear, actionable work (use task).
---

# Inbox: things to clarify (keepr)

The inbox holds everything that is **not yet a task**: open questions, ideas, things someone
has to answer first. Items get IDs `I1`, `I2` …. Once an item is clear, it becomes a task
(or is dropped). The dashboard shows the inbox as its own tab and updates live.
**Never** edit `.keepr/data.json` directly, always go through `keepr`.

## Commands

```bash
keepr inbox                                   # open items (--all, --status open|clarified|dropped)
keepr inbox add "Short question or note" --note "Context, who to ask" --tag docs
keepr inbox show I3
keepr inbox note I3 "What we found out"       # appends to the notes
keepr inbox update I3 --title "…" --notes "replaces the notes"
keepr inbox clarify I3 | keepr inbox drop I3 | keepr inbox reopen I3
keepr inbox task I3 --prio high --due 2026-11-01 --sub "Step 1"   # → task, item becomes clarified
keepr inbox task I3 --keep-open               # task created, item stays open
keepr inbox rm I3
```

`keepr inbox task` takes over the title and the notes as the task description unless you pass
`--title` / `--desc`. `--json` gives machine-readable output.

## Guidelines

- **No arguments** (`/inbox`): run `keepr inbox` and show the open items compactly.
- **Capture**: title as the open question or the unclear point ("Clarify: which licence
  applies to the images?"). Put context, options and who could answer it into `--note`.
  Write in the language of the conversation.
- **While clarifying**: record findings with `keepr inbox note I<n> "…"`. When the question is
  answered and nothing needs doing, `keepr inbox clarify I<n>`; if it no longer matters, `drop`.
- **When it becomes actionable**: `keepr inbox task I<n>` with a proper imperative title, a
  description with a definition of done and subtasks if useful (see the `task` skill).
- Mention other items by ID (`T5`, `A3`, `I2`) in notes; the dashboard turns them into links.
- Reply briefly: which IDs were created or changed.

If `keepr` is not on the PATH, use `node "${CLAUDE_PLUGIN_ROOT}/keepr.mjs"` instead (same arguments).
