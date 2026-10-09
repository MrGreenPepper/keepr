#!/usr/bin/env node
// keepr (short: ke) – saved-answers list, inbox and task management for working with AI agents.
// Single file, no dependencies. CLI (for you and the AI) + local dashboard server + MCP server.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
const VERSION = '1.1.0';
const PORT = Number(process.env.KEEPR_PORT || process.env.WF_PORT || 4747);
const CONFIG_DIR = path.join(os.homedir(), '.config', 'keepr');
const OLD_CONFIG_DIR = path.join(os.homedir(), '.config', 'wf'); // before the rename to keepr
const REGISTRY = path.join(CONFIG_DIR, 'projects.json');
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');

export const STATUSES = ['todo', 'in_progress', 'review', 'done'];
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
export const ANSWER_STATUSES = ['open', 'followup', 'done'];
export const INBOX_STATUSES = ['open', 'clarified', 'dropped'];
// Stored on the source task as relates | blocks; blocked_by is stored as "blocks" on the other task.
export const LINK_TYPES = ['relates', 'blocks', 'blocked_by'];

// ---------------------------------------------------------------- storage

const now = () => new Date().toISOString();

function emptyData(name) {
  return { version: 1, name, counters: { A: 0, T: 0, I: 0 }, answers: [], tasks: [], inbox: [] };
}

// New projects use .keepr/; projects created before the rename keep their .workflow/ folder.
function dataFile(root) {
  const old = path.join(root, '.workflow', 'data.json');
  const file = path.join(root, '.keepr', 'data.json');
  return !fs.existsSync(file) && fs.existsSync(old) ? old : file;
}

function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(dataFile(dir))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// New project: git root if there is one, otherwise the current directory.
function defaultProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

function initProject(root) {
  const file = dataFile(root);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeData(root, emptyData(path.basename(root)));
  }
  register(root);
  return root;
}

export function readData(root) {
  const d = JSON.parse(fs.readFileSync(dataFile(root), 'utf8'));
  d.counters ??= { A: 0, T: 0 };
  d.counters.I ??= 0;
  d.answers ??= [];
  d.tasks ??= [];
  d.inbox ??= [];
  for (const t of d.tasks) {
    t.links ??= [];
    for (const st of t.subtasks || []) {
      st.status ??= st.done ? 'done' : 'todo';
      st.description ??= '';
    }
  }
  return d;
}

function writeData(root, data) {
  const file = dataFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Reads fresh, applies fn, writes back atomically.
export function mutate(root, fn) {
  const data = readData(root);
  const result = fn(data);
  writeData(root, data);
  return result;
}

function readRegistry() {
  // One-time move of the project list from ~/.config/wf (before the rename).
  const old = path.join(OLD_CONFIG_DIR, 'projects.json');
  if (!fs.existsSync(REGISTRY) && fs.existsSync(old)) {
    try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); fs.copyFileSync(old, REGISTRY); } catch {}
  }
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch { return []; }
}

function register(root) {
  const list = readRegistry().filter(p => fs.existsSync(dataFile(p.path)));
  if (!list.some(p => p.path === root)) list.push({ path: root, name: path.basename(root) });
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(list, null, 2));
}

// ---------------------------------------------------------------- operations
// Shared by the CLI, the dashboard and the MCP server.

function nextId(data, prefix) {
  data.counters[prefix] = (data.counters[prefix] || 0) + 1;
  return `${prefix}${data.counters[prefix]}`;
}

function getAnswer(data, id) {
  const a = data.answers.find(x => x.id.toLowerCase() === String(id).toLowerCase());
  if (!a) throw new Error(`Answer ${id} not found`);
  return a;
}

function getTask(data, id) {
  const t = data.tasks.find(x => x.id.toLowerCase() === String(id).toLowerCase());
  if (!t) throw new Error(`Task ${id} not found`);
  return t;
}

function getInbox(data, id) {
  const i = data.inbox.find(x => x.id.toLowerCase() === String(id).toLowerCase());
  if (!i) throw new Error(`Inbox item ${id} not found`);
  return i;
}

function checkEnum(value, allowed, what) {
  if (value !== undefined && !allowed.includes(value))
    throw new Error(`Invalid ${what} "${value}". Allowed: ${allowed.join(', ')}`);
}

function listItems(texts) {
  return (texts || []).filter(Boolean).map((text, i) => ({ id: i + 1, text, done: false }));
}

function appendItem(list, text) {
  const id = list.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  list.push({ id, text, done: false });
  return id;
}

// Subtasks: a string (title only) or { text, description, status }.
function subtaskItem(id, s) {
  const o = typeof s === 'string' ? { text: s } : s;
  if (!o.text) throw new Error('Subtask text missing');
  checkEnum(o.status, STATUSES, 'subtask status');
  const status = o.status || 'todo';
  return { id, text: o.text, description: o.description || '', status, done: status === 'done' };
}

// Links of a task in both directions: [{ id, rel: relates | blocks | blocked_by }].
export function taskLinks(data, t) {
  const out = (t.links || []).map(l => ({ id: l.to, rel: l.type }));
  for (const x of data.tasks) for (const l of x.links || [])
    if (l.to === t.id) out.push({ id: x.id, rel: l.type === 'blocks' ? 'blocked_by' : 'relates' });
  return out;
}

