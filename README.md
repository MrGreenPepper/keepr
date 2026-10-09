<a id="top"></a>

# keepr – keep AI answers, clarify open questions & manage tasks

A local dashboard for working with AI agents (Claude Code, Claude Desktop). No dependencies besides Node. The command is `keepr`, or `ke` for short.

- **Saved answers**: On command, the AI saves an answer together with your question, split into individual points you can check off.
- **Jump back**: "↩ Jump to session" reopens exactly that conversation in VS Code with a follow-up already prepared. "＋ Follow-up in new session" starts a new conversation with the answer as context.
- **Inbox**: a place for things that still need clarifying before they become a task (open questions, unclear ideas). Collect notes on them, and once they're clear, turn them into a task with one click.
- **Kanban-style tasks**: board and list views, status, priority, due date, tags, comments and a link to the answer or inbox item a task came from. Subtasks have their own status and description. Tasks can be linked to each other (related, blocks, blocked by). The AI manages everything via the CLI or MCP, and the dashboard updates live.
- **Pomodoro timer**: a focus timer in the dashboard that counts finished focus sessions on the task you're working on.

## Contents

- [Installation](#installation)
  - [1. Claude Code plugin](#1-claude-code-plugin)
  - [2. npm package (the keepr command)](#2-npm-package-the-keepr-command)
  - [3. Claude Desktop (optional)](#3-claude-desktop-optional)
  - [Where the data goes](#where-the-data-goes)
  - [Development setup](#development-setup)
- [Updating](#updating)
- [Using it in Claude Code](#using-it-in-claude-code)
- [Dashboard](#dashboard)
  - [Pomodoro timer](#pomodoro-timer)
- [Multiple projects](#multiple-projects)
- [CLI](#cli)
- [Claude Desktop (MCP server)](#claude-desktop-mcp-server)
  - [What an MCP server is](#what-an-mcp-server-is)
  - [Setting it up in Claude Desktop](#setting-it-up-in-claude-desktop)
  - [Differences from Claude Code](#differences-from-claude-code)
- [Files](#files)

## Installation

<sub>[↑ Back to top](#top)</sub>

keepr consists of two parts that are installed separately:

| Part | What it contains | Needed for |
|---|---|---|
| **Claude Code plugin** | the skills `keep`, `inbox`, `task`, `ref` and a bundled copy of `keepr` | Claude Code (VS Code, terminal, Code tab of Claude Desktop) |
| **npm package** | the `keepr` command (CLI, dashboard, MCP server) | `keepr dash` in your terminal, and Claude Desktop chats via MCP |

Requirement for both: [Node.js](https://nodejs.org) 18 or newer.

### 1. Claude Code plugin

<sub>[↑ Back to top](#top)</sub>

In Claude Code, run:

```
/plugin marketplace add MrGreenPepper/keepr
/plugin install keepr@keepr
```

The `/plugin` command isn't available in every environment. In the VS Code extension, for example, it answers with "/plugin isn't available in this environment". In that case run the same steps from a terminal with the `claude` CLI:

```bash
claude plugin marketplace add MrGreenPepper/keepr
claude plugin install keepr@keepr
```

Both ways install the plugin for your user, so it works in every project and every Claude Code environment (terminal, VS Code, Code tab).

Then restart Claude Code (or start a new session; in VS Code, reload the window). The skills are available in every project as `/keepr:keep`, `/keepr:inbox`, `/keepr:task` and `/keepr:ref`, and they also trigger on plain phrases like "keep this" or "merk dir das". The plugin brings its own copy of `keepr`, so this step works on its own.

To update later, see [Updating](#updating).

### 2. npm package (the `keepr` command)

<sub>[↑ Back to top](#top)</sub>

```bash
npm install -g github:MrGreenPepper/keepr --allow-git=all
```

(Since npm 12, installing from git or remote URLs is blocked by default (`EALLOWGIT` / `EALLOWREMOTE`), hence `--allow-git=all`. On older npm versions the flag is not needed.)

This puts `keepr` and its short form `ke` on your PATH on Linux, macOS and Windows. Both run the same thing, so `ke dash` is the same as `keepr dash`. Check it with `keepr --version`, open the dashboard with `keepr dash`. See [Updating](#updating) for updates. Uninstall with `npm uninstall -g @mrgreenpepper/keepr`.

### 3. Claude Desktop (optional)

<sub>[↑ Back to top](#top)</sub>

Needs step 2. Add the MCP server to `claude_desktop_config.json` and restart the app. Details in [Claude Desktop (MCP server)](#claude-desktop-mcp-server).

### Where the data goes

<sub>[↑ Back to top](#top)</sub>

Nothing is set up per project in advance. On the first save, `.keepr/data.json` is created automatically in the git root (or the current folder). Whether you commit `.keepr/` or add it to `.gitignore` is up to you. The list of known projects lives in `~/.config/keepr/projects.json`.

### Development setup

<sub>[↑ Back to top](#top)</sub>

If you're working on keepr itself, clone the repository and run `./install.sh` instead. It symlinks `keepr` into `~/.local/bin` and the skills into `~/.claude/skills`, so changes in the repository take effect immediately. The skills are then called `/keep`, `/inbox`, `/task` and `/ref` without the `keepr:` prefix. Don't install the plugin at the same time, or the skills appear twice.

## Updating

<sub>[↑ Back to top](#top)</sub>

Plugin and npm package are updated separately. Update both, so the skills and the `keepr` command are on the same version.

**1. Claude Code plugin.** In Claude Code:

```
/plugin marketplace update keepr
/plugin update keepr@keepr
```

Or from a terminal (also works where `/plugin` isn't available, e.g. in VS Code):

```bash
claude plugin marketplace update keepr
claude plugin update keepr@keepr
```

Then start a new session (in VS Code: reload the window). `claude plugin list` shows the installed version.

**2. npm package.** Run the install command again:

```bash
npm install -g github:MrGreenPepper/keepr --allow-git=all
```

`keepr --version` shows the installed version.

**3. Restart the dashboard server.** `keepr dash` starts the server in the background, and it keeps running the old code after an update. Stop it, then start it again with `keepr dash`:

```bash
pkill -f "keepr.mjs serve"                      # Linux, macOS
keepr dash
```

On Windows, end the `node` process running `keepr.mjs serve` in the Task Manager, or restart the computer.

**4. Claude Desktop (if you use the MCP server).** Restart the app, so it starts the new `keepr mcp`.

**Development setup:** run `git pull` in the repository. Changes take effect immediately because of the symlinks. If the update adds new skills, run `./install.sh` again so they are linked too. Restart the dashboard server as in step 3.

**Your data** stays as it is. `data.json` is migrated automatically when it's read: for example, subtasks from older versions get a status (done or to do) and an empty description.

## Using it in Claude Code

<sub>[↑ Back to top](#top)</sub>

With the plugin, the commands are prefixed: `/keepr:keep`, `/keepr:inbox`, `/keepr:task`, `/keepr:ref`. With the development setup they're `/keep`, `/inbox`, `/task`, `/ref`.

| You say                                     | What happens                                                     |
|---------------------------------------------|------------------------------------------------------------------|
| `/keep` or "keep this"                      | The last answer lands in the dashboard with title, summary and points |
| `/keep only point 3, follow-up on X`        | Only what you asked for is saved                                 |
| `/inbox` or "that still needs clarifying"   | Puts the open question into the inbox (or shows the inbox)       |
| "turn I3 into a task"                       | Runs `keepr inbox task I3`, the item is marked clarified            |
| `/task`                                     | Shows the open tasks                                             |
| "T5 can only start after T3"                | Runs `keepr task link T5 T3 --type blocked_by`                      |
| "create a task from point 2 of A4"          | Runs `keepr task add --from A4 --point 2`                           |
| "work through T3"                           | The AI sets T3 to in progress, checks off subtasks, comments and sets it to review |
| `/ref A4 how did … work again`              | Loads A4 as context and updates the state of its points          |
| "open the dashboard"                        | Runs `keepr dash`                                                   |

German phrases like "merk dir das", "muss noch geklärt werden" or "leg eine Aufgabe an" trigger the same skills.

## Dashboard

<sub>[↑ Back to top](#top)</sub>

```bash
keepr dash        # starts the server if needed and opens the browser
```

The address is `http://127.0.0.1:4747` (change the port with `KEEPR_PORT`). Every project where `keepr` has been used shows up in the project dropdown. Shortcuts: `/` focuses the search, `Esc` closes the detail panel.

The dashboard has three tabs:

- **Answers**: saved AI answers with their points.
- **Inbox**: things to clarify. Type into the field at the top and press Enter to capture something. Notes are Markdown. "→ Task" creates a task from the item (title and notes are taken over) and marks the item as clarified. The statuses are *open*, *clarified* and *dropped*.
- **Tasks**: board or list. In the task panel:
  - **Subtasks**: click a subtask (or ✎) to set its status and description. Subtasks in progress or in review show a badge, and ¶ marks one with a description.
  - **Links**: choose *Related to*, *Blocks* or *Blocked by* and enter a task ID or title. Links show up in both tasks. A task blocked by an unfinished task gets a ⛔ on the board.
  - **References**: IDs like `T5`, `A3` or `I2` in descriptions, notes, comments and subtasks become clickable links. Click a description to edit it.

### Pomodoro timer

<sub>[↑ Back to top](#top)</sub>

The 🍅 button in the header opens the timer: 25 minutes of focus, 5 minutes short break, and a 15 minute long break after every 4 focus sessions. All four values can be changed in the timer. "🍅 Focus" in a task panel starts a focus session on that task, or you can pick the task in the timer. Each finished focus session is counted on the task (🍅 on the card, and `keepr task show` lists them with the minutes). When a phase ends, the dashboard beeps, shows a message and sends a desktop notification if you allowed it. The next phase doesn't start on its own. The timer keeps running if you reload the page, and several dashboard tabs share it. It only runs while a dashboard tab is open.

## Multiple projects

<sub>[↑ Back to top](#top)</sub>

Each project has its own `.keepr/data.json` with its own answers and tasks. Which one gets used is decided like this:

- **Claude Code (skills and CLI):** `keepr` searches upward from the folder Claude Code is running in, so the project open in VS Code or the terminal is the one that's used. If none is found, a new one is created in the git root. Subfolders of a repository share the repository's project.
- **Claude Desktop (MCP):** A chat has no working folder. The server uses the default project from `--project` in the configuration. Otherwise Claude passes the `project` parameter, for example when you say "in project X". With several projects and no default, the server returns the list of projects so Claude can ask which one you mean.
- **Several topics in one project:** Use tags (`--tag frontend`, or "tag it with frontend") and filter in the dashboard search.
- **Overview:** `keepr projects` lists all registered projects. The registry is stored in `~/.config/keepr/projects.json`.

## CLI

<sub>[↑ Back to top](#top)</sub>

`keepr help` shows all commands. The most important ones:

```bash
keepr save --back 1 --title "…" --summary "…" --point "…" --tag x   # answer from the transcript
keepr answers | keepr show A3 | keepr point A3 2 --done | keepr answer A3 --status followup
keepr task add "Title" --prio high --due 2026-10-20 --sub "…" --from A3
keepr task list | keepr task start T1 | keepr task sub T1 2 --done | keepr task comment T1 "…" | keepr task done T1
keepr next                                              # overdue, due within 7 days, urgent/high without due date
keepr task sub T1 2 --status in_progress --desc "…"     # subtask status and description
keepr task link T1 T2 --type blocked_by | keepr task unlink T1 T2
keepr inbox add "Clarify: …" --note "…" | keepr inbox | keepr inbox note I1 "…" | keepr inbox task I1 --prio high
```

`keepr save` reads the answer directly from the Claude Code transcript (`~/.claude/projects/…`), so the AI doesn't have to retype it. It saves the answer text after the last tool call, which is the actual answer without progress messages. `--full` includes all texts of the turn, and `--stdin` lets you pass any content.

## Claude Desktop (MCP server)

<sub>[↑ Back to top](#top)</sub>

**Code tab:** The Code tab of Claude Desktop runs Claude Code. `keepr` and the skills `/keep`, `/inbox`, `/task` and `/ref` work there as described above once `install.sh` has been run. It has not been verified whether the Code tab also stores its transcripts under `~/.claude/projects`. If it doesn't, `keepr save` can't find the answer there, and you can use `keepr save --stdin` or the MCP server instead.

**Regular chat:** Here Claude can't run commands on your computer, so `keepr` isn't available. That's what the MCP server `keepr mcp` is for.

### What an MCP server is

<sub>[↑ Back to top](#top)</sub>

MCP (Model Context Protocol) is an open standard for connecting AI apps to external tools. An MCP server is a small local program that offers the AI a list of tools, each with a name, description and parameters. The logic behind them is the same as for the CLI and dashboard; the MCP server is just another way in.

`keepr mcp` offers these tools:

| Tool | Purpose |
|---|---|
| `save_answer` | Save an answer with title, summary, points and an optional chat link |
| `list_answers`, `get_answer` | List saved answers or load one in full |
| `update_answer`, `update_answer_point` | Set status, notes and new points; check off points |
| `list_tasks`, `get_task` | List tasks or load one in full |
| `next_tasks` | What to do first: overdue, due within 7 days, urgent/high without due date |
| `add_task`, `update_task` | Create and change tasks, including subtasks, links and comments |
| `update_subtask`, `delete_task` | Change a subtask's status, text or description, delete a task |
| `list_inbox`, `get_inbox_item` | List the inbox or load one item with its notes |
| `add_inbox_item`, `update_inbox_item`, `inbox_to_task` | Capture something to clarify, add notes or change its status, turn it into a task |
| `list_projects`, `open_dashboard` | Show projects, get or open the dashboard link |

### Setting it up in Claude Desktop

<sub>[↑ Back to top](#top)</sub>

1. **Requirements:** the npm package is installed (see [Installation](#2-npm-package-the-keepr-command)), so `keepr --version` works in a terminal.
2. **Register it:** *Settings → Developer → Edit Config* opens `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`). Add the server there:

   ```json
   {
     "mcpServers": {
       "keepr": {
         "command": "keepr",
         "args": ["mcp", "--project", "/path/to/my/project"]
       }
     }
   }
   ```

   If Claude Desktop can't start `keepr` (this can happen on Windows or when the npm folder isn't on the PATH of GUI apps on macOS), use Node with the full path instead: `"command": "node", "args": ["<npm root -g>/@mrgreenpepper/keepr/keepr.mjs", "mcp", …]`, where `<npm root -g>` is the output of that command.

   `--project` sets the default project. It can be a folder path or the name of a project that's already registered. A folder that isn't a keepr project yet is set up on the first save. Without `--project`: if there's only one project, it's used; otherwise Claude names the project per call.
3. **Restart:** Claude Desktop starts every registered server as a background process when the app starts, so changes to the file need an app restart. Afterwards `keepr` appears in the chat's tool list.
4. **Use it:** Claude gets the tool descriptions in every chat and uses them to recognize when a tool fits, for example `save_answer` for "keep this" or `get_answer` for "regarding A3". Claude doesn't need to know where the data lives. The server writes to the right `data.json`, and the dashboard shows changes immediately. Start the dashboard with `keepr dash`, or ask Claude to open it.

The server also works in other MCP clients, in Claude Code for example with `claude mcp add keepr -- keepr mcp`. There, the skills are the better choice, though, because `keepr save` reads the answer straight from the transcript and jumping back into the session works.

### Differences from Claude Code

<sub>[↑ Back to top](#top)</sub>

- **Answer text:** A chat isn't available as a file. Claude therefore sends the answer text itself instead of `keepr` reading it from the transcript. Long answers take a bit longer.
- **Jumping back:** Claude doesn't know the link to its own chat. If you provide it when saving ("keep this, link: …") or add it later in the dashboard via "🔗 Chat link", an "↩ Open chat" button appears. The full answer is always in the dashboard, and a follow-up works in any chat with "regarding A3".
- **Project:** A chat has no project folder, which is what the default project via `--project` is for (see [Multiple projects](#multiple-projects)).

The desktop app is only available for macOS and Windows. On Linux, use VS Code or the terminal.

## Files

<sub>[↑ Back to top](#top)</sub>

- `keepr.mjs`: CLI, HTTP server for the dashboard (`127.0.0.1` only) and MCP server (`keepr mcp`)
- `dashboard.html`: the UI
- `skills/`: Claude skills
- `.claude-plugin/`: plugin and marketplace manifests for Claude Code
- `package.json`: npm package definition (`keepr` and `ke` commands)
- `install.sh`: development setup with symlinks
- Data: `<project>/.keepr/data.json`, project registry in `~/.config/keepr/projects.json`
