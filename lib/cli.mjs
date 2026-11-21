import path from 'node:path';
import { VERSION, PORT, STATUSES, PRIORITIES } from './config.mjs';
import { findProjectRoot, defaultProjectRoot, initProject, readData, mutate, readRegistry, register } from './storage.mjs';
import { getAnswer, getTask, getInbox, nextTasks, getItem, ops } from './ops.mjs';
import { isFreeBlock, parseDate, dayBlocks } from './dayplan.mjs';
import { sessionTranscript, latestTranscript, parseTurns } from './transcripts.mjs';
import { tagsOf, readStdin, requireRoot, openInBrowser, dashUrl, fmtTask, fmtNext, fmtBlock, fmtPlan, fmtInbox, showInbox, fmtAnswer, showTask, showAnswer, out } from './format.mjs';
import { ensureServer, serve } from './server.mjs';
import { mcpServer } from './mcp.mjs';

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
  keepr save [--back N] [--title T] [--summary S] [--origin O] [--point P]... [--tag X]... [--full]
          Saves an AI answer from the current Claude transcript.
          --back 1 = previous answer (default inside Claude), 0 = latest.
          --stdin: read the content from stdin instead.  --session ID: another session.
  keepr answers [--status open|followup|done] [--all]
  keepr show A3                   full answer incl. question, points, notes
  keepr answer A3 [--status S] [--title T] [--origin O] [--note N] [--tag X]
  keepr point A3 "text"           add a point
  keepr point A3 2 --done|--undone|--remove

Tasks (T…)
  keepr task add "title" [--desc D] [--origin O] [--prio urgent|high|normal|low] [--due YYYY-MM-DD]
                 [--status todo|in_progress|review|done] [--tag X]... [--sub S]... [--from A3 [--point 2]]
  keepr task list [--status S] [--tag X] [--all]  (without --all: hides done tasks)
  keepr next                      what to do first: overdue, due within 7 days, urgent/high without due date
  keepr task show T3
  keepr task update T3 [--title] [--desc] [--origin] [--prio] [--due|none] [--status] [--tag X]...
  keepr task start|review|done T3
  keepr task sub T3 "text" [--desc D] [--status S]   add a subtask
  keepr task sub T3 2 --done|--undone|--remove|--status S|--desc D|--text T
  keepr task link T3 T5 [--type relates|blocks|blocked_by]   (T3 blocks T5 / is blocked by T5)
  keepr task unlink T3 T5
  keepr task comment T3 "text" [--ai]
  keepr task rm T3

Inbox (I…) – things to clarify before they become a task
  keepr inbox [list] [--status open|clarified|dropped] [--all]
  keepr inbox add "what needs clarifying" [--note N] [--origin O] [--tag X]...
  keepr inbox show I3
  keepr inbox note I3 "text"      append to the notes
  keepr inbox update I3 [--title T] [--notes N] [--origin O] [--status S] [--tag X]...
  keepr inbox clarify|drop|reopen I3
  keepr inbox task I3 [--title T] [--desc D] [--origin O] [--prio P] [--due D] [--sub S]... [--keep-open]
                                  create a task from it (marks it clarified)
  keepr inbox rm I3

Day plan (B…) – time blocks per day: own entries, keepr tasks, or free windows for the AI to fill
  keepr plan [show] [today|tomorrow|YYYY-MM-DD]
  keepr plan add 09:00-10:30 ["title"] [--task T3] [--note N] [--date D]   (no title/task = free window)
  keepr plan free 14:00-17:00 [--date D]         mark a free window (an AI or autofill fills it)
  keepr plan update B3 [--time 10:00-11:00] [--title T] [--task T3|none] [--note N] [--date D]
  keepr plan done|undone B3
  keepr plan rm B3
  keepr plan autofill [--date D] [--max 90]      fill free windows with open tasks (no AI)

