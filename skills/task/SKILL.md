---
name: task
description: Manages the project tasks in the keepr dashboard (Kanban-style: status, priority, due date, subtasks with status and description, links between tasks, comments) – create, list, change status, check off, link, comment, open the dashboard. Use when the user says /task, "create a task", "add a todo", "what's next", "which tasks are open", "set T3 to done", "open the dashboard", or in German "leg eine aufgabe an", "als todo", "was steht an", "welche aufgaben sind offen", "öffne das dashboard", or when you finish work that corresponds to an open keepr task.
---

# Manage tasks (keepr)

All data lives in the project's `.keepr/data.json`; the dashboard updates live.
**Never** edit that file directly, always go through `keepr`.

## Commands

```bash
keepr task list [--all] [--status todo|in_progress|review|done] [--tag X]
keepr next                                # what to do first (overdue / due in 7 days / urgent+high without due)
keepr task show T3
keepr task add "Title" --desc "What & why, definition of done" --prio high --due 2026-10-20 \
    --tag backend --sub "Step 1" --sub "Step 2" [--from A4 [--point 2]]
keepr task update T3 --status in_progress --prio urgent --due none --title "…" --desc "…"
keepr task start T3 | keepr task review T3 | keepr task done T3 T4
keepr task sub T3 "New subtask" --desc "Details" [--status in_progress]   # add
keepr task sub T3 2 --done                # check off (--undone, --remove)
keepr task sub T3 2 --status review --desc "What is left"   # subtask status / description
keepr task link T3 T5 --type blocked_by   # T3 waits for T5 (relates | blocks | blocked_by)
keepr task unlink T3 T5
keepr task comment T3 "What was done / result"
keepr task rm T3
keepr dash                                # open the dashboard in the browser
```

Status (tasks and subtasks): `todo` → `in_progress` → `review` → `done`. Priority: `urgent | high | normal | low`.
Links show up in both tasks; a task that is `blocked_by` an unfinished task gets a ⛔ in the dashboard.
`--json` gives machine-readable output.

## Guidelines

- **No arguments** (`/task`): run `keepr task list` and show the open tasks compactly
  (grouped by status, highlight overdue ones).
- **"What's next" / "was steht an" / "was zuerst"**: run `keepr next` and show its three groups
  (overdue, due within 7 days, urgent/high without a due date) in that order.
- **New task**: title in the imperative ("Fix login bug"). Description with context and a
  definition of done. Split larger tasks into subtasks. Set priority and due date only if the
  user names them or they are obvious. Write in the language of the conversation.
- If the task comes from a saved answer, set `--from A<n>` (and `--point <nr>` if applicable).
  If it comes from an inbox item, use `keepr inbox task I<n>` instead of `keepr task add`.
- Dependencies: if a task can only start after another one, link it with `--type blocked_by`;
  for loosely related tasks use `relates`. Mention IDs (`T5`, `A3`, `I2`) in descriptions and
  comments, the dashboard turns them into links.
- Not clear yet whether something is a task, or a question has to be answered first: put it
  into the inbox (`inbox` skill) instead of creating a vague task.
- **When you work on a task yourself**: `keepr task start T<n>` at the start, set the subtask you
  are working on to `--status in_progress` and check off subtasks as you finish them, at the end add a result comment and run `keepr task review T<n>` (the user
  sets it to `done`) – unless the user tells you to close it directly.
- Create several tasks in one Bash call joined with `&&`.
- Reply briefly: which IDs were created/changed.

If `keepr` is not on the PATH, use `node "${CLAUDE_PLUGIN_ROOT}/keepr.mjs"` instead (same arguments).
