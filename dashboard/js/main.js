// Start-up. Loaded last: the files above only define things, this one runs them.

// ------------------------------------------------------------ init
async function init() {
  settingsInit();
  const theme = ls.get('theme', null);
  if (theme) document.documentElement.dataset.theme = theme;
  $('#theme').onclick = () => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const cur = document.documentElement.dataset.theme || (dark ? 'dark' : 'light');
    setTheme(cur === 'dark' ? 'light' : 'dark');
  };

  state.projects = await api('/api/projects');
  const params = new URLSearchParams(location.search);
  state.project = params.get('p') || ls.get('project', null);
  if (!state.projects.some(p => p.path === state.project)) state.project = state.projects[0]?.path || null;
  const sel = $('#project');
  sel.innerHTML = state.projects.map(p => `<option value="${esc(p.path)}" title="${esc(p.path)}">${esc(p.name)}</option>`).join('');
  sel.value = state.project || '';
  sel.onchange = () => {
    state.project = sel.value; state.sel = null; closeTask(); ls.set('project', sel.value);
    history.replaceState(null, '', `?p=${encodeURIComponent(sel.value)}`); load();
  };
  if (!state.project) { $('#main').innerHTML = `<div class="empty">No project registered. Run <code>keepr init</code> in a project folder.</div>`; return; }
  ls.set('project', state.project);

  const hash = location.hash.slice(1);
  if (/^A\d+$/i.test(hash)) { state.tab = 'answers'; state.sel = hash.toUpperCase(); }
  if (/^T\d+$/i.test(hash)) { state.tab = 'tasks'; state.task = hash.toUpperCase(); }
  if (/^I\d+$/i.test(hash)) { state.tab = 'inbox'; state.isel = hash.toUpperCase(); state.iFilter = 'all'; }
  if (hash === 'day') state.tab = 'day';

  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { state.tab = b.dataset.tab; render(); } };
  $('#search').oninput = (e) => { state.q = e.target.value.trim().toLowerCase(); render(); };
  $('#drawer-bg').onclick = closeTask;
  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-ref]');
    if (r) { e.preventDefault(); goTo(r.dataset.ref); }
  });
  pomoInit();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('#settings-pop').hidden) settingsOpen(false); else if (!$('#pomo-pop').hidden) pomoOpen(false); else closeTask(); }
    if (e.key === '/' && !e.target.matches('input, textarea, select')) { e.preventDefault(); $('#search').focus(); }
  });

  await load();
  if (state.task) openTask(state.task);
  // Keep the "now" line of the day plan current.
  setInterval(() => { if (state.tab === 'day' && !$('.dslot.pick')) render(); }, 60000);

  const connect = () => {
    const es = new EventSource('/api/events');
    es.onopen = () => $('#live').classList.add('live');
    es.onmessage = (e) => { if (JSON.parse(e.data).project === state.project) load(); };
    es.onerror = () => { $('#live').classList.remove('live'); };
  };
  connect();
}
init().catch(e => { $('#main').innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; });
