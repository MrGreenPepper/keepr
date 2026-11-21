// Labels, local storage, app state, markdown, API calls and small helpers.
// Classic scripts (not modules) that share one global scope, loaded in the order of index.html.

const LABEL = {
  todo: 'To do', in_progress: 'In progress', review: 'Review', done: 'Done',
  open: 'Open', followup: 'Follow-up', urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low',
  clarified: 'Clarified', dropped: 'Dropped', relates: 'Related to', blocks: 'Blocks', blocked_by: 'Blocked by',
};
const PRIO_MARK = { urgent: '⚑ Urgent', high: '⚑ High', normal: '', low: '↓ Low' };

const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('keepr.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('keepr.' + k, JSON.stringify(v)); } catch {} },
};
// One-time move of the settings stored before the rename (wf.* → keepr.*).
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('wf.')) continue;
    if (localStorage.getItem('keepr.' + k.slice(3)) === null) localStorage.setItem('keepr.' + k.slice(3), localStorage.getItem(k));
    localStorage.removeItem(k);
  }
} catch {}

const state = {
  projects: [], project: null, data: null,
  tab: ls.get('tab', 'answers'), aFilter: ls.get('aFilter', 'active'), view: ls.get('view', 'board'),
  showDone: ls.get('showDone', true), sel: null, task: null, q: '',
  iFilter: ls.get('iFilter', 'open'), isel: null, openSub: null, editing: null,
  day: null, dsel: null, ddraft: null,
};

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------ markdown (small, good enough)
// Turns IDs of existing items (T5, A3, I2) into links. Only outside of tags and existing links.
function linkRefs(html) {
  const d = state.data;
  if (!d) return html;
  let inA = 0;
  return html.split(/(<[^>]+>)/).map(part => {
    if (part.startsWith('<')) { if (/^<a[\s>]/.test(part)) inA++; else if (part === '</a>') inA--; return part; }
    if (inA) return part;
    return part.replace(/\b([ATI])(\d+)\b/g, (m) => {
      const kind = m[0], list = kind === 'A' ? d.answers : kind === 'T' ? d.tasks : d.inbox;
      const x = list.find(y => y.id === m);
      if (!x) return m;
      const done = ['done', 'clarified', 'dropped'].includes(x.status);
      return `<a href="#" class="ref ${done ? 'done' : ''}" data-ref="${m}" title="${esc(x.title)}">${m}</a>`;
    });
  }).join('');
}
function inline(s, refs = false) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => /^(https?:|vscode:|mailto:)/.test(u) ? `<a href="${u}" target="_blank" rel="noreferrer">${t}</a>` : `<span class="chip">${t}</span>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  if (refs) s = linkRefs(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}
function md(src, refs = false) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let html = '', i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`; continue;
    }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)/))) { const n = Math.min(m[1].length + 1, 4); html += `<h${n}>${inline(m[2], refs)}</h${n}>`; i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(l)) { html += '<hr>'; i++; continue; }
    if (l.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(l); i += 2;
      let rows = '';
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows += '<tr>' + cells(lines[i++]).map(c => `<td>${inline(c, refs)}</td>`).join('') + '</tr>';
      html += `<table><thead><tr>${head.map(c => `<th>${inline(c, refs)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`; continue;
    }
    if (/^>\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      html += `<blockquote>${md(buf.join('\n'), refs)}</blockquote>`; continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const items = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const ln = lines[i++];
        if (/^\s*([-*+]|\d+[.)])\s+/.test(ln) && !/^\s{2,}/.test(ln)) items.push(ln.replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
        else items[items.length - 1] += '\n' + ln.replace(/^\s{2,4}/, '');
      }
      const tag = ordered ? 'ol' : 'ul';
      html += `<${tag}>${items.map(it => {
        const [first, ...rest] = it.split('\n');
        const box = first.match(/^\[([ xX])\]\s+(.*)/);
        const head = box ? `<input type="checkbox" disabled ${box[1] !== ' ' ? 'checked' : ''}> ${inline(box[2], refs)}` : inline(first, refs);
        return `<li>${head}${rest.length ? md(rest.join('\n'), refs) : ''}</li>`;
      }).join('')}</${tag}>`; continue;
    }
    if (!l.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])
      && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) buf.push(lines[i++]);
    html += `<p>${buf.map(x => inline(x, refs)).join('<br>')}</p>`;
  }
  return html;
}

// ------------------------------------------------------------ api
async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error((await r.json()).error);
  return r.json();
}
async function op(name, args) { return opIn(state.project, name, args); }
async function opIn(project, name, args) {
  const r = await fetch(`/api/op?p=${encodeURIComponent(project)}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-keepr': '1' }, body: JSON.stringify({ op: name, args }),
  });
  const j = await r.json();
  if (!r.ok) { toast(j.error); throw new Error(j.error); }
  if (project === state.project) await load();
  return j.result;
}
async function load() {
  state.data = await api(`/api/data?p=${encodeURIComponent(state.project)}`);
  render();
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 1800);
}
async function copy(text, msg = 'Copied') {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast(msg);
}

// ------------------------------------------------------------ helpers
// Local calendar date (not UTC), like localDate() in keepr.mjs.
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function fmtDue(due) {
  if (!due) return '';
  const cls = due < today() ? 'overdue' : '';
  const d = new Date(due + 'T00:00');
  return `<span class="${cls}">📅 ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>`;
}
const matches = (obj, fields) => !state.q || fields.some(f => String(obj[f] ?? '').toLowerCase().includes(state.q));
// Links of a task in both directions, like taskLinks() in keepr.mjs.
function taskLinks(t) {
  const out = (t.links || []).map(l => ({ id: l.to, rel: l.type }));
  for (const x of state.data.tasks) for (const l of x.links || [])
    if (l.to === t.id) out.push({ id: x.id, rel: l.type === 'blocks' ? 'blocked_by' : 'relates' });
  return out;
}
const blockers = (t) => taskLinks(t).filter(l => l.rel === 'blocked_by')
  .map(l => state.data.tasks.find(x => x.id === l.id)).filter(x => x && x.status !== 'done');

// Markdown that turns into a textarea on click; saved on blur.
function editableMd(key, value, placeholder) {
  if (state.editing === key || !value)
    return `<textarea class="input desc" data-key="${key}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
  return `<div class="card md editable" data-edit="${key}" title="Click to edit">${md(value, true)}</div>`;
}
function bindEditable(root, save) {
  root.querySelectorAll('[data-edit]').forEach(el => el.onclick = (e) => {
    if (e.target.closest('a')) return;
    state.editing = el.dataset.edit; render();
    const ta = root.querySelector(`textarea[data-key="${el.dataset.edit}"]`) || document.querySelector(`textarea[data-key="${el.dataset.edit}"]`);
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  });
  root.querySelectorAll('textarea[data-key]').forEach(ta => {
    const orig = ta.value;
    ta.onblur = () => {
      state.editing = null;
      Promise.resolve(ta.value !== orig && save(ta.dataset.key, ta.value)).finally(() => render({ force: true }));
    };
  });
}

function vscodeLink(session, prompt) {
  const p = new URLSearchParams();
  if (session) p.set('session', session);
  if (prompt) p.set('prompt', prompt);
  return `vscode://anthropic.claude-code/open?${p.toString().replace(/\+/g, '%20')}`;
}

