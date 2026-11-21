// Operations shared by the CLI, the dashboard and the MCP server.
import { STATUSES, PRIORITIES, ANSWER_STATUSES, INBOX_STATUSES, LINK_TYPES } from './config.mjs';
import { now } from './storage.mjs';
import { toMin, fromMin, isFreeBlock, normTime, parseDate, dayBlocks, getBlock, placeBlock } from './dayplan.mjs';
import { firstLine } from './transcripts.mjs';

// ---------------------------------------------------------------- operations
// Shared by the CLI, the dashboard and the MCP server.

export function nextId(data, prefix) {
  data.counters[prefix] = (data.counters[prefix] || 0) + 1;
  return `${prefix}${data.counters[prefix]}`;
}

export function getAnswer(data, id) {
  const a = data.answers.find(x => x.id.toLowerCase() === String(id).toLowerCase());
  if (!a) throw new Error(`Answer ${id} not found`);
  return a;
}

export function getTask(data, id) {
  const t = data.tasks.find(x => x.id.toLowerCase() === String(id).toLowerCase());
  if (!t) throw new Error(`Task ${id} not found`);
  return t;
}

export function getInbox(data, id) {
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


export function getItem(list, id, what) {
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
      origin: a.origin || '',
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
    for (const k of ['title', 'summary', 'origin', 'status', 'tags', 'notes', 'chatUrl']) if (patch[k] !== undefined) a[k] = patch[k];
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
    const ans = t.answerId ? getAnswer(data, t.answerId) : null;
    const status = t.status || 'todo';
    const task = {
      id: nextId(data, 'T'),
      title: t.title,
      description: t.description || '',
      origin: t.origin || ans?.origin || '',
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
    for (const k of ['title', 'description', 'origin', 'status', 'priority', 'due', 'tags', 'answerId', 'order'])
      if (patch[k] !== undefined) t[k] = patch[k];
    t.updatedAt = now();
    return t;
  },
  'task.delete'(data, { id }) {
    const t = getTask(data, id);
    data.tasks = data.tasks.filter(x => x !== t);
    for (const x of data.tasks) x.links = (x.links || []).filter(l => l.to !== t.id);
    for (const b of data.plan) if (b.taskId === t.id) { b.title ||= t.title; b.taskId = null; }
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
  'inbox.add'(data, { title, notes, origin, tags }) {
    if (!title) throw new Error('Title missing');
    const item = {
      id: nextId(data, 'I'), title, notes: notes || '', origin: origin || '', status: 'open', tags: tags || [], taskIds: [],
      createdAt: now(), updatedAt: now(),
    };
    data.inbox.unshift(item);
    return item;
  },
  'inbox.update'(data, { id, patch }) {
    const i = getInbox(data, id);
    checkEnum(patch.status, INBOX_STATUSES, 'status');
    for (const k of ['title', 'notes', 'origin', 'status', 'tags']) if (patch[k] !== undefined) i[k] = patch[k];
    i.updatedAt = now();
    return i;
  },
  'inbox.delete'(data, { id }) {
    const i = getInbox(data, id);
    data.inbox = data.inbox.filter(x => x !== i);
    return i;
  },
  'plan.add'(data, b) {
    const block = {
      id: null, date: parseDate(b.date), start: normTime(b.start, 'start'), end: normTime(b.end, 'end'),
      title: (b.title || '').trim(), taskId: b.taskId ? getTask(data, b.taskId).id : null, note: b.note || '',
      done: false, by: b.by || 'user', createdAt: now(), updatedAt: now(),
    };
    placeBlock(data, block);
    block.id = nextId(data, 'B');
    data.plan.push(block);
    return block;
  },
  'plan.update'(data, { id, patch }) {
    const b = getBlock(data, id);
    const next = { ...b };
    if (patch.date !== undefined) next.date = parseDate(patch.date);
    if (patch.start !== undefined) next.start = normTime(patch.start, 'start');
    if (patch.end !== undefined) next.end = normTime(patch.end, 'end');
    if (patch.title !== undefined) next.title = String(patch.title || '').trim();
    if (patch.taskId !== undefined) next.taskId = patch.taskId && patch.taskId !== 'none' ? getTask(data, patch.taskId).id : null;
    if (patch.note !== undefined) next.note = patch.note || '';
    if (patch.done !== undefined) next.done = !!patch.done;
    if (['date', 'start', 'end', 'title', 'taskId'].some(k => next[k] !== b[k])) placeBlock(data, next);
    Object.assign(b, next, { updatedAt: now() });
    return b;
  },
  'plan.delete'(data, { id }) {
    const b = getBlock(data, id);
    data.plan = data.plan.filter(x => x !== b);
    return b;
  },
  // Fills the free windows of a day with open tasks (without AI): overdue, due soon, urgent first,
  // then the rest by priority; at most maxMinutes per block, tasks already planned that day are skipped.
  'plan.autofill'(data, { date, maxMinutes = 90 }) {
    date = parseDate(date);
    const planned = new Set(dayBlocks(data, date).map(b => b.taskId).filter(Boolean));
    const g = nextTasks(data.tasks, date);
    const rest = data.tasks.filter(t => t.status !== 'done')
      .sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || STATUSES.indexOf(b.status) - STATUSES.indexOf(a.status) || (a.order || 0) - (b.order || 0));
    const queue = [...new Set([...g.overdue, ...g.soon, ...g.urgent, ...rest])].filter(t => !planned.has(t.id));
    const added = [];
    while (queue.length) {
      const free = dayBlocks(data, date).find(b => isFreeBlock(b) && toMin(b.end) - toMin(b.start) >= 15);
      if (!free) break;
      const end = Math.min(toMin(free.end), toMin(free.start) + Number(maxMinutes));
      added.push(ops['plan.add'](data, { date, start: free.start, end: fromMin(end), taskId: queue.shift().id, by: 'auto' }));
    }
    return added;
  },
  // Turns an inbox item into a task; the item counts as clarified unless keepOpen.
  'inbox.toTask'(data, { id, keepOpen, ...t }) {
    const i = getInbox(data, id);
    const task = ops['task.add'](data, {
      ...t, title: t.title || i.title, description: t.description ?? i.notes, origin: t.origin || i.origin, tags: t.tags || i.tags, inboxId: i.id,
    });
    i.taskIds.push(task.id);
    if (!keepOpen) i.status = 'clarified';
    i.updatedAt = now();
    return task;
  },
};