--origin: background – which question or observation led to this item, so it is still
understandable later. Tasks inherit it from their answer (--from) or inbox item.
Everywhere: --json for machine-readable output.`;

export const commands = {
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
      ...entry, title: opt.title, summary: opt.summary, origin: opt.origin, tags: tagsOf(opt), points: opt.point,
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
    const patch = { status: opt.status, title: opt.title, summary: opt.summary, origin: opt.origin };
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

  plan({ pos, opt }) {
    const [sub, ...rest] = pos;
    const fn = planCommands[sub || 'show'];
    if (!fn) throw new Error(`Unknown: keepr plan ${sub}. See keepr help.`);
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
        title, description: opt.desc, origin: opt.origin, priority: opt.prio, due: opt.due, status: opt.status,
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
      title: opt.title, description: opt.desc, origin: opt.origin, priority: opt.prio, status: opt.status,
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
    const i = mutate(requireRoot({ create: true }), d => ops['inbox.add'](d, { title: pos.join(' '), notes: opt.note, origin: opt.origin, tags: tagsOf(opt) }));
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
    const patch = { title: opt.title, notes: opt.notes, origin: opt.origin, status: opt.status };
    if (opt.tag) patch.tags = tagsOf(opt);
    const i = mutate(requireRoot(), d => ops['inbox.update'](d, { id: pos[0], patch }));
    out(opt, i, fmtInbox(i));
  },
  clarify: (a) => setInboxStatus(a, 'clarified'),
  drop: (a) => setInboxStatus(a, 'dropped'),
  reopen: (a) => setInboxStatus(a, 'open'),
  task({ pos, opt }) {
    const t = mutate(requireRoot(), d => ops['inbox.toTask'](d, {
      id: pos[0], keepOpen: opt['keep-open'], title: opt.title, description: opt.desc, origin: opt.origin, priority: opt.prio,
      due: opt.due, status: opt.status, tags: opt.tag ? tagsOf(opt) : undefined, subtasks: opt.sub,
    }));
    out(opt, t, `Created: ${fmtTask(t)}`);
  },
  rm({ pos, opt }) {
    const i = mutate(requireRoot(), d => ops['inbox.delete'](d, { id: pos[0] }));
    out(opt, i, `Deleted: ${i.id} – ${i.title}`);
  },
};

// "09:00-10:30" or "9-10.30" → [start, end]
function timeRange(v) {
  const m = String(v || '').match(/^([\d:.]+)\s*[-–]\s*([\d:.]+)$/);
  if (!m) throw new Error(`Time range missing or invalid ("${v ?? ''}") – e.g. 09:00-10:30`);
  return [m[1], m[2]];
}
const taskArg = (v) => v === undefined ? undefined : v === 'none' ? null : v;

const planCommands = {
  show({ pos, opt }) {
    const date = parseDate(opt.date || pos[0]);
    const d = readData(requireRoot());
    out(opt, dayBlocks(d, date), fmtPlan(d, date));
  },
  add({ pos, opt }) {
    const [start, end] = timeRange(pos[0]);
    const b = mutate(requireRoot({ create: true }), d => ops['plan.add'](d, {
      date: opt.date, start, end, title: opt.free ? '' : pos.slice(1).join(' '), taskId: opt.task, note: opt.note,
    }));
    out(opt, b, `Planned: ${b.id} ${b.date} ${b.start}–${b.end}${isFreeBlock(b) ? ' (free window)' : ''}`);
  },
  free({ pos, opt }) { planCommands.add({ pos: [pos[0]], opt: { ...opt, free: true } }); },
  update({ pos, opt }) {
    const [start, end] = opt.time ? timeRange(opt.time) : [];
    const b = mutate(requireRoot(), d => ops['plan.update'](d, {
      id: pos[0], patch: { date: opt.date, start, end, title: opt.title, taskId: taskArg(opt.task), note: opt.note },
    }));
    const d = readData(requireRoot());
    out(opt, b, fmtBlock(b, d));
  },
  done({ pos, opt }) { setBlockDone(pos, opt, true); },
  undone({ pos, opt }) { setBlockDone(pos, opt, false); },
  rm({ pos, opt }) {
    const bs = mutate(requireRoot(), d => pos.map(id => ops['plan.delete'](d, { id })));
    out(opt, bs, bs.map(b => `Removed: ${b.id} ${b.date} ${b.start}–${b.end}`).join('\n'));
  },
  autofill({ pos, opt }) {
    const root = requireRoot();
    const date = parseDate(opt.date || pos[0]);
    const added = mutate(root, d => ops['plan.autofill'](d, { date, maxMinutes: opt.max || 90 }));
    out(opt, added, `${added.length} block(s) filled.\n${fmtPlan(readData(root), date)}`);
  },
};

function setBlockDone(pos, opt, done) {
  const root = requireRoot();
  const bs = mutate(root, d => pos.map(id => ops['plan.update'](d, { id, patch: { done } })));
  const d = readData(root);
  out(opt, bs, bs.map(b => fmtBlock(b, d)).join('\n'));
}

function setInboxStatus({ pos, opt }, status) {
  const items = mutate(requireRoot(), d => pos.map(id => ops['inbox.update'](d, { id, patch: { status } })));
  out(opt, items, items.map(fmtInbox).join('\n'));
}

function setStatus({ pos, opt }, status) {
  const root = requireRoot();
  const tasks = mutate(root, d => pos.map(id => ops['task.update'](d, { id, patch: { status } })));
  out(opt, tasks, tasks.map(fmtTask).join('\n'));
}
