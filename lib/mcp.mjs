import fs from 'node:fs';
import path from 'node:path';
import { VERSION, PORT, STATUSES, PRIORITIES, ANSWER_STATUSES, INBOX_STATUSES, LINK_TYPES } from './config.mjs';
import { dataFile, findProjectRoot, initProject, readData, mutate, readRegistry } from './storage.mjs';
import { getAnswer, getTask, getInbox, nextTasks, getItem, ops } from './ops.mjs';
import { parseDate, dayBlocks } from './dayplan.mjs';
import { openInBrowser, dashUrl, fmtTask, fmtNext, fmtPlan, fmtInbox, showInbox, fmtAnswer, showTask, showAnswer } from './format.mjs';
import { ensureServer } from './server.mjs';

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
const ORIGIN = (what) => STR(`Origin/background: which question, observation or discussion led to this ${what}, in 1–3 sentences, so the user still understands later why the idea came up. Fill it whenever the context shows it; if the reasoning behind it is unclear, ask the user instead of guessing.`);
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
        origin: ORIGIN('answer'),
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
        id: STR('e.g. A3'), status: { type: 'string', enum: ANSWER_STATUSES }, title: { type: 'string' }, summary: { type: 'string' }, origin: ORIGIN('answer'),
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
        title: { type: 'string' }, description: STR('Markdown'), origin: ORIGIN('task (defaults to the origin of from_answer)'),
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
        id: STR('e.g. T3'), title: { type: 'string' }, description: { type: 'string' }, origin: ORIGIN('task'),
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
    inputSchema: { type: 'object', properties: { title: STR('What needs clarifying, as a short question or note'), notes: STR('Context, Markdown'), origin: ORIGIN('inbox item'), tags: STRS('Tags'), ...PROJECT_PROP }, required: ['title'] },
  },
  {
    name: 'update_inbox_item',
    description: 'Updates an inbox item: title, status (open, clarified, dropped), tags; note appends to the notes.',
    inputSchema: {
      type: 'object',
      properties: { id: STR('e.g. I3'), title: { type: 'string' }, origin: ORIGIN('inbox item'), status: { type: 'string', enum: INBOX_STATUSES }, tags: STRS('replaces the tags'), note: STR('appended to the notes'), ...PROJECT_PROP },
      required: ['id'],
    },
  },
  {
    name: 'inbox_to_task',
    description: 'Creates a task from an inbox item once it is clarified (title and notes are taken over unless given) and marks the item clarified (keep_open: true leaves it open).',
    inputSchema: {
      type: 'object',
      properties: {
        id: STR('e.g. I3'), title: { type: 'string' }, description: STR('Markdown'), origin: ORIGIN('task (defaults to the origin of the inbox item)'), priority: { type: 'string', enum: PRIORITIES },
        due: STR('YYYY-MM-DD'), tags: STRS('Tags'), subtasks: SUBTASKS('Subtasks'), keep_open: { type: 'boolean' }, ...PROJECT_PROP,
      },
      required: ['id'],
    },
  },
  {
    name: 'get_day_plan',
    description: 'Shows the day plan of a date (blocks B1, B2 …: own entries, linked tasks and free windows the user marked for you to fill) plus the open tasks to choose from. Use before planning a day, for "plan my day", "what is on today", "tagesplan".',
    inputSchema: { type: 'object', properties: { date: STR('YYYY-MM-DD, today (default) or tomorrow'), ...PROJECT_PROP } },
  },
  {
    name: 'add_plan_blocks',
    description: 'Adds time blocks to a day plan. A block links a keepr task (task) or is an own entry (title, e.g. "Lunch", "Emails", "Buffer"). Blocks inside a free window fill it (the window shrinks or splits); overlapping other blocks is an error. To fill free windows: call get_day_plan first, then plan realistic blocks (deadlines and priority first, breaks and buffer included) and briefly explain the choice to the user.',
    inputSchema: {
      type: 'object',
      properties: {
        date: STR('YYYY-MM-DD, today (default) or tomorrow'),
        blocks: {
          type: 'array',
          items: { type: 'object', properties: { start: STR('HH:MM'), end: STR('HH:MM'), task: STR('e.g. T3'), title: STR('own entry, or a more specific title for the task'), note: STR('Why / what exactly') }, required: ['start', 'end'] },
        },
        ...PROJECT_PROP,
      },
      required: ['blocks'],
    },
  },
  {
    name: 'update_plan_block',
    description: 'Changes a block of the day plan: time, date, title, linked task (task: "" unlinks), note, done; remove: true deletes it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: STR('e.g. B3'), start: STR('HH:MM'), end: STR('HH:MM'), date: STR('YYYY-MM-DD'), title: { type: 'string' }, task: STR('e.g. T3, "" to unlink'),
        note: { type: 'string' }, done: { type: 'boolean' }, remove: { type: 'boolean' }, ...PROJECT_PROP,
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
        title: a.title, content: a.content, summary: a.summary, origin: a.origin, prompt: a.prompt, points: a.points,
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
        const patch = { status: a.status, title: a.title, summary: a.summary, origin: a.origin, tags: a.tags, chatUrl: a.chat_url };
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
          title, description: a.description, origin: a.origin, priority: a.priority, status: a.status, due: a.due || undefined,
          tags: a.tags, subtasks: a.subtasks, answerId: a.from_answer, answerPoint: a.from_point ?? null, links: a.links,
        });
      });
      return `Created: ${fmtTask(t)}`;
    },
    update_task(a) {
      let data;
      const t = mutate(root(a), d => {
        data = d;
        const patch = { title: a.title, description: a.description, origin: a.origin, status: a.status, priority: a.priority, tags: a.tags };
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
      const i = mutate(r, d => ops['inbox.add'](d, { title: a.title, notes: a.notes, origin: a.origin, tags: a.tags }));
      return `Added: ${fmtInbox(i)}\n${dashUrl(r, i.id)}`;
    },
    update_inbox_item(a) {
      const i = mutate(root(a), d => {
        const patch = { title: a.title, origin: a.origin, status: a.status, tags: a.tags };
        if (a.note) { const cur = getInbox(d, a.id).notes; patch.notes = cur ? `${cur}\n${a.note}` : a.note; }
        return ops['inbox.update'](d, { id: a.id, patch });
      });
      return showInbox(i);
    },
    inbox_to_task(a) {
      const t = mutate(root(a), d => ops['inbox.toTask'](d, {
        id: a.id, keepOpen: a.keep_open, title: a.title, description: a.description, origin: a.origin, priority: a.priority,
        due: a.due || undefined, tags: a.tags, subtasks: a.subtasks,
      }));
      return `Created: ${fmtTask(t)}`;
    },
    delete_task(a) {
      const t = mutate(root(a), d => ops['task.delete'](d, { id: a.id }));
      return `Deleted: ${t.id} – ${t.title}`;
    },
    get_day_plan(a) {
      const r = root(a), d = readData(r), date = parseDate(a.date);
      const planned = new Set(dayBlocks(d, date).map(b => b.taskId));
      const open = d.tasks.filter(t => t.status !== 'done' && !planned.has(t.id))
        .sort((x, y) => PRIORITIES.indexOf(x.priority) - PRIORITIES.indexOf(y.priority) || (x.due || '9').localeCompare(y.due || '9'));
      return `${fmtPlan(d, date)}\n\nNext up:\n${fmtNext(nextTasks(d.tasks, date))}\n\nOpen tasks not planned that day:\n${open.map(fmtTask).join('\n') || '(none)'}\n\n${dashUrl(r, 'day')}`;
    },
    add_plan_blocks(a) {
      const r = root(a), date = parseDate(a.date);
      mutate(r, d => { for (const b of a.blocks || []) ops['plan.add'](d, { date, start: b.start, end: b.end, title: b.title, taskId: b.task, note: b.note, by: 'ai' }); });
      return fmtPlan(readData(r), date);
    },
    update_plan_block(a) {
      const r = root(a);
      const b = mutate(r, d => a.remove ? ops['plan.delete'](d, { id: a.id })
        : ops['plan.update'](d, { id: a.id, patch: { start: a.start, end: a.end, date: a.date, title: a.title, taskId: a.task === undefined ? undefined : a.task || null, note: a.note, done: a.done } }));
      return a.remove ? `Removed: ${b.id}` : fmtPlan(readData(r), b.date);
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

export function mcpServer(defaultProject = process.env.KEEPR_PROJECT || process.env.WF_PROJECT) {
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
          instructions: 'keepr keeps, per project, a list of saved AI answers (A1, A2 …, with points that can be checked off), an inbox of things still to clarify (I1, I2 …) and Kanban-style tasks (T1, T2 …, with subtasks and links between tasks) and a day plan of time blocks (B1, B2 …; "plan my day" → get_day_plan, then add_plan_blocks to fill the free windows). The user sees everything live in the dashboard. On "keep this" / "merk dir das" → save_answer; "still needs clarifying" / "noch klären" → add_inbox_item; when an ID is referenced → get_answer/get_task/get_inbox_item; record progress with update_*. Give every new answer, task and inbox item an origin (which question or observation led to it); if the reasoning behind it is unclear, ask the user. After changes, reply briefly with the affected IDs.',
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
