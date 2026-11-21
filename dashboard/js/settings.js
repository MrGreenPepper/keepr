// Settings dialog.

// ------------------------------------------------------------ settings
// Per-browser dashboard preferences (localStorage); opened by clicking "keepr".
const SETTINGS_DEFAULT = { pomoBig: true, pomoIdleSec: 15, pomoPlant: true, pomoBlur: false, pomoBlurLevel: 3, pomoVines: 100, pomoBranch: 100, pomoDepth: true, pomoBreakout: false, pomoVinesSpread: 30, pomoBranchSpread: 30, pomoEvenSpread: 30, pomoEven: 0, pomoVinesMode: 'fixed', pomoBranchMode: 'fixed', pomoEvenMode: 'fixed', density: 2, timerFont: 'script', idleSeconds: 'ring', pomoSurprise: false };
const settings = () => {
  const S = { ...SETTINGS_DEFAULT, ...ls.get('settings', {}) };
  const stored = ls.get('settings', {});
  if (stored.pomoVarySpread) for (const k of ['pomoVinesSpread', 'pomoBranchSpread', 'pomoEvenSpread']) if (stored[k] === undefined) S[k] = stored.pomoVarySpread;
  if (S.pomoVary) for (const k of ['pomoVinesMode', 'pomoBranchMode', 'pomoEvenMode']) if (!ls.get('settings', {})[k]) S[k] = 'vary'; // older "vary per phase" switch
  return S;
};
// Only values the user actually changed are stored, so later changes to a default still reach them.
function setSetting(k, v) { ls.set('settings', { ...ls.get('settings', {}), [k]: v }); settingsApply(); }
// Blur strength as named levels. The eye judges blur roughly logarithmically, so the radius
// grows geometrically (each step ~1.6×) to make every step feel about equally big. Radii are
// for a ~800 px tall window and scale with the window, so a level looks alike on every screen.
const BLUR_LEVELS = ['very light', 'light', 'medium', 'strong', 'very strong'];
const blurPx = (level) => 2 * Math.pow(1.6, level - 1) * Math.min(innerWidth, innerHeight) / 800;
// Settings that map straight onto the page (blur of the idle view).
// Timer fonts: the big digits in the timer window and the idle view.
const TIMER_FONTS = {
  script: ['Script', '"Sacramento", cursive', 1.35],
  rounded: ['Rounded', 'ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", Quicksand, Cantarell, "Fira Sans", system-ui, sans-serif', 1],
  system: ['System', 'system-ui, -apple-system, "Segoe UI", sans-serif', 1],
  mono: ['Monospace', 'ui-monospace, SFMono-Regular, monospace', 0.9],
};
const DENSITY = [['compact', 1], ['comfortable', 1.25], ['roomy', 1.5], ['spacious', 1.8]];
function settingsApply() {
  const S = settings(), veil = $('#pomo-veil');
  document.documentElement.style.setProperty('--sp', DENSITY[S.density - 1][1]);
  const tf = TIMER_FONTS[S.timerFont] || TIMER_FONTS.script;
  document.documentElement.style.setProperty('--timer-font', tf[1]);
  document.documentElement.style.setProperty('--timer-scale', tf[2]);
  veil.classList.toggle('blur', S.pomoBlur);
  veil.style.setProperty('--veil-blur', `${blurPx(S.pomoBlurLevel).toFixed(1)}px`);
}

