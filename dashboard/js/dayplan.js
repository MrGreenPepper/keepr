// Day plan: time blocks and free windows.

// ------------------------------------------------------------ day plan
// Click or drag over the time grid to select a time window; it becomes an own entry, a linked task, or
// a free window that the AI (prompt button, MCP add_plan_blocks) or auto-fill fills later.
const SLOT = 30, SLOT_PX = 26, PX = SLOT_PX / SLOT;
const tmin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const tstr = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const isFree = (b) => !b.title && !b.taskId;
const shiftDate = (date, days) => { const d = new Date(date + 'T00:00'); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dur = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;

function dayBlocks(date = state.day) {
  return (state.data.plan || []).filter(b => b.date === date).sort((a, b) => a.start.localeCompare(b.start));
}
function dayRange(blocks) {
  const [from, to] = ls.get('dayRange', [7, 21]);
  let a = from * 60, z = to * 60;
  for (const b of blocks) { a = Math.min(a, Math.floor(tmin(b.start) / 60) * 60); z = Math.max(z, Math.ceil(tmin(b.end) / 60) * 60); }
  if (state.ddraft) { a = Math.min(a, tmin(state.ddraft.start)); z = Math.max(z, tmin(state.ddraft.end)); }
  return [a, Math.min(z, 24 * 60)];
}
// Free minutes after `start` until the next non-free block (for drops and new blocks).
function roomAfter(start, blocks, want = 60) {
  const next = blocks.filter(b => !isFree(b) && tmin(b.start) >= start).map(b => tmin(b.start));
  return Math.min(start + want, ...next, 24 * 60);
}

function renderDay() {
  state.day ||= today();
  const d = state.data, blocks = dayBlocks();
  const [a, z] = dayRange(blocks);
  const sum = (f) => blocks.filter(f).reduce((n, b) => n + tmin(b.end) - tmin(b.start), 0);
  const plannedIds = new Set(blocks.map(b => b.taskId).filter(Boolean));
  const nextIds = Object.values(d.next || {}).flat();
  const open = d.tasks.filter(t => t.status !== 'done' && matches(t, ['id', 'title', 'description']))
    .sort((x, y) => (nextIds.includes(x.id) ? nextIds.indexOf(x.id) : 999) - (nextIds.includes(y.id) ? nextIds.indexOf(y.id) : 999)
      || d.meta.PRIORITIES.indexOf(x.priority) - d.meta.PRIORITIES.indexOf(y.priority) || (x.order || 0) - (y.order || 0));
  const label = new Date(state.day + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const slots = [];
  const dr = state.ddraft && [tmin(state.ddraft.start), tmin(state.ddraft.end)];
  for (let m = a; m < z; m += SLOT) slots.push(`<div class="dslot ${m % 60 ? '' : 'hour'} ${dr && m + SLOT > dr[0] && m < dr[1] ? 'pick' : ''}" data-m="${m}"><span class="h">${m % 60 ? '' : tstr(m)}</span><span class="c"></span></div>`);
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const nowLine = state.day === today() && nowM >= a && nowM < z ? `<div class="now-line" style="top:${(nowM - a) * PX}px"></div>` : '';

  $('#main').innerHTML = `
    <div class="toolbar">
      <div class="seg" id="dnav"><button data-d="-1" title="Previous day">‹</button><button data-d="0" class="${state.day === today() ? 'on' : ''}">Today</button><button data-d="1" title="Next day">›</button></div>
      <input class="input" type="date" id="dpick" value="${state.day}">
      <b>${label}</b>
      <div class="spacer"></div>
      <span class="muted" style="font-size:12px">Click or drag in the grid · drag tasks onto it</span>
    </div>
    <div class="day">
      <div class="dgrid" id="dgrid" style="height:${(z - a) * PX}px">${slots.join('')}
        ${blocks.map(b => dayBlock(b, a)).join('')}${nowLine}</div>
      <div class="dside">
        ${dayEditor(blocks, open)}
        <div class="card">
          <h3>Let the AI plan</h3>
          <div class="dsum"><span>Planned <b>${dur(sum(b => !isFree(b)))}</b></span><span>Free windows <b>${dur(sum(isFree))}</b></span><span>Done <b>${blocks.filter(b => b.done).length}/${blocks.filter(b => !isFree(b)).length}</b></span></div>
          <p class="hint">Mark free windows in the grid, then hand them to your AI. It fills them via the keepr MCP tools or the CLI (<code>keepr plan</code>) – the grid updates live.</p>
          <div class="row" style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            <button class="btn primary" id="d-prompt" title="Copies a prompt for Claude, ChatGPT/Codex or any other agent">⧉ Prompt for AI</button>
            <button class="btn" id="d-auto" title="Fills free windows with open tasks: overdue, due soon, urgent first (max. 90 min each, no AI)">Auto-fill</button>
          </div>
        </div>
        <div class="card">
          <h3>Tasks <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">drag into the plan</span></h3>
          <div class="dtasks">${open.map(t => `<div class="dtask ${plannedIds.has(t.id) ? 'planned' : ''}" draggable="true" data-dtask="${t.id}" data-s="${t.status}">
            <span class="sdot" title="${LABEL[t.status]}"></span><span class="id">${t.id}</span><span class="t" title="${esc(t.title)}">${esc(t.title)}</span>
            <span class="meta">${plannedIds.has(t.id) ? '<span title="Already planned this day">✓</span>' : ''}${PRIO_MARK[t.priority] ? `<span class="prio ${t.priority}">${PRIO_MARK[t.priority].split(' ')[0]}</span>` : ''}${fmtDue(t.due)}</span></div>`).join('') || '<p class="hint">No open tasks.</p>'}</div>
        </div>
      </div>
    </div>`;
  bindDay(blocks, a);
}

function dayBlock(b, a) {
  const t = b.taskId && state.data.tasks.find(x => x.id === b.taskId);
  const kind = isFree(b) ? 'free' : t ? 'task' : 'own';
  const h = (tmin(b.end) - tmin(b.start)) * PX;
  const title = isFree(b) ? 'Free window – for the AI' : esc(b.title || t?.title || b.taskId);
  const sub = t ? ` <small>${t.id}${b.title && b.title !== t.title ? ` · ${esc(t.title)}` : ''}</small>` : '';
  return `<div class="dblock ${kind} ${b.done ? 'done' : ''} ${b.id === state.dsel ? 'sel' : ''}" data-b="${b.id}"
      style="top:${(tmin(b.start) - a) * PX + 1}px;height:${Math.max(h - 2, 14)}px" title="${b.start}–${b.end}${b.note ? ' · ' + esc(b.note) : ''}${b.by === 'ai' ? ' · planned by AI' : b.by === 'auto' ? ' · auto-filled' : ''}">
    ${isFree(b) ? '' : `<input type="checkbox" data-bdone="${b.id}" ${b.done ? 'checked' : ''} title="Done">`}
    <span class="t">${title}${sub}${h > 40 && b.note ? `<br><small>${esc(b.note)}</small>` : ''}</span>
    <span class="tm">${b.start}–${b.end}${b.by === 'ai' ? ' ✦' : ''}</span></div>`;
}

function dayEditor(blocks, open) {
  const b = state.dsel && blocks.find(x => x.id === state.dsel);
  const dr = state.ddraft;
  if (!b && !dr) return `<div class="card"><h3>Time block</h3><p class="hint">Click a slot or drag across several to select a time window. Then give it a title, link a keepr task, or leave it as a free window for the AI.</p></div>`;
  const cur = b || { start: dr.start, end: dr.end, title: '', taskId: '', note: '' };
  const tasks = [...open];
  if (cur.taskId && !tasks.some(t => t.id === cur.taskId)) { const t = state.data.tasks.find(x => x.id === cur.taskId); if (t) tasks.unshift(t); }
  return `<div class="card deditor">
    <h3>${b ? `${b.id} · ${isFree(b) ? 'free window' : 'block'}` : 'New block'}<span class="spacer"></span><button class="btn ghost sm" id="de-close">✕</button></h3>
    <div class="row"><input class="input" type="time" step="300" id="de-start" value="${cur.start}"> – <input class="input" type="time" step="300" id="de-end" value="${cur.end}"></div>
    <input class="input" id="de-title" placeholder="Own entry, e.g. Lunch, Emails, Gym" value="${esc(cur.title)}">
    <select class="input" id="de-task"><option value="">— no keepr task —</option>${tasks.map(t => `<option value="${t.id}" ${t.id === cur.taskId ? 'selected' : ''}>${t.id} – ${esc(t.title)}</option>`).join('')}</select>
    <textarea class="input" id="de-note" placeholder="Note (optional)">${esc(cur.note)}</textarea>
    <div class="row">
      <button class="btn primary" id="de-save">${b ? 'Save' : 'Add'}</button>
      <button class="btn" id="de-free" title="Keep it empty so the AI or auto-fill puts tasks in">Free window for AI</button>
      ${b?.taskId ? `<button class="btn ghost" id="de-open">Open ${b.taskId}</button>` : ''}
      ${b ? `<button class="btn ghost danger" id="de-del">Delete</button>` : ''}
    </div></div>`;
}

function bindDay(blocks, a) {
  const grid = $('#dgrid');
  $('#dnav').onclick = (e) => { const btn = e.target.closest('button'); if (!btn) return; const n = Number(btn.dataset.d); state.day = n ? shiftDate(state.day, n) : today(); state.dsel = state.ddraft = null; render(); };
  $('#dpick').onchange = (e) => { if (e.target.value) { state.day = e.target.value; state.dsel = state.ddraft = null; render(); } };

  // Select a time window by clicking or dragging over the slots.
  const slotAt = (y) => { const r = grid.getBoundingClientRect(); return a + Math.max(0, Math.floor((y - r.top) / SLOT_PX)) * SLOT; };
  let anchor = null;
  const paint = (s, e) => grid.querySelectorAll('.dslot').forEach(el => { const m = Number(el.dataset.m); el.classList.toggle('pick', m >= s && m < e); });
  grid.onmousedown = (e) => {
    if (e.button !== 0 || !e.target.closest('.dslot .c')) return;
    anchor = slotAt(e.clientY); paint(anchor, anchor + SLOT); e.preventDefault();
  };
  grid.onmousemove = (e) => { if (anchor === null) return; const m = slotAt(e.clientY); paint(Math.min(anchor, m), Math.max(anchor, m) + SLOT); };
  const finish = (e) => {
    if (anchor === null) return;
    const m = slotAt(e.clientY), s = Math.min(anchor, m), end = Math.max(anchor, m) + SLOT;
    anchor = null;
    state.dsel = null;
    state.ddraft = { start: tstr(s), end: tstr(s === end - SLOT ? roomAfter(s, blocks, 60) : end) };
    render(); $('#de-title')?.focus();
  };
  grid.onmouseup = finish;
  document.onmouseup = (e) => { if (anchor !== null && !grid.contains(e.target)) finish(e); };

  grid.querySelectorAll('[data-b]').forEach(el => el.onclick = (e) => {
    if (e.target.matches('input')) return;
    state.dsel = el.dataset.b; state.ddraft = null; render();
  });
  grid.querySelectorAll('[data-bdone]').forEach(el => el.onchange = () => op('plan.update', { id: el.dataset.bdone, patch: { done: el.checked } }));

  // Drag a task onto a slot or into a free window.
  document.querySelectorAll('[data-dtask]').forEach(el => {
    el.ondragstart = (e) => { e.dataTransfer.setData('text/keepr-task', el.dataset.dtask); e.dataTransfer.effectAllowed = 'copy'; };
    el.onclick = () => openTask(el.dataset.dtask);
  });
  const clearDrop = () => grid.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
  grid.ondragover = (e) => {
    if (!e.dataTransfer.types.includes('text/keepr-task')) return;
    e.preventDefault(); clearDrop();
    const fb = e.target.closest('.dblock.free');
    if (fb) fb.classList.add('drop'); else grid.querySelector(`.dslot[data-m="${slotAt(e.clientY)}"]`)?.classList.add('drop');
  };
  grid.ondragleave = (e) => { if (!grid.contains(e.relatedTarget)) clearDrop(); };
  grid.ondrop = (e) => {
    const id = e.dataTransfer.getData('text/keepr-task');
    clearDrop();
    if (!id) return;
    e.preventDefault();
    const fb = e.target.closest('.dblock.free');
    const free = fb && blocks.find(b => b.id === fb.dataset.b);
    const start = free ? tmin(free.start) : slotAt(e.clientY);
    const end = free ? Math.min(tmin(free.end), start + 60) : roomAfter(start, blocks, 60);
    op('plan.add', { date: state.day, start: tstr(start), end: tstr(end), taskId: id }).catch(() => {});
  };

  $('#d-prompt').onclick = () => copy(dayPrompt(blocks), 'Prompt copied – paste it into your AI chat');
  $('#d-auto').onclick = async () => {
    if (!blocks.some(isFree)) return toast('Mark a free window first');
    const added = await op('plan.autofill', { date: state.day });
    toast(added.length ? `${added.length} block(s) filled` : 'Nothing to fill');
  };

  if (!$('.deditor')) return;
  const b = state.dsel && blocks.find(x => x.id === state.dsel);
  const close = () => { state.dsel = state.ddraft = null; render(); };
  const vals = (free) => ({
    start: $('#de-start').value, end: $('#de-end').value,
    title: free ? '' : $('#de-title').value.trim(), taskId: free ? null : $('#de-task').value || null, note: $('#de-note').value,
  });
  const save = async (free) => {
    const v = vals(free);
    if (b) await op('plan.update', { id: b.id, patch: v });
    else await op('plan.add', { date: state.day, ...v });
    close();
  };
  $('#de-close').onclick = close;
  $('#de-save').onclick = () => save(false).catch(() => {});
  $('#de-free').onclick = () => save(true).catch(() => {});
  $('.deditor').onkeydown = (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); save(false).catch(() => {}); } };
  if ($('#de-open')) $('#de-open').onclick = () => openTask(b.taskId);
  if ($('#de-del')) $('#de-del').onclick = async () => { await op('plan.delete', { id: b.id }); close(); };
}

