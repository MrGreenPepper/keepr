import { now } from './storage.mjs';
import { nextId, localDate } from './ops.mjs';

// ---------------------------------------------------------------- day plan
// Time blocks per day (B1, B2 …): own entries (title), linked keepr tasks (taskId) or free windows
// (neither) that the user marks and an AI – or plan.autofill – fills later. Blocks of one day never
// overlap; a new block inside a free window cuts that window down instead.

export const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export const isFreeBlock = (b) => !b.title && !b.taskId;

// "9" → 09:00, "9.30" / "9:30" → 09:30, "24:00" allowed as end of day.
export function normTime(v, what) {
  let s = String(v ?? '').trim().replace('.', ':');
  if (/^\d{1,2}$/.test(s)) s += ':00';
  if (/^\d:\d\d$/.test(s)) s = '0' + s;
  if (!/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(s)) throw new Error(`Invalid ${what} "${v}" – use HH:MM`);
  return s;
}

// today / tomorrow / yesterday / +2 / YYYY-MM-DD → YYYY-MM-DD
export function parseDate(v) {
  if (!v || v === true || v === 'today') return localDate();
  if (v === 'tomorrow') return localDate(1);
  if (v === 'yesterday') return localDate(-1);
  if (/^[+-]\d+$/.test(v)) return localDate(Number(v));
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + 'T00:00'))) return v;
  throw new Error(`Invalid date "${v}" – use YYYY-MM-DD, today or tomorrow`);
}

export function dayBlocks(data, date) {
  return data.plan.filter(b => b.date === date).sort((a, b) => a.start.localeCompare(b.start));
}

export function getBlock(data, id) {
  const b = data.plan.find(x => x.id.toLowerCase() === String(id).toLowerCase());
  if (!b) throw new Error(`Block ${id} not found`);
  return b;
}

// Checks a block against the other blocks of its day and cuts overlapping free windows.
export function placeBlock(data, block) {
  const s = toMin(block.start), e = toMin(block.end);
  if (e <= s) throw new Error(`Block ends before it starts (${block.start}–${block.end})`);
  const others = dayBlocks(data, block.date).filter(x => x.id !== block.id && toMin(x.start) < e && toMin(x.end) > s);
  const clash = others.filter(x => isFreeBlock(block) || !isFreeBlock(x));
  if (clash.length) throw new Error(`${block.start}–${block.end} overlaps ${clash.map(x => `${x.id} (${x.start}–${x.end})`).join(', ')}`);
  for (const f of others) {
    const parts = [[toMin(f.start), s], [e, toMin(f.end)]].filter(([a, b]) => b > a);
    if (!parts.length) { data.plan = data.plan.filter(x => x !== f); continue; }
    [f.start, f.end] = parts[0].map(fromMin);
    f.updatedAt = now();
    if (parts[1]) data.plan.push({ ...f, id: nextId(data, 'B'), start: fromMin(parts[1][0]), end: fromMin(parts[1][1]), createdAt: now() });
  }
}