function settingsOpen(open = $('#settings-pop').hidden) {
  const pop = $('#settings-pop');
  if (open && !$('#pomo-pop').hidden) pomoOpen(false);
  pop.hidden = !open; $('#brand').setAttribute('aria-expanded', String(open));
  if (open) settingsPaint();
  popSync();
}
// Dim the page behind an open popover and anchor the popover (with a small pointer) to its trigger.
function popSync() {
  const pairs = [[$('#settings-pop'), $('#brand'), 'left'], [$('#pomo-pop'), $('#pomo-btn'), 'right']];
  const open = pairs.find(([pop]) => !pop.hidden);
  $('#pop-scrim').classList.toggle('on', !!open);
  const caret = $('#pop-caret');
  caret.hidden = !open;
  if (!open) return;
  const [pop, btn, side] = open, r = btn.getBoundingClientRect(), top = r.bottom + 10;
  pop.style.top = `${top}px`;
  pop.style.maxHeight = `calc(100vh - ${top + 16}px)`;
  if (side === 'left') { pop.style.left = `${Math.max(16, r.left - 10)}px`; pop.style.right = 'auto'; }
  else { pop.style.right = `${Math.max(16, innerWidth - r.right - 10)}px`; pop.style.left = 'auto'; }
  caret.style.left = `${r.left + r.width / 2 - 6}px`;
  caret.style.top = `${top - 6}px`;
}
function settingsPaint() {
  const S = settings(), pop = $('#settings-pop');
  const grp = (on) => `set-grp ${on ? '' : 'off'}`;
  const evenLabel = (v) => v === 0 ? 'scattered' : v === 100 ? 'even' : `${v} %`;
  // A vines slider with its mode switch (fixed / vary / random) underneath.
  const vineRow = (id, label, min, max, step, val, mode, fmt, spread) => `
          <div class="set-vrow">
            <label class="set-row ${mode === 'random' ? 'dim' : ''}"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" id="set-pomo-${id}" value="${val}"><span class="val" id="set-pomo-${id}-val">${mode === 'random' ? 'random' : fmt(val)}</span></label>
            <div class="seg set-mode" data-mode-for="${id}">${['fixed', 'vary', 'random'].map(m => `<button data-mode="${m}" class="${mode === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
            ${mode === 'vary' ? `<label class="set-row set-spread"><span>± range</span><input type="range" min="10" max="80" step="5" id="set-pomo-${id}-spread" value="${spread}"><span class="val" id="set-pomo-${id}-spread-val">± ${spread} %</span></label>` : ''}
          </div>`;
  // Two panes: categories on the left, the chosen category's options on the right.
  const CATS = {
    appearance: { label: 'Appearance', desc: 'Colour scheme and how dense the dashboard looks.', html: `
      <div class="set-grp">
        <div class="set-row"><span>Theme</span><div class="seg set-seg" id="set-theme">${[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(([k, l]) =>
          `<button data-theme="${k}" class="${(ls.get('theme', null) || 'system') === k ? 'on' : ''}">${l}</button>`).join('')}</div><span></span></div>
      </div>
      <div class="set-grp">
        <div class="set-row"><span>Timer font</span><div class="seg set-seg" id="set-timer-font">${Object.entries(TIMER_FONTS).map(([k, [l, ff]]) =>
          `<button data-font="${k}" class="${S.timerFont === k ? 'on' : ''}" style="font-family:${ff.replace(/"/g, '&quot;')}">${l}</button>`).join('')}</div><span></span></div>
      </div>
      <div class="set-grp">
        <label class="set-row"><span>Spacing</span><input type="range" min="1" max="${DENSITY.length}" step="1" id="set-density" value="${S.density}"><span class="val" id="set-density-val">${DENSITY[S.density - 1][0]}</span></label>
      </div>` },
    pomodoro: { label: 'Pomodoro timer', desc: 'The view the running timer switches to when you leave the page alone, and the vines around it.', html: `
      <h3 class="set-sub">Idle timer<small>What the running timer shows when you leave the page alone.</small></h3>
      <div class="set-grp">
        <label class="opt"><input type="checkbox" id="set-pomo-big" ${S.pomoBig ? 'checked' : ''}>
          <span>Big timer when idle<small>While the pomodoro runs and the page is idle, show the timer large in the centre.</small></span></label>
        <div class="set-body ${S.pomoBig ? '' : 'off'}">
          <label class="set-row"><span>Show after</span><span class="set-num"><input class="input" type="number" min="3" max="600" id="set-pomo-idle" value="${S.pomoIdleSec}"><small>seconds without activity</small></span></label>
          <div class="set-row"><span>Time shown</span><div class="seg set-seg" id="set-idle-secs">${[['ring', 'Minutes + ring'], ['digits', 'Minutes:seconds']].map(([k, l]) =>
            `<button data-secs="${k}" class="${S.idleSeconds === k ? 'on' : ''}">${l}</button>`).join('')}</div><span></span></div>
        </div>
      </div>
      <div class="${grp(S.pomoBig)}">
        <label class="opt"><input type="checkbox" id="set-pomo-blur" ${S.pomoBlur ? 'checked' : ''}>
          <span>Blur the page behind<small>Softly blurs the dashboard behind the big timer.</small></span></label>
        <div class="set-body ${S.pomoBlur ? '' : 'off'}">
          <label class="set-row"><span>Strength</span><input type="range" min="1" max="${BLUR_LEVELS.length}" step="1" id="set-pomo-blur-lvl" value="${S.pomoBlurLevel}"><span class="val" id="set-pomo-blur-val">${BLUR_LEVELS[S.pomoBlurLevel - 1]}</span></label>
        </div>
      </div>
      <h3 class="set-sub">Vines<small>The plant that grows around the big timer during a focus phase.</small></h3>
      <div class="${grp(S.pomoBig)}">
        <label class="opt"><input type="checkbox" id="set-pomo-plant" ${S.pomoPlant ? 'checked' : ''}>
          <span>Growing vines<small>Vines grow in from the screen edges as the focus phase runs out.</small></span></label>
        <div class="set-body ${S.pomoPlant ? '' : 'off'}">
          ${vineRow('vines', 'Amount', 20, 200, 10, S.pomoVines, S.pomoVinesMode, (v) => `${v} %`, S.pomoVinesSpread)}
          ${vineRow('branch', 'Branching', 0, 200, 10, S.pomoBranch, S.pomoBranchMode, (v) => `${v} %`, S.pomoBranchSpread)}
          ${vineRow('even', 'Evenness', 0, 100, 10, S.pomoEven, S.pomoEvenMode, evenLabel, S.pomoEvenSpread)}
          <p class="set-note">Fixed: exactly the value. Vary: each focus phase picks a value within the ± range around it. Random: each phase picks any value.</p>
          <label class="opt"><input type="checkbox" id="set-pomo-depth" ${S.pomoDepth ? 'checked' : ''}><span>Depth<small>Vines cast a soft shadow, leaves pop out a little.</small></span></label>
          <label class="opt"><input type="checkbox" id="set-pomo-cracks" ${S.pomoBreakout ? 'checked' : ''}><span>Cracks<small>Vines break out of the screen through small cracks.</small></span></label>
          <label class="opt"><input type="checkbox" id="set-pomo-surprise" ${S.pomoSurprise ? 'checked' : ''}><span>Surprise mode<small>Every 10th idle view shows a surprise instead, in turn: a kitten that ends up playing with a blossom, or the vines drawn in ASCII.</small></span></label>
          <div class="set-row ${S.pomoSurprise ? '' : 'off'}"><span>Preview</span><div class="seg set-seg" id="set-surprise-next">${[['kitten', 'Kitten'], ['ascii', 'ASCII']].map(([k, l]) =>
            `<button data-surprise="${k}" class="${ls.get('surpriseNext', null) === k ? 'on' : ''}">${l}</button>`).join('')}</div><span class="val">${ls.get('surpriseNext', null) ? 'on next idle view' : `in ${10 - ls.get('surpriseCount', 0) % 10} views`}</span></div>
        </div>
        ${S.pomoBig ? '' : '<p class="set-note">Turn on “Big timer when idle” above to see the vines.</p>'}
      </div>` },
  };
  let cat = ls.get('settingsCat', 'appearance');
  if (cat === 'idle' || cat === 'vines') cat = 'pomodoro'; // older category names
  if (!CATS[cat]) cat = 'appearance';
  // Re-rendering replaces the content; keep the scroll position when the category stays the same.
  const prevMain = pop.querySelector('.set-main'), keepScroll = prevMain && pop.dataset.cat === cat ? prevMain.scrollTop : 0;
  pop.dataset.cat = cat;
  pop.innerHTML = `
    <nav class="set-nav">
      <h3>Settings</h3>
      ${Object.entries(CATS).map(([k, c]) => `<button data-cat="${k}" class="${k === cat ? 'on' : ''}">${c.label}</button>`).join('')}
    </nav>
    <div class="set-main">
      <div class="set-head"><h2>${CATS[cat].label}</h2><p>${CATS[cat].desc}</p></div>
      ${CATS[cat].html}
    </div>`;
  pop.querySelector('.set-main').scrollTop = keepScroll;
  pop.querySelector('.set-nav').onclick = (e) => { const b = e.target.closest('[data-cat]'); if (b) { ls.set('settingsCat', b.dataset.cat); settingsPaint(); } };
  const on = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
  on('#set-idle-secs', 'onclick', (e) => { const b = e.target.closest('[data-secs]'); if (b) { setSetting('idleSeconds', b.dataset.secs); settingsPaint(); pomoPaint(); } });
  on('#set-timer-font', 'onclick', (e) => { const b = e.target.closest('[data-font]'); if (b) { setSetting('timerFont', b.dataset.font); settingsPaint(); } });
  on('#set-theme', 'onclick', (e) => { const b = e.target.closest('[data-theme]'); if (b) { setTheme(b.dataset.theme); settingsPaint(); } });
  on('#set-density', 'oninput', (e) => { setSetting('density', Number(e.target.value)); $('#set-density-val').textContent = DENSITY[e.target.value - 1][0]; });
  on('#set-pomo-big', 'onchange', (e) => { setSetting('pomoBig', e.target.checked); if (!e.target.checked) pomoBig(false); settingsPaint(); });
  on('#set-pomo-plant', 'onchange', (e) => { setSetting('pomoPlant', e.target.checked); plantUpdate(); settingsPaint(); });
  const MODE_KEY = { vines: 'pomoVinesMode', branch: 'pomoBranchMode', even: 'pomoEvenMode' };
  const VAL_KEY = { vines: ['pomoVines', (v) => `${v} %`], branch: ['pomoBranch', (v) => `${v} %`], even: ['pomoEven', evenLabel] };
  for (const [id, [key, fmt]] of Object.entries(VAL_KEY))
    on(`#set-pomo-${id}`, 'oninput', (e) => { const v = Number(e.target.value); setSetting(key, v); if (settings()[MODE_KEY[id]] !== 'random') $(`#set-pomo-${id}-val`).textContent = fmt(v); plantUpdate(); });
  const SPREAD_KEY = { vines: 'pomoVinesSpread', branch: 'pomoBranchSpread', even: 'pomoEvenSpread' };
  for (const [id, key] of Object.entries(SPREAD_KEY))
    on(`#set-pomo-${id}-spread`, 'oninput', (e) => { setSetting(key, Number(e.target.value)); $(`#set-pomo-${id}-spread-val`).textContent = `± ${e.target.value} %`; plantUpdate(); });
  pop.querySelectorAll('[data-mode-for]').forEach(seg => seg.onclick = (e) => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    setSetting(MODE_KEY[seg.dataset.modeFor], b.dataset.mode); plantUpdate(); settingsPaint();
  });
  on('#set-pomo-depth', 'onchange', (e) => { setSetting('pomoDepth', e.target.checked); plantUpdate(); });
  on('#set-pomo-cracks', 'onchange', (e) => { setSetting('pomoBreakout', e.target.checked); plantUpdate(); });
  on('#set-pomo-surprise', 'onchange', (e) => { setSetting('pomoSurprise', e.target.checked); settingsPaint(); });
  on('#set-surprise-next', 'onclick', (e) => { const b = e.target.closest('[data-surprise]'); if (!b) return; const k = b.dataset.surprise; ls.set('surpriseNext', ls.get('surpriseNext', null) === k ? null : k); settingsPaint(); });
  on('#set-pomo-blur', 'onchange', (e) => { setSetting('pomoBlur', e.target.checked); settingsPaint(); });
  on('#set-pomo-blur-lvl', 'oninput', (e) => { setSetting('pomoBlurLevel', Number(e.target.value)); $('#set-pomo-blur-val').textContent = BLUR_LEVELS[e.target.value - 1]; });
  on('#set-pomo-idle', 'onchange', (e) => { setSetting('pomoIdleSec', Math.min(600, Math.max(3, Math.round(Number(e.target.value) || 15)))); settingsPaint(); });
}
function settingsInit() {
  settingsApply();
  addEventListener('resize', popSync);
  addEventListener('resize', settingsApply);
  $('#brand').onclick = (e) => { e.stopPropagation(); settingsOpen(); };
  document.addEventListener('click', (e) => {
    if (!$('#settings-pop').hidden && !clickedIn(e, '#settings-pop, #brand')) settingsOpen(false);
  });
  window.addEventListener('storage', (e) => { if (e.key !== 'keepr.settings') return; settingsApply(); if (!$('#settings-pop').hidden) settingsPaint(); });
}

// Theme: 'light', 'dark' or 'system' (follow the OS). Used by the header button and the settings.
function setTheme(t) {
  if (t === 'system') { delete document.documentElement.dataset.theme; try { localStorage.removeItem('keepr.theme'); } catch {} }
  else { document.documentElement.dataset.theme = t; ls.set('theme', t); }
  if (!$('#settings-pop').hidden) settingsPaint();
}