// Provider-neutral prompt: works with any agent that has the keepr MCP server or can run the CLI.
function dayPrompt(blocks) {
  const name = state.projects.find(p => p.path === state.project)?.name || state.project;
  const free = blocks.filter(isFree).map(b => `${b.start}–${b.end}`);
  const fixed = blocks.filter(b => !isFree(b)).map(b => `${b.start}–${b.end} ${b.taskId ? `${b.taskId} (${state.data.tasks.find(t => t.id === b.taskId)?.title || ''})` : b.title}`);
  return [
    `Plan my day ${state.day} in the keepr project "${name}".`,
    free.length ? `Free windows to fill: ${free.join(', ')}.` : 'No free windows are marked yet – suggest a plan for the usual working hours around the fixed blocks.',
    fixed.length ? `Already fixed: ${fixed.join('; ')}.` : '',
    'Choose suitable open keepr tasks (overdue, due soon, urgent/high first), realistic block lengths, short breaks and some buffer; add own blocks where useful. Briefly explain your choice.',
    `Use the keepr MCP tools get_day_plan and add_plan_blocks (project "${name}", date ${state.day}). Without MCP: keepr plan show ${state.day}, then keepr plan add HH:MM-HH:MM --task T3 --date ${state.day} (or a title instead of --task).`,
  ].filter(Boolean).join('\n');
}