// Local calendar date as YYYY-MM-DD (not UTC), optionally shifted by `days`.
export function localDate(days = 0, base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "Next up" reminder: open tasks that are overdue, due within 7 days, or urgent/high without a due date.
// Single source of truth – the CLI (keepr next), the MCP tool and the dashboard (via /api/data) use it.
export const NEXT_GROUPS = { overdue: 'Overdue', soon: 'Due in the next 7 days', urgent: 'Urgent/high, no due date' };
export function nextTasks(tasks, today = localDate()) {
  const horizon = localDate(7, new Date(today + 'T00:00'));
  const groups = { overdue: [], soon: [], urgent: [] };
  for (const t of tasks) {
    if (t.status === 'done') continue;
    if (t.due && t.due < today) groups.overdue.push(t);
    else if (t.due && t.due <= horizon) groups.soon.push(t);
    else if (!t.due && (t.priority === 'urgent' || t.priority === 'high')) groups.urgent.push(t);
  }
  const cmp = (a, b) => (a.due || '').localeCompare(b.due || '')
    || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || (a.order || 0) - (b.order || 0);
  for (const g of Object.values(groups)) g.sort(cmp);
  return groups;
}

function getItem(list, id, what) {
  const item = list.find(x => x.id === Number(id));
  if (!item) throw new Error(`${what} ${id} not found`);
  return item;
}

export const ops = {
  'answer.add'(data, a) {
    const answer = {
      id: nextId(data, 'A'),
      title: a.title || firstLine(a.content) || 'Untitled',
      summary: a.summary || '',
      prompt: a.prompt || '',
      content: a.content || '',
      session: a.session || null,
      messageUuid: a.messageUuid || null,
      chatUrl: a.chatUrl || null,
      source: a.source || (a.session ? 'claude-code' : null),
      status: 'open',
      tags: a.tags || [],
      points: listItems(a.points),
      notes: '',
      createdAt: now(),
      updatedAt: now(),
    };
    data.answers.unshift(answer);
    return answer;
  },
  'answer.update'(data, { id, patch }) {
    const a = getAnswer(data, id);
    checkEnum(patch.status, ANSWER_STATUSES, 'status');
    for (const k of ['title', 'summary', 'status', 'tags', 'notes', 'chatUrl']) if (patch[k] !== undefined) a[k] = patch[k];
    a.updatedAt = now();
    return a;
  },
  'answer.delete'(data, { id }) {
    const a = getAnswer(data, id);
    data.answers = data.answers.filter(x => x !== a);
    return a;
  },
  'answer.point.add'(data, { id, text }) {
    const a = getAnswer(data, id);
    appendItem(a.points, text);
    a.updatedAt = now();
    return a;
  },
  'answer.point.update'(data, { id, point, done, text, remove }) {
    const a = getAnswer(data, id);
    const p = getItem(a.points, point, 'Point');
    if (remove) a.points = a.points.filter(x => x !== p);
    if (done !== undefined) p.done = !!done;
    if (text !== undefined) p.text = text;
    if (a.points.length && a.points.every(x => x.done) && a.status !== 'done') a.status = 'done';
    a.updatedAt = now();
    return a;
  },
  'task.add'(data, t) {
    checkEnum(t.status, STATUSES, 'status');
    checkEnum(t.priority, PRIORITIES, 'priority');
    if (t.answerId) getAnswer(data, t.answerId);
    const status = t.status || 'todo';
    const task = {
      id: nextId(data, 'T'),
      title: t.title,
      description: t.description || '',
      status,
      priority: t.priority || 'normal',
      due: t.due || null,
      tags: t.tags || [],
      answerId: t.answerId || null,
      answerPoint: t.answerPoint ?? null,
      inboxId: t.inboxId || null,
      subtasks: (t.subtasks || []).filter(Boolean).map((x, i) => subtaskItem(i + 1, x)),
      links: [],
      comments: [],
      order: Math.max(0, ...data.tasks.filter(x => x.status === status).map(x => x.order || 0)) + 1,
      createdAt: now(),
      updatedAt: now(),
      doneAt: status === 'done' ? now() : null,
    };
    if (!task.title) throw new Error('Title missing');
    data.tasks.push(task);
    for (const l of t.links || []) ops['task.link'](data, { id: task.id, to: l.to ?? l.task, type: l.type });
    return task;
  },
  'task.update'(data, { id, patch }) {
    const t = getTask(data, id);
    checkEnum(patch.status, STATUSES, 'status');
    checkEnum(patch.priority, PRIORITIES, 'priority');
    if (patch.answerId) getAnswer(data, patch.answerId);
    if (patch.status && patch.status !== t.status) {
      t.doneAt = patch.status === 'done' ? now() : null;
      if (patch.order === undefined)
        t.order = Math.max(0, ...data.tasks.filter(x => x.status === patch.status).map(x => x.order || 0)) + 1;
    }
    for (const k of ['title', 'description', 'status', 'priority', 'due', 'tags', 'answerId', 'order'])
      if (patch[k] !== undefined) t[k] = patch[k];
    t.updatedAt = now();
    return t;
  },
  'task.delete'(data, { id }) {
    const t = getTask(data, id);
    data.tasks = data.tasks.filter(x => x !== t);
    for (const x of data.tasks) x.links = (x.links || []).filter(l => l.to !== t.id);
    return t;
  },
  'task.sub.add'(data, { id, text, description, status }) {
    const t = getTask(data, id);
    t.subtasks.push(subtaskItem(t.subtasks.reduce((m, x) => Math.max(m, x.id), 0) + 1, { text, description, status }));
    t.updatedAt = now();
    return t;
  },
  'task.sub.update'(data, { id, sub, done, text, description, status, remove }) {
    const t = getTask(data, id);
    const s = getItem(t.subtasks, sub, 'Subtask');
    checkEnum(status, STATUSES, 'subtask status');
    if (remove) t.subtasks = t.subtasks.filter(x => x !== s);
    if (done !== undefined) status = done ? 'done' : s.status === 'done' ? 'todo' : s.status;
    if (status !== undefined) { s.status = status; s.done = status === 'done'; }
    if (text !== undefined) s.text = text;
    if (description !== undefined) s.description = description;
    t.updatedAt = now();
    return t;
  },
  // One link per pair of tasks; linking again replaces the type.
  'task.link'(data, { id, to, type = 'relates' }) {
    checkEnum(type, LINK_TYPES, 'link type');
    let from = getTask(data, id), target = getTask(data, to);
    if (from === target) throw new Error('A task cannot link to itself');
    ops['task.unlink'](data, { id: from.id, to: target.id });
    if (type === 'blocked_by') [from, target, type] = [target, from, 'blocks'];
    from.links.push({ to: target.id, type });
    from.updatedAt = target.updatedAt = now();
    return getTask(data, id);
  },
  'task.unlink'(data, { id, to }) {
    const a = getTask(data, id), b = getTask(data, to);
    a.links = a.links.filter(l => l.to !== b.id);
    b.links = b.links.filter(l => l.to !== a.id);
    a.updatedAt = b.updatedAt = now();
    return a;
  },
  // A finished pomodoro (focus session) on this task.
  'task.pomodoro'(data, { id, minutes = 25 }) {
    const t = getTask(data, id);
    t.pomodoros = (t.pomodoros || 0) + 1;
    t.focusMinutes = (t.focusMinutes || 0) + Number(minutes);
    return t;
  },
  'task.comment'(data, { id, text, author = 'user' }) {
    const t = getTask(data, id);
    t.comments.push({ at: now(), author, text });
    t.updatedAt = now();
    return t;
  },
  // Board drag & drop: set the status and rewrite the column order.
  'task.move'(data, { id, status, orderedIds }) {
    const t = getTask(data, id);
    ops['task.update'](data, { id, patch: { status } });
    (orderedIds || []).forEach((tid, i) => {
      const x = data.tasks.find(y => y.id === tid);
      if (x) x.order = i + 1;
    });
    return t;
  },
  'inbox.add'(data, { title, notes, tags }) {
    if (!title) throw new Error('Title missing');
    const item = {
      id: nextId(data, 'I'), title, notes: notes || '', status: 'open', tags: tags || [], taskIds: [],
      createdAt: now(), updatedAt: now(),
    };
    data.inbox.unshift(item);
    return item;
  },
  'inbox.update'(data, { id, patch }) {
    const i = getInbox(data, id);
    checkEnum(patch.status, INBOX_STATUSES, 'status');
    for (const k of ['title', 'notes', 'status', 'tags']) if (patch[k] !== undefined) i[k] = patch[k];
    i.updatedAt = now();
    return i;
  },
  'inbox.delete'(data, { id }) {
    const i = getInbox(data, id);
    data.inbox = data.inbox.filter(x => x !== i);
    return i;
  },
  // Turns an inbox item into a task; the item counts as clarified unless keepOpen.
  'inbox.toTask'(data, { id, keepOpen, ...t }) {
    const i = getInbox(data, id);
    const task = ops['task.add'](data, {
      ...t, title: t.title || i.title, description: t.description ?? i.notes, tags: t.tags || i.tags, inboxId: i.id,
    });
    i.taskIds.push(task.id);
    if (!keepOpen) i.status = 'clarified';
    i.updatedAt = now();
    return task;
  },
};

function firstLine(s) {
  const line = (s || '').split('\n').map(l => l.replace(/^[#>*\-\s`]+/, '').trim()).find(Boolean) || '';
  return line.length > 80 ? line.slice(0, 77) + '…' : line;
}

// ---------------------------------------------------------------- Claude transcripts

function sessionTranscript(session) {
  if (!fs.existsSync(CLAUDE_PROJECTS)) return null;
  for (const dir of fs.readdirSync(CLAUDE_PROJECTS)) {
    const f = path.join(CLAUDE_PROJECTS, dir, `${session}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function latestTranscript(cwd) {
  const dir = path.join(CLAUDE_PROJECTS, path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'));
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
    .map(f => ({ f: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files[0]?.f || null;
}

function cleanPrompt(text) {
  return text
    .replace(/<(system-reminder|ide_opened_file|ide_selection|ide_diagnostics)>[\s\S]*?<\/\1>/g, '')
    .replace(/<command-(name|message|args)>([\s\S]*?)<\/command-\1>/g, (_, k, v) => (k === 'args' ? v : k === 'name' ? v + ' ' : ''))
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, '[pasted text]')
    .trim();
}

// Splits a transcript into turns: user prompt + the AI's final answer.
export function parseTurns(file) {
  const turns = [];
  let cur = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain) continue;
    const content = e.message?.content;
    if (e.type === 'user' && !e.isMeta) {
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content || [];
      if (blocks.some(b => b.type === 'tool_result')) continue;
      const prompt = cleanPrompt(blocks.filter(b => b.type === 'text').map(b => b.text).join('\n'));
      if (!prompt) continue;
      cur = { prompt, uuid: e.uuid, at: e.timestamp, all: [], tail: [], tailUuid: null };
      turns.push(cur);
    } else if (e.type === 'assistant' && cur && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'tool_use') cur.tail = [];
        if (b.type === 'text' && b.text.trim()) {
          if (!cur.tail.length) cur.tailUuid = e.uuid;
          cur.tail.push(b.text);
          cur.all.push(b.text);
        }
      }
    }
  }
  return turns.map(t => ({ prompt: t.prompt, uuid: t.uuid, at: t.at, answer: t.tail.join('\n\n'), full: t.all.join('\n\n'), answerUuid: t.tailUuid }));
}

// ---------------------------------------------------------------- CLI helpers

const REPEATABLE = new Set(['point', 'sub', 'tag']);
const BOOLEAN = new Set(['json', 'all', 'full', 'stdin', 'no-open', 'done', 'undone', 'remove', 'help', 'ai', 'keep-open']);

function parseArgs(argv) {
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

function tagsOf(opt) {
  return (opt.tag || []).flatMap(t => String(t).split(',')).map(t => t.trim()).filter(Boolean);
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function requireRoot({ create = false } = {}) {
  const root = findProjectRoot();
  if (root) { register(root); return root; }
  if (create) return initProject(defaultProjectRoot());
  throw new Error('No keepr project found. Run "keepr init" first (or save something).');
}

function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

function dashUrl(root, hash = '') {
  return `http://127.0.0.1:${PORT}/?p=${encodeURIComponent(root)}${hash ? '#' + hash : ''}`;
}

const PRIO_ICON = { urgent: '!!!', high: '!! ', normal: '   ', low: ' ↓ ' };

function fmtTask(t) {
  const subs = t.subtasks.length ? ` [${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}]` : '';
  const due = t.due ? ` (due ${t.due})` : '';
  const tags = t.tags.length ? ` #${t.tags.join(' #')}` : '';
  const ref = [t.answerId, t.inboxId].filter(Boolean).map(x => ` ←${x}`).join('');
  const pomo = t.pomodoros ? ` 🍅${t.pomodoros}` : '';
  return `${t.id.padEnd(5)} ${PRIO_ICON[t.priority] || '   '} ${t.status.padEnd(11)} ${t.title}${subs}${due}${tags}${ref}${pomo}`;
}

function fmtNext(groups) {
  const parts = Object.entries(NEXT_GROUPS).filter(([k]) => groups[k].length)
    .map(([k, label]) => `${label} (${groups[k].length})\n${groups[k].map(t => `  ${fmtTask(t)}`).join('\n')}`);
  return parts.join('\n\n') || '(nothing due – no overdue, upcoming or urgent tasks)';
}

const SUB_BOX = { todo: ' ', in_progress: '~', review: '?', done: 'x' };
const LINK_LABEL = { relates: 'relates to', blocks: 'blocks', blocked_by: 'blocked by' };

function fmtSub(s) {
  const status = s.status === 'todo' || s.status === 'done' ? '' : `  (${s.status})`;
  const desc = s.description ? '\n' + s.description.split('\n').map(l => `       ${l}`).join('\n') : '';
  return `  ${s.id}. [${SUB_BOX[s.status] || ' '}] ${s.text}${status}${desc}`;
}

function fmtInbox(i) {
  const tasks = i.taskIds.length ? ` →${i.taskIds.join(',')}` : '';
  const tags = i.tags.length ? ` #${i.tags.join(' #')}` : '';
  return `${i.id.padEnd(5)} ${i.status.padEnd(9)} ${i.createdAt.slice(0, 10)} ${i.title}${tags}${tasks}`;
}

function showInbox(i) {
  const lines = [fmtInbox(i)];
  if (i.notes) lines.push('', i.notes);
  return lines.join('\n');
}

function fmtAnswer(a) {
  const open = a.points.filter(p => !p.done).length;
  const pts = a.points.length ? ` [${open} open]` : '';
  return `${a.id.padEnd(5)} ${a.status.padEnd(8)} ${a.createdAt.slice(0, 10)} ${a.title}${pts}`;
}

function showTask(t, data) {
  const lines = [fmtTask(t)];
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

function showAnswer(a) {
  const lines = [`${a.id} – ${a.title}  (${a.status}, ${a.createdAt.slice(0, 16)})`];
  if (a.tags.length) lines.push(`Tags: ${a.tags.join(', ')}`);
  if (a.session) lines.push(`Session: ${a.session}`);
  if (a.prompt) lines.push('', '## Question', a.prompt);
  lines.push('', '## Answer', a.content);
  if (a.points.length) lines.push('', '## Points', ...a.points.map(p => `${p.id}. [${p.done ? 'x' : ' '}] ${p.text}`));
  if (a.notes) lines.push('', '## Notes', a.notes);
  return lines.join('\n');
}

const out = (opt, obj, text) => console.log(opt.json ? JSON.stringify(obj, null, 2) : text);

// ---------------------------------------------------------------- CLI commands

const HELP = `keepr (short: ke) – keep AI answers, clarify open questions & manage tasks

Project
  keepr init                      create .keepr/ in the project (git root or cwd)
  keepr dash                      open the dashboard in the browser (starts the server if needed)
  keepr serve [--port 4747]       run the dashboard server in the foreground
  keepr projects                  list registered projects
  keepr mcp [--project P]         MCP server (stdio) for Claude Desktop & co.
  keepr version                   print the version

Answers (A…)
  keepr save [--back N] [--title T] [--summary S] [--point P]... [--tag X]... [--full]
          Saves an AI answer from the current Claude transcript.
          --back 1 = previous answer (default inside Claude), 0 = latest.
          --stdin: read the content from stdin instead.  --session ID: another session.
  keepr answers [--status open|followup|done] [--all]
  keepr show A3                   full answer incl. question, points, notes
  keepr answer A3 [--status S] [--title T] [--note N] [--tag X]
  keepr point A3 "text"           add a point
  keepr point A3 2 --done|--undone|--remove

Tasks (T…)
  keepr task add "title" [--desc D] [--prio urgent|high|normal|low] [--due YYYY-MM-DD]
                 [--status todo|in_progress|review|done] [--tag X]... [--sub S]... [--from A3 [--point 2]]
  keepr task list [--status S] [--tag X] [--all]  (without --all: hides done tasks)
  keepr next                      what to do first: overdue, due within 7 days, urgent/high without due date
  keepr task show T3
  keepr task update T3 [--title] [--desc] [--prio] [--due|none] [--status] [--tag X]...
  keepr task start|review|done T3
  keepr task sub T3 "text" [--desc D] [--status S]   add a subtask
  keepr task sub T3 2 --done|--undone|--remove|--status S|--desc D|--text T
  keepr task link T3 T5 [--type relates|blocks|blocked_by]   (T3 blocks T5 / is blocked by T5)
  keepr task unlink T3 T5
  keepr task comment T3 "text" [--ai]
  keepr task rm T3

Inbox (I…) – things to clarify before they become a task
  keepr inbox [list] [--status open|clarified|dropped] [--all]
  keepr inbox add "what needs clarifying" [--note N] [--tag X]...
  keepr inbox show I3
  keepr inbox note I3 "text"      append to the notes
  keepr inbox update I3 [--title T] [--notes N] [--status S] [--tag X]...
  keepr inbox clarify|drop|reopen I3
  keepr inbox task I3 [--title T] [--desc D] [--prio P] [--due D] [--sub S]... [--keep-open]
                                  create a task from it (marks it clarified)
  keepr inbox rm I3

Everywhere: --json for machine-readable output.`;

const commands = {
  help() { console.log(HELP); },

  version() { console.log(VERSION); },

  init() {
    const root = initProject(findProjectRoot() || defaultProjectRoot());
    console.log(`keepr project: ${root}\nDashboard: ${dashUrl(root)}`);
  },

  projects({ opt }) {
    const list = readRegistry();
    out(opt, list, list.map(p => `${p.name.padEnd(24)} ${p.path}`).join('\n') || '(none)');
  },

  save({ opt }) {
    const root = requireRoot({ create: true });
    let entry;
    if (opt.stdin) {
      entry = { content: readStdin().trim(), session: opt.session || process.env.CLAUDE_CODE_SESSION_ID || null };
    } else {
      const session = opt.session || process.env.CLAUDE_CODE_SESSION_ID;
      const file = session ? sessionTranscript(session) : latestTranscript(process.cwd());
      if (!file) throw new Error('No Claude transcript found. Use --stdin to pass the content directly.');
      const turns = parseTurns(file);
      const back = Number(opt.back ?? (process.env.CLAUDECODE ? 1 : 0));
      const turn = turns[turns.length - 1 - back];
      if (!turn) throw new Error(`No answer found ${back} turns back (${turns.length} turns in the transcript).`);
      const content = opt.full ? turn.full : turn.answer;
      if (!content) throw new Error('This turn contains no answer text.');
      entry = { content, prompt: turn.prompt, session: path.basename(file, '.jsonl'), messageUuid: turn.answerUuid };
    }
    if (!entry.content) throw new Error('Empty content.');
    const a = mutate(root, d => ops['answer.add'](d, {
      ...entry, title: opt.title, summary: opt.summary, tags: tagsOf(opt), points: opt.point,
    }));
    out(opt, a, `Saved: ${a.id} – ${a.title}${a.points.length ? ` (${a.points.length} points)` : ''}\n${dashUrl(root, a.id)}`);
  },

  answers({ opt }) {
    const d = readData(requireRoot());
    let list = d.answers;
    if (opt.status) list = list.filter(a => a.status === opt.status);
    else if (!opt.all) list = list.filter(a => a.status !== 'done');
    out(opt, list, list.map(fmtAnswer).join('\n') || '(none)');
  },

  show({ pos, opt }) {
    const d = readData(requireRoot());
    const id = pos[0];
    if (!id) throw new Error('ID missing, e.g. keepr show A3');
    if (/^t/i.test(id)) { const t = getTask(d, id); return out(opt, t, showTask(t, d)); }
    if (/^i/i.test(id)) { const i = getInbox(d, id); return out(opt, i, showInbox(i)); }
    const a = getAnswer(d, id);
    out(opt, a, showAnswer(a));
  },

  answer({ pos, opt }) {
    const root = requireRoot();
    const patch = { status: opt.status, title: opt.title, summary: opt.summary };
    if (opt.tag) patch.tags = tagsOf(opt);
    const a = mutate(root, d => {
      if (opt.note) {
        const cur = getAnswer(d, pos[0]).notes;
        patch.notes = cur ? `${cur}\n${opt.note}` : opt.note;
      }
      return ops['answer.update'](d, { id: pos[0], patch });
    });
    out(opt, a, fmtAnswer(a));
  },

  point({ pos, opt }) {
    const root = requireRoot();
    const [id, arg] = pos;
    const a = mutate(root, d => /^\d+$/.test(arg || '') && (opt.done || opt.undone || opt.remove)
      ? ops['answer.point.update'](d, { id, point: arg, done: opt.done ? true : opt.undone ? false : undefined, remove: opt.remove })
      : ops['answer.point.add'](d, { id, text: pos.slice(1).join(' ') }));
    out(opt, a, a.points.map(p => `${p.id}. [${p.done ? 'x' : ' '}] ${p.text}`).join('\n'));
  },

  task({ pos, opt }) {
    const [sub, ...rest] = pos;
    const fn = taskCommands[sub || 'list'];
    if (!fn) throw new Error(`Unknown: keepr task ${sub}. See keepr help.`);
    fn({ pos: rest, opt });
  },

  inbox({ pos, opt }) {
    const [sub, ...rest] = pos;
    const fn = inboxCommands[sub || 'list'];
    if (!fn) throw new Error(`Unknown: keepr inbox ${sub}. See keepr help.`);
    fn({ pos: rest, opt });
  },

  dash({ opt }) {
    const root = findProjectRoot();
    if (root) register(root);
    const url = root ? dashUrl(root) : `http://127.0.0.1:${PORT}/`;
    ensureServer().then(() => {
      console.log(url);
      if (!opt['no-open']) openInBrowser(url);
    });
  },

  serve({ opt }) { serve(Number(opt.port || PORT)); },

  next({ opt }) {
    const groups = nextTasks(readData(requireRoot()).tasks);
    out(opt, groups, fmtNext(groups));
  },

  mcp({ opt }) { mcpServer(opt.project); },
};

const taskCommands = {
  add({ pos, opt }) {
    const root = requireRoot({ create: true });
    const t = mutate(root, d => {
      const answerPoint = opt.from && opt.point ? Number(opt.point[0]) : null;
      let title = pos.join(' ');
      if (!title && answerPoint) title = getItem(getAnswer(d, opt.from).points, answerPoint, 'Point').text;
      const task = ops['task.add'](d, {
        title, description: opt.desc, priority: opt.prio, due: opt.due, status: opt.status,
        tags: tagsOf(opt), subtasks: opt.sub, answerId: opt.from, answerPoint,
      });
      return task;
    });
    out(opt, t, `Created: ${fmtTask(t)}`);
  },
  list({ opt }) {
    const d = readData(requireRoot());
    let list = d.tasks;
    if (opt.status) list = list.filter(t => t.status === opt.status);
    else if (!opt.all) list = list.filter(t => t.status !== 'done');
    if (opt.tag) list = list.filter(t => tagsOf(opt).every(x => t.tags.includes(x)));
    list = [...list].sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)
      || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.order - b.order);
    out(opt, list, list.map(fmtTask).join('\n') || '(no open tasks)');
  },
  show({ pos, opt }) {
    const d = readData(requireRoot());
    const t = getTask(d, pos[0]);
    out(opt, t, showTask(t, d));
  },
  update({ pos, opt }) {
    const patch = {
      title: opt.title, description: opt.desc, priority: opt.prio, status: opt.status,
      due: opt.due === 'none' ? null : opt.due,
    };
    if (opt.tag) patch.tags = tagsOf(opt);
    const t = mutate(requireRoot(), d => ops['task.update'](d, { id: pos[0], patch }));
    out(opt, t, fmtTask(t));
  },
  start: (a) => setStatus(a, 'in_progress'),
  review: (a) => setStatus(a, 'review'),
  done: (a) => setStatus(a, 'done'),
  todo: (a) => setStatus(a, 'todo'),
  sub({ pos, opt }) {
    const [id, arg] = pos;
    const isUpdate = /^\d+$/.test(arg || '') && pos.length === 2
      && (opt.done || opt.undone || opt.remove || opt.status || opt.desc !== undefined || opt.text !== undefined);
    let data;
    const t = mutate(requireRoot(), d => {
      data = d;
      return isUpdate
        ? ops['task.sub.update'](d, {
          id, sub: arg, done: opt.done ? true : opt.undone ? false : undefined, remove: opt.remove,
          status: opt.status, description: opt.desc, text: opt.text,
        })
        : ops['task.sub.add'](d, { id, text: pos.slice(1).join(' '), description: opt.desc, status: opt.status });
    });
    out(opt, t, showTask(t, data));
  },
  link({ pos, opt }) {
    let data;
    const t = mutate(requireRoot(), d => { data = d; return ops['task.link'](d, { id: pos[0], to: pos[1], type: opt.type }); });
    out(opt, t, showTask(t, data));
  },
  unlink({ pos, opt }) {
    let data;
    const t = mutate(requireRoot(), d => { data = d; return ops['task.unlink'](d, { id: pos[0], to: pos[1] }); });
    out(opt, t, showTask(t, data));
  },
  comment({ pos, opt }) {
    const author = opt.ai || process.env.CLAUDECODE ? 'ai' : 'user';
    const t = mutate(requireRoot(), d => ops['task.comment'](d, { id: pos[0], text: pos.slice(1).join(' '), author }));
    out(opt, t, `Comment added to ${t.id}.`);
  },
  rm({ pos, opt }) {
    const t = mutate(requireRoot(), d => ops['task.delete'](d, { id: pos[0] }));
    out(opt, t, `Deleted: ${t.id} – ${t.title}`);
  },
};

const inboxCommands = {
  list({ opt }) {
    const d = readData(requireRoot());
    let list = d.inbox;
    if (opt.status) list = list.filter(i => i.status === opt.status);
    else if (!opt.all) list = list.filter(i => i.status === 'open');
    out(opt, list, list.map(fmtInbox).join('\n') || '(inbox empty)');
  },
  add({ pos, opt }) {
    const i = mutate(requireRoot({ create: true }), d => ops['inbox.add'](d, { title: pos.join(' '), notes: opt.note, tags: tagsOf(opt) }));
    out(opt, i, `Added: ${fmtInbox(i)}`);
  },
  show({ pos, opt }) {
    const i = getInbox(readData(requireRoot()), pos[0]);
    out(opt, i, showInbox(i));
  },
  note({ pos, opt }) {
    const text = pos.slice(1).join(' ');
    const i = mutate(requireRoot(), d => {
      const cur = getInbox(d, pos[0]).notes;
      return ops['inbox.update'](d, { id: pos[0], patch: { notes: cur ? `${cur}\n${text}` : text } });
    });
    out(opt, i, showInbox(i));
  },
  update({ pos, opt }) {
    const patch = { title: opt.title, notes: opt.notes, status: opt.status };
    if (opt.tag) patch.tags = tagsOf(opt);
    const i = mutate(requireRoot(), d => ops['inbox.update'](d, { id: pos[0], patch }));
    out(opt, i, fmtInbox(i));
  },
  clarify: (a) => setInboxStatus(a, 'clarified'),
  drop: (a) => setInboxStatus(a, 'dropped'),
  reopen: (a) => setInboxStatus(a, 'open'),
  task({ pos, opt }) {
    const t = mutate(requireRoot(), d => ops['inbox.toTask'](d, {
      id: pos[0], keepOpen: opt['keep-open'], title: opt.title, description: opt.desc, priority: opt.prio,
      due: opt.due, status: opt.status, tags: opt.tag ? tagsOf(opt) : undefined, subtasks: opt.sub,
    }));
    out(opt, t, `Created: ${fmtTask(t)}`);
  },
  rm({ pos, opt }) {
    const i = mutate(requireRoot(), d => ops['inbox.delete'](d, { id: pos[0] }));
    out(opt, i, `Deleted: ${i.id} – ${i.title}`);
  },
};

function setInboxStatus({ pos, opt }, status) {
  const items = mutate(requireRoot(), d => pos.map(id => ops['inbox.update'](d, { id, patch: { status } })));
  out(opt, items, items.map(fmtInbox).join('\n'));
}

function setStatus({ pos, opt }, status) {
  const root = requireRoot();
  const tasks = mutate(root, d => pos.map(id => ops['task.update'](d, { id, patch: { status } })));
  out(opt, tasks, tasks.map(fmtTask).join('\n'));
}

// ---------------------------------------------------------------- server

function ping() {
  return new Promise(res => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/ping', timeout: 400 }, r => { r.resume(); res(r.statusCode === 200); });
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
  });
}

async function ensureServer() {
  if (await ping()) return;
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 150));
    if (await ping()) return;
  }
  throw new Error('Could not start the server.');
}

function serve(port) {
  const clients = new Set();
  const mtimes = new Map();

  // Push changes (including ones the AI makes via the CLI) as server-sent events.
  setInterval(() => {
    for (const p of readRegistry()) {
      let m;
      try { m = fs.statSync(dataFile(p.path)).mtimeMs; } catch { continue; }
      if (mtimes.has(p.path) && mtimes.get(p.path) !== m)
        for (const c of clients) c.write(`data: ${JSON.stringify({ project: p.path })}\n\n`);
      mtimes.set(p.path, m);
    }
  }, 700);

  const allowed = (p) => readRegistry().some(x => x.path === p);
  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };

  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.searchParams.get('p');
    try {
      if (url.pathname === '/' || url.pathname === '/index.html')
        return send(res, 200, fs.readFileSync(path.join(HERE, 'dashboard.html')), 'text/html; charset=utf-8');
      if (url.pathname === '/api/ping') return send(res, 200, { ok: true });
      if (url.pathname === '/api/projects') {
        const list = readRegistry().filter(x => fs.existsSync(dataFile(x.path)));
        return send(res, 200, list);
      }
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': hi\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (!p || !allowed(p)) return send(res, 404, { error: 'Unknown project' });
      if (url.pathname === '/api/data' && req.method === 'GET') {
        const data = readData(p);
        // "Next up" is computed here so the dashboard uses the same selection as keepr next.
        const next = Object.fromEntries(Object.entries(nextTasks(data.tasks)).map(([k, list]) => [k, list.map(t => t.id)]));
        return send(res, 200, { root: p, ...data, next, meta: { STATUSES, PRIORITIES, ANSWER_STATUSES, INBOX_STATUSES, LINK_TYPES, NEXT_GROUPS } });
      }
      if (url.pathname === '/api/op' && req.method === 'POST') {
        // Blocks cross-site requests from other websites.
        if (req.headers['x-keepr'] !== '1') return send(res, 403, { error: 'forbidden' });
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
          try {
            const { op, args } = JSON.parse(body);
            if (!ops[op]) throw new Error(`Unknown operation ${op}`);
            const result = mutate(p, d => ops[op](d, args || {}));
            mtimes.set(p, fs.statSync(dataFile(p)).mtimeMs);
            send(res, 200, { ok: true, result });
          } catch (e) { send(res, 400, { error: e.message }); }
        });
        return;
      }
      send(res, 404, { error: 'not found' });
    } catch (e) { send(res, 500, { error: e.message }); }
  }).listen(port, '127.0.0.1', () => console.log(`keepr dashboard: http://127.0.0.1:${port}/`));
}

