// Argument parsing and plain-text output for the CLI.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { PORT } from './config.mjs';
import { findProjectRoot, defaultProjectRoot, initProject, register } from './storage.mjs';
import { taskLinks, NEXT_GROUPS } from './ops.mjs';
import { toMin, isFreeBlock, dayBlocks } from './dayplan.mjs';

// ---------------------------------------------------------------- CLI helpers

const REPEATABLE = new Set(['point', 'sub', 'tag']);
const BOOLEAN = new Set(['free', 'json', 'all', 'full', 'stdin', 'no-open', 'done', 'undone', 'remove', 'help', 'ai', 'keep-open']);

export function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    let [k, v] = a.slice(2).split(/=(.*)/s);
    if (v === undefined && !BOOLEAN.has(k)) v = argv[++i];
    if (v === undefined) v = true;
    if (REPEATABLE.has(k)) (opt[k] ??= []).push(v);
    else opt[k] = v;
  }
  return { pos, opt };
}

export function tagsOf(opt) {
  return (opt.tag || []).flatMap(t => String(t).split(',')).map(t => t.trim()).filter(Boolean);
}

export function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

export function requireRoot({ create = false } = {}) {
  const root = findProjectRoot();
  if (root) { register(root); return root; }
  if (create) return initProject(defaultProjectRoot());
  throw new Error('No keepr project found. Run "keepr init" first (or save something).');
}

export function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

export function dashUrl(root, hash = '') {
  return `http://127.0.0.1:${PORT}/?p=${encodeURIComponent(root)}${hash ? '#' + hash : ''}`;
}

const PRIO_ICON = { urgent: '!!!', high: '!! ', normal: '   ', low: ' ↓ ' };

export function fmtTask(t) {
  const subs = t.subtasks.length ? ` [${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}]` : '';
  const due = t.due ? ` (due ${t.due})` : '';
  const tags = t.tags.length ? ` #${t.tags.join(' #')}` : '';
  const ref = [t.answerId, t.inboxId].filter(Boolean).map(x => ` ←${x}`).join('');
  const pomo = t.pomodoros ? ` 🍅${t.pomodoros}` : '';
  return `${t.id.padEnd(5)} ${PRIO_ICON[t.priority] || '   '} ${t.status.padEnd(11)} ${t.title}${subs}${due}${tags}${ref}${pomo}`;
}

export function fmtNext(groups) {
  const parts = Object.entries(NEXT_GROUPS).filter(([k]) => groups[k].length)
    .map(([k, label]) => `${label} (${groups[k].length})\n${groups[k].map(t => `  ${fmtTask(t)}`).join('\n')}`);
  return parts.join('\n\n') || '(nothing due – no overdue, upcoming or urgent tasks)';
}

// Day plan as text, plus the free windows – shared by keepr plan and the MCP tools.
export function fmtBlock(b, data) {
  const t = b.taskId && data.tasks.find(x => x.id === b.taskId);
  const what = isFreeBlock(b) ? '· free window ·'
    : t ? `${t.id} ${b.title || t.title}${t.status === 'done' ? ' (task done)' : ''}` : b.title;
  return `${b.id.padEnd(4)} ${b.start}–${b.end}  [${b.done ? 'x' : ' '}] ${what}${b.note ? `  – ${b.note}` : ''}`;
}
export function fmtPlan(data, date) {
  const blocks = dayBlocks(data, date);
  const mins = (f) => blocks.filter(f).reduce((n, b) => n + toMin(b.end) - toMin(b.start), 0);
  const h = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
  const head = `Day plan ${date} – planned ${h(mins(b => !isFreeBlock(b)))}, free ${h(mins(isFreeBlock))}`;
  return `${head}\n${blocks.map(b => fmtBlock(b, data)).join('\n') || '(nothing planned yet)'}`;
}

const SUB_BOX = { todo: ' ', in_progress: '~', review: '?', done: 'x' };
const LINK_LABEL = { relates: 'relates to', blocks: 'blocks', blocked_by: 'blocked by' };

function fmtSub(s) {
  const status = s.status === 'todo' || s.status === 'done' ? '' : `  (${s.status})`;
  const desc = s.description ? '\n' + s.description.split('\n').map(l => `       ${l}`).join('\n') : '';
  return `  ${s.id}. [${SUB_BOX[s.status] || ' '}] ${s.text}${status}${desc}`;
}

export function fmtInbox(i) {
  const tasks = i.taskIds.length ? ` →${i.taskIds.join(',')}` : '';
  const tags = i.tags.length ? ` #${i.tags.join(' #')}` : '';
  return `${i.id.padEnd(5)} ${i.status.padEnd(9)} ${i.createdAt.slice(0, 10)} ${i.title}${tags}${tasks}`;
}

export function showInbox(i) {
  const lines = [fmtInbox(i)];
  if (i.origin) lines.push('', `Origin: ${i.origin}`);
  if (i.notes) lines.push('', i.notes);
  return lines.join('\n');
}

export function fmtAnswer(a) {
  const open = a.points.filter(p => !p.done).length;
  const pts = a.points.length ? ` [${open} open]` : '';
  return `${a.id.padEnd(5)} ${a.status.padEnd(8)} ${a.createdAt.slice(0, 10)} ${a.title}${pts}`;
}

export function showTask(t, data) {
  const lines = [fmtTask(t)];
  if (t.origin) lines.push('', `Origin: ${t.origin}`);
  if (t.description) lines.push('', t.description);
  const links = taskLinks(data, t);
  if (links.length) lines.push('', 'Links:', ...links.map(l => {
    const x = data.tasks.find(y => y.id === l.id);
    return `  ${LINK_LABEL[l.rel]} ${l.id}${x ? ` – ${x.title} (${x.status})` : ''}`;
  }));
  if (t.subtasks.length) lines.push('', 'Subtasks ([~] in progress, [?] review):', ...t.subtasks.map(fmtSub));
  if (t.pomodoros) lines.push('', `Pomodoros: ${t.pomodoros} (${t.focusMinutes || 0} min focus)`);
  if (t.comments.length) lines.push('', 'Comments:', ...t.comments.map(c => `  ${c.at.slice(0, 16)} ${c.author}: ${c.text}`));
  return lines.join('\n');
}

export function showAnswer(a) {
  const lines = [`${a.id} – ${a.title}  (${a.status}, ${a.createdAt.slice(0, 16)})`];
  if (a.tags.length) lines.push(`Tags: ${a.tags.join(', ')}`);
  if (a.session) lines.push(`Session: ${a.session}`);
  if (a.origin) lines.push('', '## Origin', a.origin);
  if (a.prompt) lines.push('', '## Question', a.prompt);
  lines.push('', '## Answer', a.content);
  if (a.points.length) lines.push('', '## Points', ...a.points.map(p => `${p.id}. [${p.done ? 'x' : ' '}] ${p.text}`));
  if (a.notes) lines.push('', '## Notes', a.notes);
  return lines.join('\n');
}

export const out = (opt, obj, text) => console.log(opt.json ? JSON.stringify(obj, null, 2) : text);
