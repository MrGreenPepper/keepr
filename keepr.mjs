#!/usr/bin/env node
// keepr (short: ke) – saved-answers list, inbox and task management for working with AI agents.
// No dependencies. One command, three roles: CLI (for you and the AI), local dashboard server
// (keepr serve) and MCP server (keepr mcp). The code lives in lib/, the dashboard in dashboard/.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { commands } from './lib/cli.mjs';
import { parseArgs } from './lib/format.mjs';

export { STATUSES, PRIORITIES, ANSWER_STATUSES, INBOX_STATUSES, LINK_TYPES } from './lib/config.mjs';
export { readData, mutate } from './lib/storage.mjs';
export { taskLinks, localDate, NEXT_GROUPS, nextTasks, ops } from './lib/ops.mjs';
export { toMin, fromMin, isFreeBlock, parseDate, dayBlocks } from './lib/dayplan.mjs';
export { parseTurns } from './lib/transcripts.mjs';

// ---------------------------------------------------------------- main

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const fn = commands[cmd] || (['-h', '--help'].includes(cmd) && commands.help) || (['-v', '--version'].includes(cmd) && commands.version);
  try {
    if (!fn) throw new Error(`Unknown command "${cmd}". See keepr help.`);
    fn(parseArgs(rest));
  } catch (e) {
    console.error(`keepr: ${e.message}`);
    process.exit(1);
  }
}