// ---------------------------------------------------------------- MCP server (stdio)
// JSON-RPC 2.0, one message per line. For Claude Desktop and other MCP clients.
// stdout belongs to the protocol – diagnostics go to stderr only.

const PROJECT_PROP = { project: { type: 'string', description: 'Project name or path (see list_projects). Omit for the default project.' } };
const STR = (description) => ({ type: 'string', description });
const STRS = (description) => ({ type: 'array', items: { type: 'string' }, description });
const LINKS = (description) => ({
  type: 'array', description,
  items: { type: 'object', properties: { task: STR('e.g. T5'), type: { type: 'string', enum: LINK_TYPES, description: 'relates (default), blocks = this task blocks the other one, blocked_by = this task waits for the other one' } }, required: ['task'] },
});
const SUBTASKS = (description) => ({
  type: 'array', description,
  items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { text: { type: 'string' }, description: { type: 'string' }, status: { type: 'string', enum: STATUSES } }, required: ['text'] }] },
});

const MCP_TOOLS = [
  {
    name: 'list_projects',
    description: 'Lists the keepr projects (each has its own answers and tasks) and shows which one is the default.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'save_answer',
    description: 'Saves an answer from the conversation to the saved-answers list of the keepr dashboard. Use when the user says "keep this", "remember this", "/keep", "put this in the dashboard", "merk dir das" or similar, or wants to come back to (parts of) an answer later. Split the answer into points: each standalone recommendation, open question or step as a short sentence. Pass the full answer text as Markdown (no shortening) unless the user only wants a part.',
    inputSchema: {
      type: 'object',
      properties: {
        title: STR('Short, descriptive title (≤ 60 characters)'),
        content: STR('The answer text as Markdown'),
        summary: STR('One sentence: what it is about and what is still open'),
        prompt: STR('The user question the answer refers to'),
        points: STRS('Individual points/open questions the user wants to come back to'),
        tags: STRS('Tags'),
        chat_url: STR('Link to the chat, if the user provided one'),
        ...PROJECT_PROP,
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'list_answers',
    description: 'Lists saved answers (IDs A1, A2 …). Default: all that are not done.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ANSWER_STATUSES }, all: { type: 'boolean' }, ...PROJECT_PROP } },
  },
  {
    name: 'get_answer',
    description: 'Loads a saved answer in full (question, answer, numbered points, notes). Use for "regarding A3", "/ref A3", "back to point 2 of A5", "bezug auf A3".',
    inputSchema: { type: 'object', properties: { id: STR('e.g. A3'), ...PROJECT_PROP }, required: ['id'] },
  },
  {
    name: 'update_answer',
    description: 'Updates a saved answer: status (open, followup = follow-up question pending, done), title, summary, tags, chat link; note appends a note. add_points adds new points.',
    inputSchema: {
      type: 'object',
      properties: {
        id: STR('e.g. A3'), status: { type: 'string', enum: ANSWER_STATUSES }, title: { type: 'string' }, summary: { type: 'string' },
        tags: STRS('replaces the tags'), note: STR('appended to the notes'), chat_url: { type: 'string' },
        add_points: STRS('new points'), ...PROJECT_PROP,
      },
      required: ['id'],
    },
  },
  {
    name: 'update_answer_point',
    description: 'Checks off a point of a saved answer (done), reopens it, changes its text or removes it.',
    inputSchema: {
      type: 'object',
      properties: { id: STR('e.g. A3'), point: { type: 'integer', description: 'Number of the point' }, done: { type: 'boolean' }, text: { type: 'string' }, remove: { type: 'boolean' }, ...PROJECT_PROP },
      required: ['id', 'point'],
    },
  },
  {
    name: 'list_tasks',
    description: 'Lists tasks (IDs T1, T2 …) with status, priority, due date and progress. Default: all that are not done.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: STATUSES }, tag: { type: 'string' }, all: { type: 'boolean' }, ...PROJECT_PROP } },
  },
  {
    name: 'next_tasks',
    description: 'What to do first: open tasks that are overdue, due within the next 7 days, or urgent/high priority without a due date – grouped, sorted by due date, priority, order.',
    inputSchema: { type: 'object', properties: { ...PROJECT_PROP } },
  },
  {
    name: 'get_task',
    description: 'Loads a task in full (description, subtasks, comments).',
    inputSchema: { type: 'object', properties: { id: STR('e.g. T3'), ...PROJECT_PROP }, required: ['id'] },
  },
  {
    name: 'add_task',
    description: 'Creates a task on the Kanban board. Title in the imperative, description with context and a definition of done, split larger tasks into subtasks. Set priority/due date only when stated or obvious. If it comes from a saved answer: from_answer (+ from_point; then title may be omitted).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' }, description: STR('Markdown'),
        priority: { type: 'string', enum: PRIORITIES }, status: { type: 'string', enum: STATUSES },
        due: STR('YYYY-MM-DD'), tags: STRS('Tags'), subtasks: SUBTASKS('Subtasks: a title, or { text, description, status }'),
        links: LINKS('Links to other tasks'),
        from_answer: STR('e.g. A3'), from_point: { type: 'integer' }, ...PROJECT_PROP,
      },
    },
  },
  {
    name: 'update_task',
    description: 'Updates a task. Status: todo → in_progress → review → done. due: "" clears the due date. add_subtasks adds subtasks, comment appends a comment (as the AI). add_links links other tasks (relates / blocks / blocked_by), remove_links removes links. Mention other items by ID (T5, A3, I2) in descriptions and comments; the dashboard makes them clickable.',
    inputSchema: {
      type: 'object',
      properties: {
        id: STR('e.g. T3'), title: { type: 'string' }, description: { type: 'string' },
        status: { type: 'string', enum: STATUSES }, priority: { type: 'string', enum: PRIORITIES },
        due: STR('YYYY-MM-DD or "" to clear'), tags: STRS('replaces the tags'),
        add_subtasks: SUBTASKS('new subtasks: a title, or { text, description, status }'), comment: STR('Comment, e.g. what was done'),
        add_links: LINKS('Links to add'), remove_links: STRS('Task IDs to unlink'), ...PROJECT_PROP,
      },
      required: ['id'],
    },
  },
  {
    name: 'update_subtask',
    description: 'Changes a subtask: status (todo, in_progress, review, done), done (shortcut for checking off / reopening), text, description, or removes it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: STR('e.g. T3'), sub: { type: 'integer', description: 'Number of the subtask' }, status: { type: 'string', enum: STATUSES },
        done: { type: 'boolean' }, text: { type: 'string' }, description: { type: 'string' }, remove: { type: 'boolean' }, ...PROJECT_PROP,
      },
      required: ['id', 'sub'],
    },
  },
  {
    name: 'delete_task',
    description: 'Permanently deletes a task. Only when the user explicitly asks for it.',
    inputSchema: { type: 'object', properties: { id: STR('e.g. T3'), ...PROJECT_PROP }, required: ['id'] },
  },
  {
    name: 'list_inbox',
    description: 'Lists the inbox (IDs I1, I2 …): things the user still has to clarify before they become a task. Default: the open ones.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: INBOX_STATUSES }, all: { type: 'boolean' }, ...PROJECT_PROP } },
  },
  {
    name: 'get_inbox_item',
    description: 'Loads an inbox item with its notes.',
    inputSchema: { type: 'object', properties: { id: STR('e.g. I3'), ...PROJECT_PROP }, required: ['id'] },
  },
  {
    name: 'add_inbox_item',
    description: 'Puts something into the inbox that still needs clarifying before it can become a task (open question, idea, "check whether …"). Use for "noch klären", "note that for later", "add to inbox", or when the user is unsure whether something is a task yet.',
    inputSchema: { type: 'object', properties: { title: STR('What needs clarifying, as a short question or note'), notes: STR('Context, Markdown'), tags: STRS('Tags'), ...PROJECT_PROP }, required: ['title'] },
  },
  {
    name: 'update_inbox_item',
    description: 'Updates an inbox item: title, status (open, clarified, dropped), tags; note appends to the notes.',
    inputSchema: {
      type: 'object',
      properties: { id: STR('e.g. I3'), title: { type: 'string' }, status: { type: 'string', enum: INBOX_STATUSES }, tags: STRS('replaces the tags'), note: STR('appended to the notes'), ...PROJECT_PROP },
      required: ['id'],
    },
  },
  {
    name: 'inbox_to_task',
    description: 'Creates a task from an inbox item once it is clarified (title and notes are taken over unless given) and marks the item clarified (keep_open: true leaves it open).',
    inputSchema: {
      type: 'object',
      properties: {
        id: STR('e.g. I3'), title: { type: 'string' }, description: STR('Markdown'), priority: { type: 'string', enum: PRIORITIES },
        due: STR('YYYY-MM-DD'), tags: STRS('Tags'), subtasks: SUBTASKS('Subtasks'), keep_open: { type: 'boolean' }, ...PROJECT_PROP,
      },
      required: ['id'],
    },
  },
  {
    name: 'open_dashboard',
    description: 'Starts the keepr dashboard (if needed) and returns its link; with open=true it opens in the browser.',
    inputSchema: { type: 'object', properties: { open: { type: 'boolean' }, ...PROJECT_PROP } },
  },
];

