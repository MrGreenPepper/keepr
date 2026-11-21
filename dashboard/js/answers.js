// Rendering of the main view and the saved answers.

// ------------------------------------------------------------ render
function render({ force = false } = {}) {
  if (!state.data) return;
  const d = state.data;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  $('#c-answers').textContent = d.answers.filter(a => a.status !== 'done').length || '';
  $('#c-tasks').textContent = d.tasks.filter(t => t.status !== 'done').length || '';
  $('#c-inbox').textContent = d.inbox.filter(i => i.status === 'open').length || '';
  $('#c-day').textContent = (d.plan || []).filter(b => b.date === today() && !b.done && (b.title || b.taskId)).length || '';
  ls.set('tab', state.tab);
  // Don't overwrite a text field in the main area while typing.
  const ae = document.activeElement;
  const typing = $('#main').contains(ae) && (ae.matches('textarea') || !!ae.closest('.deditor'));
  if (!typing) {
    if (state.tab === 'answers') renderAnswers();
    else if (state.tab === 'inbox') renderInbox();
    else if (state.tab === 'day') renderDay();
    else renderTasks();
  }
  if (state.task) renderDrawer(force);
  pomoPaint(true);
}

function renderAnswers() {
  const d = state.data;
  const f = state.aFilter;
  const list = d.answers
    .filter(a => f === 'all' || (f === 'active' ? a.status !== 'done' : a.status === f))
    .filter(a => matches(a, ['id', 'title', 'summary', 'origin', 'content', 'prompt', 'notes']) || a.tags.some(t => t.includes(state.q)));
  const sel = d.answers.find(a => a.id === state.sel);
  const counts = { active: d.answers.filter(a => a.status !== 'done').length, followup: d.answers.filter(a => a.status === 'followup').length };

  $('#main').innerHTML = `
    <div class="toolbar">
      <div class="seg" id="afilter">
        ${[['active', `Active (${counts.active})`], ['followup', `Follow-up (${counts.followup})`], ['done', 'Done'], ['all', 'All']]
          .map(([k, l]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <div class="spacer"></div>
      <span class="muted" style="font-size:12px">Save from Claude: <code>/keep</code></span>
    </div>
    <div class="split ${sel ? 'has-sel' : ''}">
      <div class="alist">${list.length ? list.map(answerItem).join('') : `<div class="empty">No answers yet.<br>Say <b>/keep</b> in Claude to save the last answer here.</div>`}</div>
      <div class="adetail">${sel ? answerDetail(sel) : `<div class="empty">Select an answer</div>`}</div>
    </div>`;

  $('#afilter').onclick = (e) => { const b = e.target.closest('button'); if (b) { state.aFilter = b.dataset.f; ls.set('aFilter', b.dataset.f); render(); } };
  document.querySelectorAll('.aitem').forEach(el => el.onclick = () => selectAnswer(el.dataset.id));
  if (sel) bindAnswerDetail(sel);
}

function answerItem(a) {
  const open = a.points.filter(p => !p.done).length;
  const tasks = state.data.tasks.filter(t => t.answerId === a.id);
  return `<div class="aitem ${a.id === state.sel ? 'sel' : ''}" data-id="${a.id}" data-s="${a.status}">
    <div class="top"><span class="sdot" title="${LABEL[a.status]}"></span><span class="title">${esc(a.title)}</span><span class="id">${a.id}</span></div>
    ${a.summary ? `<div class="sum">${esc(a.summary)}</div>` : ''}
    <div class="meta"><span class="muted">${fmtDate(a.createdAt)}</span>
      ${a.points.length ? `<span class="chip">${open ? `${open}/${a.points.length} points open` : '✓ points done'}</span>` : ''}
      ${tasks.length ? `<span class="chip">${tasks.length} task${tasks.length === 1 ? "" : "s"}</span>` : ''}
      ${a.tags.map(t => `<span class="chip tag">${esc(t)}</span>`).join('')}
    </div></div>`;
}

