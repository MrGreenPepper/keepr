# keepr – notes for AI agents working on this repo

## General-purpose tool, not tied to one project

keepr is a **general tool**, not part of any single project. It is meant to be driven from
many projects at the same time (e.g. a Master's thesis repo, other code repos, private notes)
and must work well for all of them.

- Data lives per project in `<project>/.keepr/data.json`; the list of known projects is the
  registry `~/.config/keepr/projects.json`. One dashboard server serves all registered projects
  (project switcher), the MCP server takes a `project` argument (name or path).
- Never hard-code paths, names, tags or workflows of a specific project (e.g. the Master's
  thesis) into code, skills or docs. Examples in docs stay generic.
- New features must work for any project: resolve the project via `findProjectRoot()` /
  `mcpProject()`, not via assumptions about the current working directory.
- Project-specific automation (e.g. a scheduled reminder for one project) belongs outside this
  repo, in that project or in the user's own config.

## Provider-agnostic: switching from Claude to OpenAI or another AI must stay possible

keepr should not lock the user into one AI provider. Keep the core usable from Claude, OpenAI
(Codex, ChatGPT), local models or any other agent.

- The core is provider-neutral: the CLI (`keepr …`, `--json` for machines), the dashboard and
  the MCP server (open protocol, works with any MCP client). New features go there first, so
  every agent can use them; all three share the same operations (`ops`, `nextTasks()`, …).
- Claude-specific parts are adapters and must stay optional, never required by the core:
  - `keepr save` reads Claude Code transcripts from `~/.claude/projects` (`CLAUDE_PROJECTS`);
    `--stdin` / MCP `save_answer` are the provider-neutral way in.
  - The dashboard's "Jump to session" / "Follow-up" buttons (`vscode://anthropic.claude-code/…`,
    `claude --resume`) only show up when a Claude session id exists.
  - `skills/*/SKILL.md` and `.claude-plugin/` are the Claude Code plugin packaging.
- When adding something provider-specific, put it behind such an adapter and keep a neutral
  path (CLI/MCP) for the same feature. Prefer neutral wording in tool descriptions and data
  fields (e.g. `source`, `session`) over Claude-only names.

## Conventions

- No dependencies and no build step; Node >= 18. `keepr.mjs` is only the entry point, the code
  lives in `lib/*.mjs` (ES modules, one per area), the UI in `dashboard/` (`index.html`,
  `style.css`, `js/*.js`). Keep new code in the module of its area instead of growing one file.
- `dashboard/js/*.js` are classic scripts sharing one global scope, loaded in the order of
  `index.html`: at load time a file must not call anything from a later file; start-up code goes
  into `main.js`.
- Never edit `.keepr/data.json` by hand – always go through `keepr` / the ops.
- Test with a throwaway project and an isolated home so the real registry stays untouched:
  `HOME=<tmp> node keepr.mjs …` (dashboard: `serve --port 4848`).
- Ask the user before reinstalling the global CLI, bumping the version, committing or pushing.