// Resolve the project: name or path from the registry, otherwise the default.
function mcpProject(arg, fallback) {
  const list = readRegistry().filter(p => fs.existsSync(dataFile(p.path)));
  const want = arg || fallback;
  if (want) {
    const hit = list.find(p => p.path === path.resolve(want) || p.name.toLowerCase() === String(want).toLowerCase());
    if (hit) return hit.path;
    if (path.isAbsolute(want) && fs.existsSync(want)) return initProject(want);
    throw new Error(`Unknown project "${want}". Available: ${list.map(p => p.name).join(', ') || '(none)'}. An absolute folder path creates a new one.`);
  }
  const local = findProjectRoot();
  if (local) return local;
  if (list.length === 1) return list[0].path;
  throw new Error(`Several projects – please pass "project": ${list.map(p => p.name).join(', ') || '(none; pass an absolute folder path)'}`);
}

function mcpTools(defaultProject) {
  const root = (a) => mcpProject(a.project, defaultProject);
  const pointsList = (a) => a.points.map(p => `${p.id}. [${p.done ? 'x' : ' '}] ${p.text}`).join('\n');
  return {
    list_projects() {
      const list = readRegistry().filter(p => fs.existsSync(dataFile(p.path)));
      let def = null;
      try { def = mcpProject(null, defaultProject); } catch {}
      return list.map(p => `${p.name}${p.path === def ? ' (default)' : ''} – ${p.path}`).join('\n') || '(no projects – the first save_answer with an absolute path as project creates one)';
    },
    save_answer(a) {
      const r = root(a);
      const ans = mutate(r, d => ops['answer.add'](d, {
        title: a.title, content: a.content, summary: a.summary, prompt: a.prompt, points: a.points,
        tags: a.tags, chatUrl: a.chat_url, source: 'mcp',
      }));
      return `Saved: ${ans.id} – ${ans.title}${ans.points.length ? ` (${ans.points.length} points)` : ''}\n${dashUrl(r, ans.id)}`;
    },
    list_answers(a) {
      const d = readData(root(a));
      let list = d.answers;
      if (a.status) list = list.filter(x => x.status === a.status);
      else if (!a.all) list = list.filter(x => x.status !== 'done');
      return list.map(fmtAnswer).join('\n') || '(none)';
    },
    get_answer(a) { return showAnswer(getAnswer(readData(root(a)), a.id)); },
    update_answer(a) {
      const ans = mutate(root(a), d => {
        const cur = getAnswer(d, a.id);
        const patch = { status: a.status, title: a.title, summary: a.summary, tags: a.tags, chatUrl: a.chat_url };
        if (a.note) patch.notes = cur.notes ? `${cur.notes}\n${a.note}` : a.note;
        for (const t of a.add_points || []) ops['answer.point.add'](d, { id: a.id, text: t });
        return ops['answer.update'](d, { id: a.id, patch });
      });
      return `${fmtAnswer(ans)}\n${pointsList(ans)}`;
    },
    update_answer_point(a) {
      const ans = mutate(root(a), d => ops['answer.point.update'](d, { id: a.id, point: a.point, done: a.done, text: a.text, remove: a.remove }));
      return `${fmtAnswer(ans)}\n${pointsList(ans)}`;
    },
    list_tasks(a) {
      const d = readData(root(a));
      let list = d.tasks;
      if (a.status) list = list.filter(t => t.status === a.status);
      else if (!a.all) list = list.filter(t => t.status !== 'done');
      if (a.tag) list = list.filter(t => t.tags.includes(a.tag));
      list = [...list].sort((x, y) => STATUSES.indexOf(x.status) - STATUSES.indexOf(y.status)
        || PRIORITIES.indexOf(x.priority) - PRIORITIES.indexOf(y.priority) || x.order - y.order);
      return list.map(fmtTask).join('\n') || '(no open tasks)';
    },
    next_tasks(a) { return fmtNext(nextTasks(readData(root(a)).tasks)); },
    get_task(a) { const d = readData(root(a)); return showTask(getTask(d, a.id), d); },
    add_task(a) {
      const t = mutate(root(a), d => {
        let title = a.title;
        if (!title && a.from_answer && a.from_point) title = getItem(getAnswer(d, a.from_answer).points, a.from_point, 'Point').text;
        return ops['task.add'](d, {
          title, description: a.description, priority: a.priority, status: a.status, due: a.due || undefined,
          tags: a.tags, subtasks: a.subtasks, answerId: a.from_answer, answerPoint: a.from_point ?? null, links: a.links,
        });
      });
      return `Created: ${fmtTask(t)}`;
    },
    update_task(a) {
      let data;
      const t = mutate(root(a), d => {
        data = d;
        const patch = { title: a.title, description: a.description, status: a.status, priority: a.priority, tags: a.tags };
        if (a.due !== undefined) patch.due = a.due || null;
        ops['task.update'](d, { id: a.id, patch });
        for (const s of a.add_subtasks || []) ops['task.sub.add'](d, { id: a.id, ...(typeof s === 'string' ? { text: s } : s) });
        for (const l of a.add_links || []) ops['task.link'](d, { id: a.id, to: l.task, type: l.type });
        for (const x of a.remove_links || []) ops['task.unlink'](d, { id: a.id, to: x });
        if (a.comment) ops['task.comment'](d, { id: a.id, text: a.comment, author: 'ai' });
        return getTask(d, a.id);
      });
      return showTask(t, data);
    },
    update_subtask(a) {
      let data;
      const t = mutate(root(a), d => {
        data = d;
        return ops['task.sub.update'](d, { id: a.id, sub: a.sub, status: a.status, done: a.done, text: a.text, description: a.description, remove: a.remove });
      });
      return showTask(t, data);
    },
    list_inbox(a) {
      const d = readData(root(a));
      let list = d.inbox;
      if (a.status) list = list.filter(x => x.status === a.status);
      else if (!a.all) list = list.filter(x => x.status === 'open');
      return list.map(fmtInbox).join('\n') || '(inbox empty)';
    },
    get_inbox_item(a) { return showInbox(getInbox(readData(root(a)), a.id)); },
    add_inbox_item(a) {
      const r = root(a);
      const i = mutate(r, d => ops['inbox.add'](d, { title: a.title, notes: a.notes, tags: a.tags }));
      return `Added: ${fmtInbox(i)}\n${dashUrl(r, i.id)}`;
    },
    update_inbox_item(a) {
      const i = mutate(root(a), d => {
        const patch = { title: a.title, status: a.status, tags: a.tags };
        if (a.note) { const cur = getInbox(d, a.id).notes; patch.notes = cur ? `${cur}\n${a.note}` : a.note; }
        return ops['inbox.update'](d, { id: a.id, patch });
      });
      return showInbox(i);
    },
    inbox_to_task(a) {
      const t = mutate(root(a), d => ops['inbox.toTask'](d, {
        id: a.id, keepOpen: a.keep_open, title: a.title, description: a.description, priority: a.priority,
        due: a.due || undefined, tags: a.tags, subtasks: a.subtasks,
      }));
      return `Created: ${fmtTask(t)}`;
    },
    delete_task(a) {
      const t = mutate(root(a), d => ops['task.delete'](d, { id: a.id }));
      return `Deleted: ${t.id} – ${t.title}`;
    },
    async open_dashboard(a) {
      let url = `http://127.0.0.1:${PORT}/`;
      try { url = dashUrl(root(a)); } catch {}
      await ensureServer();
      if (a.open) openInBrowser(url);
      return url;
    },
  };
}

