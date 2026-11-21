// Tasks: board, list and "next up".

// ------------------------------------------------------------ tasks
function visibleTasks() {
  return state.data.tasks
    .filter(t => matches(t, ['id', 'title', 'origin', 'description']) || t.tags.some(x => x.includes(state.q))
      || t.subtasks.some(x => x.text.toLowerCase().includes(state.q)))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function renderTasks() {
  const { STATUSES } = state.data.meta;
  const tasks = visibleTasks();
  const cols = STATUSES.filter(s => state.showDone || s !== 'done');
  $('#main').innerHTML = `
    <div class="toolbar">
      <div class="seg" id="view">
        <button data-v="board" class="${state.view === 'board' ? 'on' : ''}">▦ Board</button>
        <button data-v="list" class="${state.view === 'list' ? 'on' : ''}">☰ List</button>
      </div>
      <label class="muted" style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="show-done" ${state.showDone ? 'checked' : ''}> Show done</label>
      <div class="spacer"></div>
      <span class="muted" style="font-size:12px">From Claude: <code>/task</code></span>
      <button class="btn primary" id="new-task">＋ Task</button>
    </div>
    ${nextUp()}
    ${state.view === 'board' ? `<div class="board">${cols.map(s => column(s, tasks.filter(t => t.status === s))).join('')}</div>`
      : `<div class="tlist">${cols.map(s => listGroup(s, tasks.filter(t => t.status === s))).join('')}</div>`}`;

  $('#view').onclick = (e) => { const b = e.target.closest('button'); if (b) { state.view = b.dataset.v; ls.set('view', b.dataset.v); render(); } };
  $('#show-done').onchange = (e) => { state.showDone = e.target.checked; ls.set('showDone', state.showDone); render(); };
  $('#new-task').onclick = () => quickAdd('todo');
  document.querySelectorAll('[data-open]').forEach(el => el.onclick = (e) => { if (!e.target.closest('select')) openTask(el.dataset.open); });
  document.querySelectorAll('.quick').forEach(el => el.onclick = () => quickAdd(el.dataset.status));
  document.querySelectorAll('.trow select').forEach(el => el.onchange = () => op('task.update', { id: el.dataset.id, patch: { [el.dataset.k]: el.value } }));
  if (state.view === 'board') bindDnD();
}

// "Next up" reminder. The selection comes from the server (nextTasks() in keepr.mjs), same as keepr next.
function nextUp() {
  const { next, tasks, meta } = state.data;
  if (!next) return '';
  const groups = Object.entries(meta.NEXT_GROUPS)
    .map(([k, label]) => [k, label, next[k].map(id => tasks.find(t => t.id === id)).filter(Boolean)])
    .filter(([, , list]) => list.length);
  if (!groups.length) return '';
  return `<div class="card nextup"><h3>Next up</h3>${groups.map(([k, label, list]) => `<div>
    <div class="ng-head ${k === 'overdue' ? 'overdue' : ''}">${label} <span class="muted" style="font-weight:500">${list.length}</span></div>
    ${list.map(t => `<div class="nrow" data-open="${t.id}" data-s="${t.status}"><span class="sdot" title="${LABEL[t.status]}"></span><span class="id">${t.id}</span>
      <span class="t">${esc(t.title)}</span>
      <span class="meta">${PRIO_MARK[t.priority] ? `<span class="prio ${t.priority}">${PRIO_MARK[t.priority]}</span>` : ''}${fmtDue(t.due)}</span></div>`).join('')}
  </div>`).join('')}</div>`;
}

function column(s, tasks) {
  return `<div class="col" data-col="${s}" data-s="${s}">
    <div class="col-head"><span class="sdot"></span>${LABEL[s]} <span class="n">${tasks.length}</span></div>
    <div class="col-body">${tasks.map(taskCard).join('')}<button class="quick" data-status="${s}">＋ Task</button></div>
  </div>`;
}

function taskCard(t) {
  const done = t.subtasks.filter(s => s.done).length;
  const blocked = blockers(t);
  const links = taskLinks(t).length;
  return `<div class="tcard" draggable="true" data-open="${t.id}" data-id="${t.id}">
    <div class="t">${esc(t.title)}</div>
    ${t.subtasks.length ? `<div class="progress"><i style="width:${(done / t.subtasks.length) * 100}%"></i></div>` : ''}
    <div class="meta"><span class="id">${t.id}</span>
      ${PRIO_MARK[t.priority] ? `<span class="prio ${t.priority}">${PRIO_MARK[t.priority]}</span>` : ''}
      ${fmtDue(t.due)}
      ${t.subtasks.length ? `<span>☑ ${done}/${t.subtasks.length}</span>` : ''}
      ${t.comments.length ? `<span>💬 ${t.comments.length}</span>` : ''}
      ${blocked.length ? `<span class="chip blocked" title="Waiting for ${blocked.map(x => x.id).join(', ')}">⛔ ${blocked.map(x => x.id).join(', ')}</span>` : links ? `<span title="Links">🔗 ${links}</span>` : ''}
      ${t.pomodoros ? `<span title="${t.focusMinutes || 0} min focus">🍅 ${t.pomodoros}</span>` : ''}
      ${t.answerId ? `<span class="chip">↩ ${t.answerId}</span>` : ''}
      ${t.inboxId ? `<span class="chip">↩ ${t.inboxId}</span>` : ''}
      ${t.tags.map(x => `<span class="chip tag">${esc(x)}</span>`).join('')}
    </div></div>`;
}

function listGroup(s, tasks) {
  const { STATUSES, PRIORITIES } = state.data.meta;
  const sel = (t, k, vals) => `<select data-id="${t.id}" data-k="${k}">${vals.map(v => `<option value="${v}" ${t[k] === v ? 'selected' : ''}>${LABEL[v]}</option>`).join('')}</select>`;
  return `<div class="group" data-s="${s}">
    <div class="group-head"><span class="sdot"></span>${LABEL[s]} <span class="muted">${tasks.length}</span></div>
    ${tasks.length ? `<div class="thead"><span>ID</span><span>Task</span><span>Status</span><span>Priority</span><span>Due</span><span>Subt.</span></div>` : ''}
    <div>${tasks.map(t => `<div class="trow" data-open="${t.id}">
      <span class="id">${t.id}</span>
      <span class="t">${esc(t.title)} ${blockers(t).length ? '<span class="chip blocked">⛔</span>' : ''} ${t.tags.map(x => `<span class="chip tag">${esc(x)}</span>`).join(' ')}</span>
      ${sel(t, 'status', STATUSES)}${sel(t, 'priority', PRIORITIES)}
      <span style="font-size:12.5px">${fmtDue(t.due) || '<span class="muted">–</span>'}</span>
      <span class="muted" style="font-size:12.5px">${t.subtasks.length ? `${t.subtasks.filter(x => x.done).length}/${t.subtasks.length}` : '–'}</span>
    </div>`).join('')}</div>
    <button class="quick" style="margin-top:6px;width:100%" data-status="${s}">＋ Task</button>
  </div>`;
}

function bindDnD() {
  let dragId = null;
  document.querySelectorAll('.tcard').forEach(c => {
    c.ondragstart = (e) => { dragId = c.dataset.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
    c.ondragend = () => c.classList.remove('dragging');
  });
  document.querySelectorAll('.col').forEach(col => {
    const body = $('.col-body', col);
    col.ondragover = (e) => {
      e.preventDefault(); col.classList.add('over');
      const dragging = $('.tcard.dragging'); if (!dragging) return;
      const after = [...body.querySelectorAll('.tcard:not(.dragging)')].find(el => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
      body.insertBefore(dragging, after || $('.quick', body));
    };
    col.ondragleave = (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); };
    col.ondrop = (e) => {
      e.preventDefault(); col.classList.remove('over');
      if (!dragId) return;
      const orderedIds = [...body.querySelectorAll('.tcard')].map(el => el.dataset.id);
      op('task.move', { id: dragId, status: col.dataset.col, orderedIds });
      dragId = null;
    };
  });
}

async function quickAdd(status) {
  const title = prompt('New task:');
  if (!title?.trim()) return;
  const t = await op('task.add', { title: title.trim(), status });
  openTask(t.id);
}