function answerDetail(a) {
  const tasks = state.data.tasks.filter(t => t.answerId === a.id);
  const resumePrompt = `Regarding saved answer ${a.id} ("${a.title}"): `;
  return `
    <div class="head" data-s="${a.status}">
      <button class="btn ghost sm" id="back" style="display:none">← List</button>
      <input class="title-edit" id="a-title" value="${esc(a.title)}">
      <select class="input" id="a-status">${state.data.meta.ANSWER_STATUSES.map(s => `<option value="${s}" ${s === a.status ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select>
    </div>
    <div class="muted" style="font-size:12.5px"><span class="id">${a.id}</span> · ${fmtDate(a.createdAt)}${a.session ? ` · Session <span class="id">${a.session.slice(0, 8)}</span>` : ''}
      ${a.tags.map(t => `<span class="chip tag">${esc(t)}</span>`).join(' ')}</div>
    <div class="actions">
      ${a.session ? `<a class="btn primary" href="${esc(vscodeLink(a.session, resumePrompt))}" title="Opens exactly this Claude session in VS Code with a follow-up prepared">↩ Jump to session</a>` : ''}
      ${a.chatUrl ? `<a class="btn primary" href="${esc(a.chatUrl)}" target="_blank" rel="noreferrer" title="Opens the chat this answer came from">↩ Open chat</a>` : ''}
      <a class="btn" href="${esc(vscodeLink(null, `/ref ${a.id} `))}" title="New Claude session in VS Code that loads this answer as context">＋ Follow-up in new session</a>
      ${a.session ? `<button class="btn" id="copy-resume" title="For the terminal">⧉ claude --resume</button>` : ''}
      <button class="btn" id="copy-ref" title="For the chat with the AI">⧉ /ref ${a.id}</button>
      <button class="btn" id="a-task">→ Task</button>
      <button class="btn ghost" id="a-chat" title="Store a chat link, e.g. from Claude Desktop">🔗 ${a.chatUrl ? 'Change link' : 'Chat link'}</button>
      <div class="spacer"></div>
      <button class="btn ghost danger" id="a-del">Delete</button>
    </div>
    ${a.summary ? `<div class="card" style="background:var(--accent-soft);border-color:transparent;box-shadow:none">${esc(a.summary)}</div>` : ''}
    <div class="section"><h3>Origin</h3>${editableMd('a-origin', a.origin || '', 'Which question or observation led to this? So you still understand later why the idea came up.')}</div>
    <div class="section"><h3>Open points <span class="muted" style="text-transform:none;letter-spacing:0">${a.points.filter(p => p.done).length}/${a.points.length}</span></h3>
      <div id="points">${a.points.map(p => {
        const t = tasks.find(x => x.answerPoint === p.id);
        return `<div class="check ${p.done ? 'done' : ''}" data-pid="${p.id}">
          <input type="checkbox" ${p.done ? 'checked' : ''}><span class="txt">${inline(p.text)}</span>
          ${t ? `<span class="chip link" data-task="${t.id}" data-s="${t.status}"><span class="sdot"></span>${t.id}</span>` : ''}
          <span class="acts">${t ? '' : `<button class="btn ghost sm" data-act="task" title="Create as task">→ Task</button>`}<button class="btn ghost sm" data-act="del" title="Remove">✕</button></span>
        </div>`;
      }).join('')}</div>
      <form class="add-row" id="p-add"><input class="input" placeholder="Add a point, e.g. &quot;Ask later: …&quot;"><button class="btn">＋</button></form>
    </div>
    ${tasks.length ? `<div class="section"><h3>Linked tasks</h3>${tasks.map(t => `<div class="check" data-s="${t.status}"><span class="sdot" style="margin-top:6px"></span><span class="txt"><a href="#" data-task="${t.id}">${esc(t.title)}</a> <span class="id">${t.id}</span></span><span class="muted" style="font-size:12px">${LABEL[t.status]}</span></div>`).join('')}</div>` : ''}
    ${a.prompt ? `<div class="section"><h3>Your question</h3><div class="prompt">${esc(a.prompt)}</div></div>` : ''}
    <div class="section"><h3>Answer <button class="btn ghost sm" id="copy-content">⧉ copy</button></h3><div class="card md">${md(a.content)}</div></div>
    <div class="section"><h3>Notes</h3><textarea class="input desc" id="a-notes" placeholder="Your notes…">${esc(a.notes)}</textarea></div>`;
}

function bindAnswerDetail(a) {
  if (matchMedia('(max-width: 760px)').matches) { $('#back').style.display = ''; $('#back').onclick = () => selectAnswer(null); }
  $('#a-title').onchange = (e) => op('answer.update', { id: a.id, patch: { title: e.target.value } });
  $('#a-status').onchange = (e) => op('answer.update', { id: a.id, patch: { status: e.target.value } });
  $('#a-notes').onchange = (e) => op('answer.update', { id: a.id, patch: { notes: e.target.value } });
  bindEditable($('.adetail'), (_, v) => op('answer.update', { id: a.id, patch: { origin: v } }));
  $('#copy-content').onclick = () => copy(a.content);
  $('#copy-ref').onclick = () => copy(`/ref ${a.id} `, `"/ref ${a.id}" copied, paste it into Claude`);
  if ($('#copy-resume')) $('#copy-resume').onclick = () => copy(`claude --resume ${a.session}`);
  $('#a-chat').onclick = () => {
    const url = prompt('Link to the chat (empty = remove):', a.chatUrl || '');
    if (url !== null) op('answer.update', { id: a.id, patch: { chatUrl: url.trim() || null } });
  };
  $('#a-del').onclick = () => { if (confirm(`Delete ${a.id}?`)) { state.sel = null; op('answer.delete', { id: a.id }); } };
  $('#a-task').onclick = async () => {
    const t = await op('task.add', { title: a.title, description: a.summary || '', origin: a.origin || '', answerId: a.id });
    openTask(t.id);
  };
  $('#p-add').onsubmit = (e) => { e.preventDefault(); const v = e.target[0].value.trim(); if (v) op('answer.point.add', { id: a.id, text: v }); };
  $('#points').onclick = async (e) => {
    const row = e.target.closest('[data-pid]'); if (!row) return;
    const point = Number(row.dataset.pid);
    if (e.target.matches('input[type=checkbox]')) return op('answer.point.update', { id: a.id, point, done: e.target.checked });
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'del') return op('answer.point.update', { id: a.id, point, remove: true });
    if (act === 'task') {
      const p = a.points.find(x => x.id === point);
      const t = await op('task.add', { title: p.text, answerId: a.id, answerPoint: point });
      toast(`${t.id} created`);
    }
  };
  document.querySelectorAll('.adetail [data-task]').forEach(el => el.onclick = (e) => { e.preventDefault(); openTask(el.dataset.task); });
}

function selectAnswer(id) {
  state.sel = id;
  history.replaceState(null, '', location.pathname + location.search + (id ? '#' + id : ''));
  render();
}