function mcpServer(defaultProject = process.env.KEEPR_PROJECT || process.env.WF_PROJECT) {
  const tools = mcpTools(defaultProject);
  const pkg = { name: 'keepr', version: VERSION };
  const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

  async function handle(msg) {
    const { id, method, params } = msg;
    if (id === undefined) return; // Notifications (e.g. notifications/initialized)
    try {
      if (method === 'initialize') {
        return send({ id, result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: pkg,
          instructions: 'keepr keeps, per project, a list of saved AI answers (A1, A2 …, with points that can be checked off), an inbox of things still to clarify (I1, I2 …) and Kanban-style tasks (T1, T2 …, with subtasks and links between tasks). The user sees everything live in the dashboard. On "keep this" / "merk dir das" → save_answer; "still needs clarifying" / "noch klären" → add_inbox_item; when an ID is referenced → get_answer/get_task/get_inbox_item; record progress with update_*. After changes, reply briefly with the affected IDs.',
        } });
      }
      if (method === 'ping') return send({ id, result: {} });
      if (method === 'tools/list') return send({ id, result: { tools: MCP_TOOLS } });
      if (method === 'tools/call') {
        const fn = tools[params?.name];
        if (!fn) return send({ id, error: { code: -32602, message: `Unknown tool ${params?.name}` } });
        try {
          const text = await fn(params.arguments || {});
          return send({ id, result: { content: [{ type: 'text', text }] } });
        } catch (e) {
          return send({ id, result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true } });
        }
      }
      send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (e) {
      send({ id, error: { code: -32603, message: e.message } });
    }
  }

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { send({ id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
      for (const m of Array.isArray(msg) ? msg : [msg]) handle(m);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  console.error(`keepr MCP server ready${defaultProject ? ` (default project: ${defaultProject})` : ''}`);
}

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
