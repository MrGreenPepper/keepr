// Surprise mode of the idle view.

// ------------------------------------------------------------ surprise mode
// Every 10th idle view of a focus phase shows a surprise instead of the plain vines, taking turns:
// a kitten that walks in, watches a bud open and ends up playing with the blossom, or the vines
// drawn as ASCII characters. The counter lives in localStorage; the settings can queue one for
// the next idle view to preview it.
const SURPRISES = ['kitten', 'ascii'];
let pomoSurprise = null;
function surprisePick() {
  const S = settings();
  if (!S.pomoSurprise || !S.pomoPlant || (pomoDone ? pomoDone.mode : P.s.mode) !== 'focus') return null;
  const forced = ls.get('surpriseNext', null);
  if (SURPRISES.includes(forced)) { ls.set('surpriseNext', null); return forced; }
  const n = ls.get('surpriseCount', 0) + 1;
  ls.set('surpriseCount', n);
  return n % 10 ? null : SURPRISES[(n / 10 - 1) % SURPRISES.length];
}
function surpriseShow() {
  const k = $('#pomo-kitten');
  $('#pomo-big').classList.toggle('ascii', pomoSurprise === 'ascii');
  k.hidden = pomoSurprise !== 'kitten';
  if (k.hidden) { k.innerHTML = ''; return; }
  const pl = $('#pomo-plant').style;
  k.style.setProperty('--k-bloom', pl.getPropertyValue('--bloom') || '#f3b3c4');
  k.style.setProperty('--k-bloom-c', pl.getPropertyValue('--bloom-c') || '#f2cf6b');
  // Re-inserted every time, so the little story starts from the beginning.
  const petals = [0, 72, 144, 216, 288].map(a => `<circle r="7" cx="${(8 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(8 * Math.sin(a * Math.PI / 180)).toFixed(1)}"/>`).join('');
  k.innerHTML = `<svg viewBox="0 0 200 150" aria-hidden="true">
    <g class="k-flower">
      <path class="k-stem" pathLength="1" d="M152 150C150 136 160 126 152 116C148 110 146 106 144 104"/>
      <path class="k-lf" d="M153 136c9-6 19-5 23 0c-8 5-16 5-23 0z"/><path class="k-lf" d="M156 124c8-7 17-7 21-2c-6 5-14 6-21 2z"/>
      <g class="k-bloom" transform="translate(143 102)"><g>${petals}<circle class="c" r="5"/></g></g>
    </g>
    <circle class="k-petal" r="5" cx="143" cy="102"/>
    <g class="k-cat"><g class="k-hop">
      <path class="k-tail" d="M44 124C14 126 10 96 24 86"/>
      <ellipse class="k-fur" cx="70" cy="114" rx="34" ry="24"/>
      <ellipse class="k-fur k-dk" cx="54" cy="128" rx="16" ry="10"/>
      <ellipse class="k-belly" cx="88" cy="118" rx="14" ry="16"/>
      <rect class="k-fur" x="88" y="112" width="11" height="28" rx="5.5"/>
      <g class="k-paw"><rect class="k-fur" x="100" y="110" width="11" height="30" rx="5.5"/></g>
      <g class="k-head">
        <path class="k-fur" d="M84 76L86 52L100 68Z"/><path class="k-fur" d="M112 66L124 50L124 76Z"/>
        <path class="k-ear" d="M88 70L89 59L96 67Z"/><path class="k-ear" d="M114 67L121 58L121 71Z"/>
        <circle class="k-fur" cx="104" cy="82" r="21"/>
        <path class="k-stripe" d="M98 62c1 5 1 8 0 11M106 61c0 5 0 8 1 11"/>
        <g class="k-eyes"><ellipse cx="98" cy="80" rx="3.2" ry="4.4"/><ellipse cx="113" cy="80" rx="3.2" ry="4.4"/></g>
        <path class="k-nose" d="M104 87l4 0l-2 3z"/>
        <path class="k-mouth" d="M106 90q-2 4-5 2M106 90q2 4 5 2"/>
        <path class="k-wh" d="M96 89l-15-2M96 92l-14 3M116 89l14-3M116 92l13 2"/>
      </g>
    </g></g></svg>`;
}

