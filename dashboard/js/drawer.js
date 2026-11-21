// Task drawer: details, subtasks, links and comments of one task.

// ------------------------------------------------------------ task drawer
function openTask(id) { state.task = id; render(); $('#drawer').classList.add('open'); $('#drawer-bg').classList.add('open'); }
function closeTask() { state.task = null; $('#drawer').classList.remove('open'); $('#drawer-bg').classList.remove('open'); }

function renderDrawer(force = false) {
  const t = state.data.tasks.find(x => x.id === state.task);
  if (!t) return closeTask();
  const { STATUSES, PRIORITIES, LINK_TYPES } = state.data.meta;
  const ans = t.answerId && state.data.answers.find(a => a.id === t.answerId);
  const inb = t.inboxId && state.data.inbox.find(i => i.id === t.inboxId);
  const ae = document.activeElement;
  const typing = $('#drawer').contains(ae) && (ae.matches('textarea') || ['t-title', 't-tags', 'sub-text', 'l-to'].includes(ae.id));
  if (typing && !force) return; // don't overwrite while typing
  const keep = typing && ae.id ? { id: ae.id, value: ae.value, start: ae.selectionStart, end: ae.selectionEnd } : null;
  const done = t.subtasks.filter(s => s.done).length;
  const links = taskLinks(t);
  const others = state.data.tasks.filter(x => x.id !== t.id && !links.some(l => l.id === x.id));
  const pomoHere = P.s.task?.id === t.id && P.s.task?.project === state.project;
  const statusOpts = (cur) => STATUSES.map(s => `<option value="${s}" ${s === cur ? 'selected' : ''}>${LABEL[s]}</option>`).join('');
  $('#drawer').innerHTML = `
    <div style="display:flex;gap:8px;align-items:center"><span class="id">${t.id}</span><div class="spacer"></div>
      <button class="btn ghost sm" id="t-pomo" title="Start a pomodoro (focus session) on this task">🍅 ${pomoHere && P.s.running ? 'Running' : 'Focus'}</button>
      <button class="btn ghost sm" id="t-copy" title="For the chat with the AI">⧉ For Claude</button>
      <button class="btn ghost sm danger" id="t-del">Delete</button><button class="btn ghost" id="t-close">✕</button></div>
    <input class="title-edit" id="t-title" value="${esc(t.title)}" style="width:100%">
    <div class="props">
      <label>Status</label><select class="input" id="t-status">${statusOpts(t.status)}</select>
      <label>Priority</label><select class="input" id="t-prio">${PRIORITIES.map(s => `<option value="${s}" ${s === t.priority ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select>
      <label>Due</label><input class="input" type="date" id="t-due" value="${t.due || ''}">
      <label>Tags</label><input class="input" id="t-tags" value="${esc(t.tags.join(', '))}" placeholder="comma-separated">
      ${ans ? `<label>From answer</label><span><a href="#" data-ref="${ans.id}">${ans.id} – ${esc(ans.title)}</a>${t.answerPoint ? ` <span class="muted">(point ${t.answerPoint})</span>` : ''}</span>` : ''}
      ${inb ? `<label>From inbox</label><span><a href="#" data-ref="${inb.id}">${inb.id} – ${esc(inb.title)}</a></span>` : ''}
      ${t.pomodoros ? `<label>Focus</label><span>🍅 ${t.pomodoros} pomodoro${t.pomodoros === 1 ? '' : 's'} · ${t.focusMinutes || 0} min</span>` : ''}
    </div>
    <div class="section"><h3>Origin</h3>${editableMd('t-origin', t.origin || '', 'Which question or observation led to this? So you still understand later why the idea came up.')}</div>
    <div class="section"><h3>Description</h3>
      ${editableMd('t-desc', t.description, 'Details, context, definition of done… (Markdown, T5/A3/I2 become links)')}</div>
    <div class="section"><h3>Subtasks <span class="muted" style="text-transform:none;letter-spacing:0">${done}/${t.subtasks.length}</span></h3>
      ${t.subtasks.length ? `<div class="progress" style="margin-bottom:6px"><i style="width:${(done / t.subtasks.length) * 100}%"></i></div>` : ''}
      <div id="subs">${t.subtasks.map(s => {
        const open = state.openSub === `${t.id}/${s.id}`;
        return `<div class="check ${s.done ? 'done' : ''}" data-sid="${s.id}" data-s="${s.status}">
          <input type="checkbox" ${s.done ? 'checked' : ''}><span class="sdot" style="margin-top:6px" title="${LABEL[s.status]}"></span>
          <span class="txt" data-act="toggle" style="cursor:pointer">${inline(s.text, true)}${s.description && !open ? ' <span class="muted" title="Has a description">¶</span>' : ''}</span>
          ${s.status === 'in_progress' || s.status === 'review' ? `<span class="chip sub-st" data-s="${s.status}"><span class="sdot"></span>${LABEL[s.status]}</span>` : ''}
          <span class="acts"><button class="btn ghost sm" data-act="toggle" title="Status &amp; description">✎</button><button class="btn ghost sm" data-act="del" title="Remove">✕</button></span>
        </div>
        ${open ? `<div class="sub-edit" data-sid="${s.id}">
          <div class="row"><input class="input" id="sub-text" value="${esc(s.text)}"><select class="input" id="sub-status">${statusOpts(s.status)}</select></div>
          <textarea class="input" id="sub-desc" placeholder="Description (Markdown)">${esc(s.description)}</textarea>
          <div class="row" style="justify-content:flex-end"><button class="btn sm" data-act="close">Done</button></div>
        </div>` : s.description ? `<div class="sub-desc md">${md(s.description.split('\n')[0], true)}</div>` : ''}`;
      }).join('')}</div>
      <form class="add-row" id="s-add"><input class="input" placeholder="Add a subtask"><button class="btn">＋</button></form></div>
    <div class="section"><h3>Links</h3>
      <div id="links">${links.map(l => {
        const x = state.data.tasks.find(y => y.id === l.id);
        return `<div class="check" data-s="${x?.status || 'todo'}"><span class="sdot" style="margin-top:6px"></span>
          <span class="txt"><span class="muted">${LABEL[l.rel]}</span> <a href="#" class="ref ${x?.status === 'done' ? 'done' : ''}" data-ref="${l.id}">${l.id}</a> ${esc(x?.title || '')}</span>
          <span class="muted" style="font-size:12px">${x ? LABEL[x.status] : ''}</span>
          <span class="acts"><button class="btn ghost sm" data-unlink="${l.id}" title="Remove link">✕</button></span></div>`;
      }).join('')}</div>
      <form class="add-row" id="l-add">
        <select class="input" id="l-type">${LINK_TYPES.map(k => `<option value="${k}">${LABEL[k]}</option>`).join('')}</select>
        <input class="input" id="l-to" list="l-options" placeholder="Task ID or title">
        <datalist id="l-options">${others.map(x => `<option value="${x.id} – ${esc(x.title)}">`).join('')}</datalist>
        <button class="btn">Link</button></form></div>
    <div class="section"><h3>Comments</h3>
      ${t.comments.map(c => `<div class="comment ${c.author}"><div class="who">${c.author === 'ai' ? '🤖 AI' : 'You'} · ${fmtDate(c.at)}</div><div class="md">${md(c.text, true)}</div></div>`).join('')}
      <form class="add-row" id="c-add"><input class="input" placeholder="Write a comment"><button class="btn">Send</button></form></div>
    <div class="muted" style="font-size:12px;margin-top:20px">Created ${fmtDate(t.createdAt)} · Updated ${fmtDate(t.updatedAt)}${t.doneAt ? ` · Done ${fmtDate(t.doneAt)}` : ''}</div>`;

  if (keep && $('#' + keep.id)) { // forced re-render: keep focus and unsaved input
    const el = $('#' + keep.id);
    el.value = keep.value; el.focus();
    try { el.setSelectionRange(keep.start, keep.end); } catch {}
  }

  const upd = (patch) => op('task.update', { id: t.id, patch });
  $('#t-close').onclick = closeTask;
  $('#t-del').onclick = () => { if (confirm(`Delete ${t.id}?`)) { closeTask(); op('task.delete', { id: t.id }); } };
  $('#t-copy').onclick = () => copy(`Task ${t.id} ("${t.title}") – see \`keepr task show ${t.id}\`: `, 'Reference copied');
  $('#t-pomo').onclick = () => { pomoStart({ project: state.project, id: t.id, title: t.title }); pomoOpen(true); };
  $('#t-title').onchange = (e) => upd({ title: e.target.value });
  $('#t-status').onchange = (e) => upd({ status: e.target.value });
  $('#t-prio').onchange = (e) => upd({ priority: e.target.value });
  $('#t-due').onchange = (e) => upd({ due: e.target.value || null });
  $('#t-tags').onchange = (e) => upd({ tags: e.target.value.split(',').map(x => x.trim()).filter(Boolean) });
  bindEditable($('#drawer'), (k, v) => upd(k === 't-origin' ? { origin: v } : { description: v }));
  $('#s-add').onsubmit = (e) => { e.preventDefault(); const v = e.target[0].value.trim(); if (v) op('task.sub.add', { id: t.id, text: v }).then(() => $('#s-add input')?.focus()); };
  $('#c-add').onsubmit = (e) => { e.preventDefault(); const v = e.target[0].value.trim(); if (v) op('task.comment', { id: t.id, text: v }); };
  $('#subs').onclick = (e) => {
    if (e.target.closest('[data-ref]')) return;
    const row = e.target.closest('[data-sid]'); if (!row) return;
    const sub = Number(row.dataset.sid);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (e.target.matches('input[type=checkbox]')) op('task.sub.update', { id: t.id, sub, done: e.target.checked });
    else if (act === 'del') op('task.sub.update', { id: t.id, sub, remove: true });
    else if (act === 'toggle' || act === 'close') {
      const key = `${t.id}/${sub}`;
      state.openSub = state.openSub === key || act === 'close' ? null : key;
      document.activeElement?.blur(); renderDrawer();
    }
  };
  const openSub = state.openSub?.startsWith(t.id + '/') && Number(state.openSub.split('/')[1]);
  if (openSub && $('#sub-text')) {
    const su = (args) => op('task.sub.update', { id: t.id, sub: openSub, ...args });
    $('#sub-text').onchange = (e) => e.target.value.trim() && su({ text: e.target.value.trim() });
    $('#sub-status').onchange = (e) => su({ status: e.target.value });
    const orig = $('#sub-desc').value;
    $('#sub-desc').onblur = (e) => { if (e.target.value !== orig) su({ description: e.target.value }); };
  }
  $('#links').onclick = (e) => {
    const b = e.target.closest('[data-unlink]');
    if (b) op('task.unlink', { id: t.id, to: b.dataset.unlink });
  };
  $('#l-add').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#l-to').value.trim(); if (!v) return;
    const id = v.match(/^T\d+/i)?.[0].toUpperCase() || state.data.tasks.find(x => x.title.toLowerCase() === v.toLowerCase())?.id;
    if (!id) return toast('No matching task');
    op('task.link', { id: t.id, to: id, type: $('#l-type').value });
  };
}

