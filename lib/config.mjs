// Paths, version and the allowed values of status, priority and link fields.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repository root (one level above lib/), where dashboard/ lives.
export const HERE = path.resolve(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))), '..');
export const VERSION = '1.2.0';
export const PORT = Number(process.env.KEEPR_PORT || process.env.WF_PORT || 4747);
export const CONFIG_DIR = path.join(os.homedir(), '.config', 'keepr');
export const OLD_CONFIG_DIR = path.join(os.homedir(), '.config', 'wf'); // before the rename to keepr
export const REGISTRY = path.join(CONFIG_DIR, 'projects.json');
export const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');

export const STATUSES = ['todo', 'in_progress', 'review', 'done'];
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
export const ANSWER_STATUSES = ['open', 'followup', 'done'];
export const INBOX_STATUSES = ['open', 'clarified', 'dropped'];
// Stored on the source task as relates | blocks; blocked_by is stored as "blocks" on the other task.
export const LINK_TYPES = ['relates', 'blocks', 'blocked_by'];