// ASCII vines: the same plant as the SVG one, drawn into a character grid on a canvas.
function asciiDraw(p) {
  const cv = $('#pomo-ascii'), dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const fs = 14, font = `${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const cw = ctx.measureText('M').width, ch = fs * 1.15;
  const baseL = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--plant-l')) || 30;
  const hsl = ([h, s, l]) => `hsl(${h.toFixed(0)}, ${Math.min(70, s).toFixed(0)}%, ${Math.max(5, Math.min(92, baseL + l)).toFixed(0)}%)`;
  const grid = new Map(); // one character per cell, later layers win
  const put = (x, y, c, col) => { const gx = Math.round(x / cw), gy = Math.round(y / ch); grid.set(gx + ',' + gy, [gx, gy, c, col]); };
  for (const s of plant.stems) {
    const f = Math.max(0, Math.min(1, (p - s.t0) / (s.t1 - s.t0))), n = Math.floor(f * (s.pts.length - 1));
    if (n < 1) continue;
    const col = hsl([s.col.h, s.col.s, s.col.l]);
    for (let i = 0; i <= n; i++) {
      const a = s.pts[Math.max(0, i - 1)], b = s.pts[Math.min(s.pts.length - 1, i + 1)];
      // Direction in cell units, so the glyph matches how steep the stem looks on screen.
      const dx = (b[0] - a[0]) / cw, dy = (b[1] - a[1]) / ch, ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
      const c = ang < 22 || ang > 158 ? '-' : ang > 68 && ang < 112 ? '|' : (dx * dy > 0 ? '\\' : '/');
      put(s.pts[i][0], s.pts[i][1], c, col);
    }
  }
  for (const l of plant.leaves) {
    if (!l.on) continue;
    if (l.bloom === undefined) {
      // A leaf sits a little off the stem, in the direction it points.
      const r = l.ang * Math.PI / 180;
      put(l.x + Math.cos(r) * cw, l.y + Math.sin(r) * ch * 0.8, (Math.round(l.x + l.y) % 3) ? '&' : '%', hsl(l.col));
    } else {
      for (const [ox, oy, c] of [[-1, 0, '*'], [1, 0, '*'], [0, -1, '*'], [0, 1, '*'], [0, 0, '@']])
        put(l.x + ox * cw, l.y + oy * ch, c, c === '@' ? (plant.bloomC || '#f2cf6b') : l.fill);
    }
  }
  for (const [gx, gy, c, col] of grid.values()) { ctx.fillStyle = col; ctx.fillText(c, gx * cw, gy * ch); }
}

// Seconds ring: the fraction of the current minute still left, updated every animation frame
// while the idle view is up, so it runs down continuously instead of in one-second steps.
let pomoRingRaf = 0;
function pomoRingTick(once = false) {
  const fg = $('#pb-ring-fg');
  if (!fg) { pomoRingRaf = 0; return; }
  const left = pomoDone ? 0 : pomoLeft();
  const frac = left <= 0 ? 0 : ((left - 1) % 60000 + 1) / 60000;
  fg.style.strokeDashoffset = (1 - frac).toFixed(4);
  if (once && pomoRingRaf) return;
  pomoRingRaf = pomoBigOn && P.s.running && !pomoDone ? requestAnimationFrame(() => pomoRingTick()) : 0;
}

// Transform that makes the centred big timer sit exactly on the header button.
function pomoBtnTransform() {
  const b = $('#pomo-btn').getBoundingClientRect(), big = $('#pomo-big');
  const w = big.offsetWidth, h = big.offsetHeight;
  const dx = b.left + b.width / 2 - innerWidth / 2, dy = b.top + b.height / 2 - innerHeight / 2;
  return `translate(${dx}px, ${dy}px) translate(-50%, -50%) scale(${Math.min(b.width / w, b.height / h)})`;
}
function pomoBig(on) {
  if (on === pomoBigOn) return;
  pomoBigOn = on;
  const big = $('#pomo-big'), veil = $('#pomo-veil');
  if (on) {
    pomoSurprise = surprisePick(); surpriseShow();
    big.hidden = false; pomoPaint();
    big.style.transition = 'none'; big.style.opacity = '0'; big.style.transform = pomoBtnTransform();
    big.offsetWidth; // commit start position before animating
    big.style.transition = ''; big.style.opacity = '1'; big.style.transform = 'translate(-50%, -50%)';
    veil.classList.add('on'); plantUpdate();
  } else {
    big.style.transform = pomoBtnTransform(); big.style.opacity = '0';
    veil.classList.remove('on');
    const done = () => { if (pomoBigOn) return; big.hidden = true; if (pomoSurprise) { pomoSurprise = null; surpriseShow(); $('#pomo-ascii').hidden = true; } };
    big.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 700);
  }
}
function pomoActivity() { pomoLastActive = Date.now(); pomoBig(false); if (pomoDone && !pomoDone.leaving) { pomoDone.leaving = true; setTimeout(() => { if (!pomoBigOn) pomoDone = null; }, 700); } }

function pomoInit() {
  pomoLoad();
  pomoHoverInit();
  ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, pomoActivity, { passive: true, capture: true }));
  // Reset the daily counter when a new day starts.
  if (ls.get('pomoDay', null) !== today()) { P.s.round = 0; pomoSave(); ls.set('pomoDay', today()); }
  $('#pomo-btn').onclick = (e) => { e.stopPropagation(); pomoOpen(); };
  document.addEventListener('click', (e) => {
    if (!$('#pomo-pop').hidden && !clickedIn(e, '#pomo-pop, #pomo-btn, #t-pomo')) pomoOpen(false);
  });
  window.addEventListener('storage', (e) => {
    if (e.key !== 'keepr.pomo') return;
    const prev = { mode: P.s.mode, running: P.s.running, endAt: P.s.endAt, task: P.s.task, round: P.s.round };
    pomoLoad();
    // Another tab finished the phase: freeze the idle view here too.
    if (pomoBigOn && prev.running && !P.s.running && P.s.mode !== prev.mode && Date.now() >= prev.endAt - 2000)
      pomoDone = { mode: prev.mode, task: prev.task, round: prev.round };
    pomoPaint(true); if (state.task) renderDrawer();
  });
  setInterval(() => {
    if (P.s.running && Date.now() >= P.s.endAt) pomoComplete();
    const S = settings();
    if (P.s.running) pomoDone = null; // next phase started
    pomoBig(S.pomoBig && ((pomoDone && !pomoDone.leaving) || (P.s.running && Date.now() - pomoLastActive >= S.pomoIdleSec * 1000)));
    pomoPaint();
  }, 1000);
  pomoPaint(true);
}

// Clicks on references (T5, A3, I2) anywhere jump to the item.
function goTo(ref) {
  const id = ref.toUpperCase();
  if (id[0] === 'T') return openTask(id);
  closeTask();
  if (id[0] === 'A') { state.tab = 'answers'; selectAnswer(id); }
  else { state.tab = 'inbox'; if (state.iFilter !== 'all' && state.data.inbox.find(i => i.id === id)?.status !== state.iFilter) state.iFilter = 'all'; selectInbox(id); }
}

