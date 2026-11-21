// Inbox: things still to clarify.

// ------------------------------------------------------------ inbox
function renderInbox() {
  const d = state.data;
  const f = state.iFilter;
  const list = d.inbox
    .filter(i => f === 'all' || i.status === f)
    .filter(i => matches(i, ['id', 'title', 'origin', 'notes']) || i.tags.some(t => t.includes(state.q)));
  const sel = d.inbox.find(i => i.id === state.isel);
  const n = (s) => d.inbox.filter(i => i.status === s).length;

  $('#main').innerHTML = `
    <div class="toolbar">
      <div class="seg" id="ifilter">
        ${[['open', `Open (${n('open')})`], ['clarified', 'Clarified'], ['dropped', 'Dropped'], ['all', 'All']]
          .map(([k, l]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <form class="capture" id="capture"><input class="input" placeholder="What still needs clarifying? (Enter)"><button class="btn primary">＋ Inbox</button></form>
      <div class="spacer"></div>
      <span class="muted" style="font-size:12px">From Claude: <code>/inbox</code></span>
    </div>
    <div class="split ${sel ? 'has-sel' : ''}">
      <div class="alist">${list.length ? list.map(inboxItem).join('') : `<div class="empty">Nothing to clarify${f === 'open' ? '' : ' here'}.<br>Capture open questions and unclear ideas above. Once they're clear, turn them into a task.</div>`}</div>
      <div class="adetail">${sel ? inboxDetail(sel) : `<div class="empty">Select an item</div>`}</div>
    </div>`;

  $('#ifilter').onclick = (e) => { const b = e.target.closest('button'); if (b) { state.iFilter = b.dataset.f; ls.set('iFilter', b.dataset.f); render(); } };
  $('#capture').onsubmit = async (e) => {
    e.preventDefault();
    const v = e.target[0].value.trim(); if (!v) return;
    e.target[0].value = '';
    const i = await op('inbox.add', { title: v });
    toast(`${i.id} added`);
    $('#capture input')?.focus();
  };
  document.querySelectorAll('.aitem').forEach(el => el.onclick = () => selectInbox(el.dataset.id));
  if (sel) bindInboxDetail(sel);
}

function inboxItem(i) {
  const first = i.notes.split('\n').find(l => l.trim()) || '';
  return `<div class="aitem ${i.id === state.isel ? 'sel' : ''}" data-id="${i.id}" data-s="${i.status}">
    <div class="top"><span class="sdot" title="${LABEL[i.status]}"></span><span class="title">${esc(i.title)}</span><span class="id">${i.id}</span></div>
    ${first ? `<div class="sum">${esc(first)}</div>` : ''}
    <div class="meta"><span class="muted">${fmtDate(i.createdAt)}</span>
      ${i.taskIds.map(t => `<span class="chip">→ ${t}</span>`).join('')}
      ${i.tags.map(t => `<span class="chip tag">${esc(t)}</span>`).join('')}
    </div></div>`;
}

function inboxDetail(i) {
  const tasks = i.taskIds.map(id => state.data.tasks.find(t => t.id === id)).filter(Boolean);
  return `
    <div class="head" data-s="${i.status}">
      <button class="btn ghost sm" id="back" style="display:none">← List</button>
      <input class="title-edit" id="i-title" value="${esc(i.title)}">
      <select class="input" id="i-status">${state.data.meta.INBOX_STATUSES.map(s => `<option value="${s}" ${s === i.status ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select>
    </div>
    <div class="muted" style="font-size:12.5px"><span class="id">${i.id}</span> · ${fmtDate(i.createdAt)}</div>
    <div class="actions">
      <button class="btn primary" id="i-task" title="Create a task from this item and mark it clarified">→ Task</button>
      <button class="btn" id="i-copy" title="For the chat with the AI">⧉ For Claude</button>
      <div class="spacer"></div>
      <button class="btn ghost danger" id="i-del">Delete</button>
    </div>
    <div class="props" style="margin-top:0"><label>Tags</label><input class="input" id="i-tags" value="${esc(i.tags.join(', '))}" placeholder="comma-separated"></div>
    <div class="section"><h3>Origin</h3>${editableMd('i-origin', i.origin || '', 'Which question or observation led to this? So you still understand later why the idea came up.')}</div>
    <div class="section"><h3>Notes</h3>${editableMd('i-notes', i.notes, 'What do you know so far, who to ask, what is unclear… (Markdown, T5/A3 become links)')}</div>
    ${tasks.length ? `<div class="section"><h3>Tasks from this</h3>${tasks.map(t => `<div class="check" data-s="${t.status}"><span class="sdot" style="margin-top:6px"></span><span class="txt"><a href="#" data-ref="${t.id}">${esc(t.title)}</a> <span class="id">${t.id}</span></span><span class="muted" style="font-size:12px">${LABEL[t.status]}</span></div>`).join('')}</div>` : ''}`;
}

function bindInboxDetail(i) {
  if (matchMedia('(max-width: 760px)').matches) { $('#back').style.display = ''; $('#back').onclick = () => selectInbox(null); }
  const upd = (patch) => op('inbox.update', { id: i.id, patch });
  $('#i-title').onchange = (e) => upd({ title: e.target.value });
  $('#i-status').onchange = (e) => upd({ status: e.target.value });
  $('#i-tags').onchange = (e) => upd({ tags: e.target.value.split(',').map(x => x.trim()).filter(Boolean) });
  bindEditable($('.adetail'), (k, v) => upd(k === 'i-origin' ? { origin: v } : { notes: v }));
  $('#i-copy').onclick = () => copy(`Regarding inbox item ${i.id} ("${i.title}"), see \`keepr show ${i.id}\`: `, 'Reference copied');
  $('#i-del').onclick = () => { if (confirm(`Delete ${i.id}?`)) { state.isel = null; op('inbox.delete', { id: i.id }); } };
  $('#i-task').onclick = async () => { const t = await op('inbox.toTask', { id: i.id }); openTask(t.id); };
}

function selectInbox(id) {
  state.isel = id;
  history.replaceState(null, '', location.pathname + location.search + (id ? '#' + id : ''));
  render();
}

