// Pomodoro timer and the idle focus view with growing vines.

// ------------------------------------------------------------ pomodoro
// State lives in localStorage so it survives reloads and is shared between dashboard tabs.
const P = { s: null, ctx: null };
function pomoLoad() {
  const cfg = { focus: 25, short: 5, long: 15, every: 4, auto: false };
  const s = ls.get('pomo', {});
  P.s = { mode: 'focus', running: false, endAt: null, left: null, round: 0, task: null, ...s, cfg: { ...cfg, ...(s.cfg || {}) } };
}
const pomoSave = () => ls.set('pomo', P.s);
const pomoDur = (mode) => P.s.cfg[mode] * 60000;
const pomoLeft = () => P.s.running ? Math.max(0, P.s.endAt - Date.now()) : (P.s.left ?? pomoDur(P.s.mode));
const mmss = (ms) => { const t = Math.ceil(ms / 1000); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
// Simple line icons (round caps and joins, current text colour) for the pomodoro controls.
const ICON = {
  // counter-clockwise arrow: the circle runs from the top-left round to the left, the head points along it
  reset: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="stroke-width:2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  skip: '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5.2c0-.8.9-1.3 1.6-.8l6.3 4.8c.5.4.5 1.2 0 1.6l-6.3 4.8c-.7.5-1.6 0-1.6-.8z"/><path d="M15.5 5v10"/></svg>',
};
const POMO_MODES = { focus: 'Focus', short: 'Short break', long: 'Long break' };

function pomoStart(task) {
  if (task) {
    if (P.s.mode !== 'focus' || P.s.task?.id !== task.id || P.s.task?.project !== task.project) {
      P.s.running = false; P.s.left = null; P.s.mode = 'focus';
    }
    P.s.task = task;
  }
  if (!P.s.running) {
    P.s.endAt = Date.now() + pomoLeft(); P.s.running = true; P.s.left = null;
  }
  try { P.ctx ??= new AudioContext(); } catch {}
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  pomoSave(); pomoPaint(true);
}
function pomoPause() { P.s.left = pomoLeft(); P.s.running = false; P.s.endAt = null; pomoSave(); pomoPaint(true); }
function pomoReset() { P.s.running = false; P.s.endAt = null; P.s.left = null; pomoSave(); pomoPaint(true); }
function pomoMode(mode) { P.s.mode = mode; pomoReset(); }

function pomoComplete(skipped = false) {
  const fresh = ls.get('pomo', {});
  if (!skipped && (!fresh.running || fresh.endAt !== P.s.endAt)) { pomoLoad(); return; } // another tab handled it
  const finished = P.s.mode, wasRunning = P.s.running;
  // Auto mode: the next phase starts right away (after Skip only if the timer was running).
  const auto = P.s.cfg.auto && wasRunning;
  // Phase ran out while the idle view is up: freeze it as a still image until the user is back
  // (not in auto mode, there the view simply carries on with the next phase).
  pomoDone = !skipped && !auto && pomoBigOn ? { mode: finished, task: P.s.task, round: P.s.round } : null;
  if (finished === 'focus' && !skipped) {
    P.s.round++;
    if (P.s.task) opIn(P.s.task.project, 'task.pomodoro', { id: P.s.task.id, minutes: P.s.cfg.focus }).catch(() => {});
  }
  P.s.mode = finished === 'focus' ? (P.s.round && P.s.round % P.s.cfg.every === 0 ? 'long' : 'short') : 'focus';
  P.s.running = auto; P.s.endAt = auto ? Date.now() + pomoDur(P.s.mode) : null; P.s.left = null;
  pomoSave(); pomoPaint(true);
  const brk = `${P.s.mode === 'long' ? 'long ' : ''}break`;
  if (!skipped) pomoNotify(finished === 'focus'
    ? `Focus done${P.s.task ? ` (${P.s.task.id})` : ''} – ${auto ? `${brk} started` : `time for a ${brk}`}`
    : auto ? 'Break over – focus started' : 'Break over – back to focus', finished === 'focus' ? 'focus' : 'break');
}

function pomoNotify(msg, sound) {
  toast(msg);
  pomoSound(sound);
  try { if (Notification.permission === 'granted') new Notification('keepr 🍅', { body: msg }); } catch {}
}

// End-of-phase sounds, synthesised with Web Audio (no audio files). Each preset is a list of notes
// [start s, frequency Hz, length s, wave, level] plus the length of one pass, so it can be repeated.
const POMO_SOUNDS = {
  beep: { label: 'Beep', len: 0.75, notes: [[0, 880, 0.2], [0.25, 880, 0.2], [0.5, 880, 0.2]] },
  chime: { label: 'Chime', len: 1.3, notes: [[0, 1047, 1.1], [0.14, 1319, 1.0], [0.28, 1568, 1.0]] },
  bell: { label: 'Bell', len: 2.2, notes: [[0, 660, 2.2, 'sine', 1], [0, 1822, 1.4, 'sine', 0.35], [0, 3564, 0.8, 'sine', 0.15]] },
  soft: { label: 'Soft', len: 1.4, notes: [[0, 523, 0.7, 'triangle'], [0.45, 392, 0.9, 'triangle']], attack: 0.06 },
  digital: { label: 'Digital', len: 0.9, notes: [[0, 1000, 0.09, 'square', 0.4], [0.15, 1000, 0.09, 'square', 0.4], [0.3, 1000, 0.09, 'square', 0.4], [0.45, 1000, 0.09, 'square', 0.4]] },
};
// which: 'focus' (a focus phase ended) or 'break'; or a preset name to preview one.
function pomoSound(which, opts = {}) {
  const S = settings();
  const name = POMO_SOUNDS[which] ? which : which === 'break' ? S.pomoSoundBreak : S.pomoSoundFocus;
  const snd = POMO_SOUNDS[name]; if (!snd) return; // 'off'
  const vol = (opts.volume ?? S.pomoVolume) / 100, times = opts.repeat ?? S.pomoRepeat;
  if (vol <= 0) return;
  try {
    const ctx = P.ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.05, a = snd.attack ?? 0.005;
    for (let r = 0; r < times; r++) for (const [d, f, l, wave = 'sine', lvl = 1] of snd.notes) {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + r * (snd.len + 0.35) + d;
      o.type = wave; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3 * vol * vol * lvl, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + l);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + l + 0.05);
    }
  } catch {}
}

// Was the click inside one of these elements? Uses the path at click time, because a click often
// re-renders the popover and detaches its target before this check runs.
const clickedIn = (e, sel) => e.composedPath().some(n => n instanceof Element && n.matches(sel));
// The pomodoro popover closes shortly after the pointer leaves it (not while a field in it is in use).
let pomoLeaveTimer = null;
function pomoHoverInit() {
  const pop = $('#pomo-pop');
  pop.addEventListener('mouseenter', () => clearTimeout(pomoLeaveTimer));
  pop.addEventListener('mouseleave', (e) => {
    if (e.relatedTarget && e.relatedTarget.closest?.('#pomo-btn')) return; // back onto its button
    clearTimeout(pomoLeaveTimer);
    pomoLeaveTimer = setTimeout(() => {
      if (pop.hidden || pop.matches(':hover') || pop.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
      pomoOpen(false);
    }, 400);
  });
}
function pomoOpen(open = $('#pomo-pop').hidden) { if (open) settingsOpen(false); $('#pomo-pop').hidden = !open; pomoPaint(true); popSync(); }

function pomoPaint(full = false) {
  if (!P.s) return;
  const left = mmss(pomoLeft());
  const btn = $('#pomo-btn');
  btn.textContent = `${P.s.mode === 'focus' ? '🍅' : '☕'} ${left}`;
  btn.classList.toggle('running', P.s.running);
  btn.dataset.m = P.s.mode;
  document.title = P.s.running ? `${P.s.mode === 'focus' ? '🍅' : '☕'} ${left} · keepr` : 'keepr';
  const big = $('#pomo-big');
  if (!big.hidden) {
    const D = pomoDone, mode = D ? D.mode : P.s.mode, task = D ? D.task : P.s.task;
    big.dataset.m = mode;
    const done = D ? 100 : Math.min(100, 100 - pomoLeft() / pomoDur(mode) * 100);
    const ring = settings().idleSeconds !== 'digits';
    // Ring mode: only the minutes, inside a thin circle that drains smoothly over each minute
    // (driven by pomoRingTick), instead of digits that jump every second.
    const mins = D ? 0 : Math.ceil(pomoLeft() / 60000);
    const time = ring ? `<div class="pb-time pb-ringed"><svg class="pb-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="47"/><circle class="fg" id="pb-ring-fg" cx="50" cy="50" r="47" pathLength="1"/></svg><span class="pb-min">${mins}</span><small>min</small></div>`
      : `<div class="pb-time">${D ? '00:00' : left}</div>`;
    big.innerHTML = `<div class="pb-mode">${D ? (mode === 'focus' ? 'Focus done' : 'Break over') : esc(POMO_MODES[mode])}</div>
      ${time}
      <div class="pb-bar"><i style="width:${done.toFixed(1)}%"></i></div>
      <div class="pb-task">${task ? `${esc(task.id)} – ${esc(task.title || '')}` : ''}</div>`;
    pomoRingTick(true);
  }
  plantUpdate();
  const pop = $('#pomo-pop');
  if (pop.hidden) return;
  if (!full && $('#pomo-time')) { $('#pomo-time').textContent = left; return; }
  if (pop.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
  const tasks = state.data ? state.data.tasks.filter(t => t.status !== 'done') : [];
  const cur = P.s.task;
  const curHere = cur && cur.project === state.project;
  const every = P.s.cfg.every, inCycle = P.s.round % every;
  pop.innerHTML = `
    <div class="seg" id="pomo-modes">${Object.entries(POMO_MODES).map(([k, l]) => `<button data-m="${k}" class="${P.s.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="pp-clock">
      <div class="pomo-time" id="pomo-time">${left}</div>
      <div class="pomo-dots" title="Focus sessions in this cycle (long break after ${every})">${'●'.repeat(inCycle)}${'○'.repeat(every - inCycle)} · ${P.s.round} today${P.s.cfg.auto ? ' · auto' : ''}</div>
    </div>
    <div class="row">
      <button class="btn primary" id="pomo-go">${P.s.running ? '❚❚ Pause' : '▶ Start'}</button>
      <button class="btn" id="pomo-reset">${ICON.reset} Reset</button>
      <button class="btn" id="pomo-skip" title="Skip to the next phase">${ICON.skip} Skip</button>
    </div>
    <section class="pp-sec">
      <h4>Working on</h4>
      <select class="input" id="pomo-task" title="Finished focus sessions are counted on this task">
        <option value="">No task</option>
        ${cur && !curHere ? `<option value="__other" selected>${esc(cur.id)} – ${esc(cur.title || '')} (other project)</option>` : ''}
        ${tasks.map(t => `<option value="${t.id}" ${curHere && cur.id === t.id ? 'selected' : ''}>${t.id} – ${esc(t.title)}</option>`).join('')}
      </select>
    </section>
    <label class="pomo-auto" title="Off: the timer stops after each phase and waits for Start">
      <input type="checkbox" id="pomo-auto" ${P.s.cfg.auto ? 'checked' : ''}>
      <span>Auto mode<small>Switch to the next phase on its own and keep running: focus → break → focus …</small></span>
    </label>
    <section class="pp-sec">
      <h4>Durations</h4>
      <div class="pomo-cfg">${[['focus', 'Focus', 'min'], ['short', 'Short break', 'min'], ['long', 'Long break', 'min'], ['every', 'Long break every', 'focus sessions']].map(([k, l, u]) =>
        `<label><span>${l}</span><span class="pc-in"><input class="input" type="number" min="1" max="${k === 'every' ? 12 : 180}" data-cfg="${k}" value="${P.s.cfg[k]}"><small>${u}</small></span></label>`).join('')}</div>
    </section>`;
  $('#pomo-modes').onclick = (e) => { const b = e.target.closest('button'); if (b) pomoMode(b.dataset.m); };
  $('#pomo-go').onclick = () => P.s.running ? pomoPause() : pomoStart();
  $('#pomo-reset').onclick = pomoReset;
  $('#pomo-skip').onclick = () => pomoComplete(true);
  $('#pomo-auto').onchange = (e) => { P.s.cfg.auto = e.target.checked; pomoSave(); e.target.blur(); pomoPaint(true); };
  $('#pomo-task').onchange = (e) => {
    const v = e.target.value; if (v === '__other') return;
    const t = tasks.find(x => x.id === v);
    P.s.task = t ? { project: state.project, id: t.id, title: t.title } : null;
    pomoSave(); e.target.blur(); pomoPaint(true); if (state.task) renderDrawer();
  };
  pop.querySelectorAll('[data-cfg]').forEach(inp => inp.onchange = () => {
    const v = Math.max(1, Math.round(Number(inp.value) || 1));
    P.s.cfg[inp.dataset.cfg] = v;
    if (!P.s.running) P.s.left = null;
    pomoSave(); inp.blur(); pomoPaint(true);
  });
}

// Idle focus view: while the timer runs and nothing happens on the page for a while,
// it grows from the header button into the centre; any activity sends it back.
let pomoLastActive = Date.now(), pomoBigOn = false;
let pomoDone = null; // snapshot of a phase that just finished while the idle view was showing

// Plant: vines grow in from the screen edges while the focus phase runs; the closer the end,
// the more of the border they cover. Generated per phase (seeded), drawn as SVG, revealed by progress.
const plant = { key: null, stems: [], leaves: [] };
function plantRng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function plantBuild(seed) {
  const W = innerWidth, H = innerHeight, rnd = plantRng(seed), depth = Math.min(W, H) * 0.2;
  const svg = $('#pomo-plant'), NS = 'http://www.w3.org/2000/svg';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  // Layers: cracks in the screen below, the plant above (with a drop shadow for depth, see plantUpdate).
  svg.innerHTML = `<defs><filter id="vine-depth" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="3" dy="5" stdDeviation="3" flood-color="#000" flood-opacity=".38"/></filter></defs>
    <g id="plant-cracks"></g><g id="plant-g"></g>`;
  const cracksG = svg.querySelector('#plant-cracks'), plantG = svg.querySelector('#plant-g');
  plant.stems = []; plant.leaves = []; plant.cracks = [];
  // Number of vines and how much they branch, from the settings menu. With "vary per phase" on,
  // each phase picks its own values in a window around the setting (±spread), seeded per phase.
  // Amount, branching and evenness each have a mode (settings menu): "fixed" uses the slider value,
  // "vary" picks a value within ±spread around it, "random" picks anything in the slider's range.
  // All picks are seeded per phase, so a phase keeps its look.
  const SV = settings();
  const pick = (mode, val, lo, hi, additive, spread) => {
    const sp = spread / 100;
    const r = rnd() * 2 - 1; // drawn always, so other modes do not reshuffle the pattern
    const v = mode === 'random' ? lo + (r + 1) / 2 * (hi - lo) : mode === 'vary' ? (additive ? val + r * sp * (hi - lo) : val * (1 + r * sp)) : val;
    return Math.min(hi, Math.max(lo, v));
  };
  const amount = pick(SV.pomoVinesMode, SV.pomoVines / 100, 0.2, 2, false, SV.pomoVinesSpread);
  const branch = pick(SV.pomoBranchMode, SV.pomoBranch / 100, 0, 2, false, SV.pomoBranchSpread);
  // Evenness: 0 = start points scattered anywhere along the edges, 1 = evenly spaced (little jitter).
  const even = pick(SV.pomoEvenMode, SV.pomoEven / 100, 0, 1, true, SV.pomoEvenSpread);
  plant.amount = amount; plant.branch = branch; plant.even = even;
  // Greens relative to the theme's base lightness (--plant-l); one blossom colour per phase.
  const green = (h, s, l) => `hsl(${h.toFixed(0)} ${Math.min(70, s).toFixed(0)}% calc(var(--plant-l) + ${l.toFixed(1)}%))`;
  const BLOOMS = [['#f3b3c4', '#f2cf6b'], ['#f4a38c', '#f7e1a0'], ['#c9b6ee', '#f2d675'], ['#f6efe0', '#e8b64c'],
    ['#f7c59f', '#c97b4a'], ['#e3a6d6', '#f5e08a'], ['#a9cdf0', '#f6efe0'], ['#f28f8f', '#f6d98b']];
  const [bloom, bloomC] = BLOOMS[Math.floor(rnd() * BLOOMS.length)];
  svg.style.setProperty('--bloom', bloom); svg.style.setProperty('--bloom-c', bloomC); plant.bloomC = bloomC;
  const bloomHsl = (() => { // hex → [h, s%, l%]
    const [r, g, b] = [1, 3, 5].map(i => parseInt(bloom.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l * 100];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s * 100, l * 100];
  })();
  const edges = [ // origin, tangent, inward normal, length
    { o: [0, 0], t: [1, 0], n: [0, 1], len: W }, { o: [W, H], t: [-1, 0], n: [0, -1], len: W },
    { o: [0, H], t: [0, -1], n: [1, 0], len: H }, { o: [W, 0], t: [0, 1], n: [-1, 0], len: H },
  ];
  const leafPath = 'M0 0C4-5 12-6 18 0C12 6 4 5 0 0Z';
  // One stem: a random walk mostly along the edge, staying within maxDist from it.
  function grow(e, along, dist, theta, L, maxDist, t0, t1, width, level, col) {
    const pts = [], step = 6;
    let len = 0;
    while (len < L) {
      pts.push([e.o[0] + along * e.t[0] + dist * e.n[0], e.o[1] + along * e.t[1] + dist * e.n[1]]);
      theta += (rnd() - 0.5) * 0.45;
      if (dist > maxDist) theta -= 0.18; if (dist < 6) theta += 0.18;
      theta = Math.max(-1.2, Math.min(1.2, theta));
      along += step * Math.cos(theta); dist += step * Math.sin(theta); len += step;
      if (along < -20 || along > e.len + 20) break;
    }
    if (pts.length < 3) return;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(' ')).join('L'));
    path.setAttribute('class', 'stem'); path.style.strokeWidth = width; path.style.stroke = green(col.h, col.s, col.l);
    plantG.appendChild(path);
    const total = (pts.length - 1) * step;
    path.style.strokeDasharray = total; path.style.strokeDashoffset = total;
    plant.stems.push({ el: path, total, t0, t1, pts, col });
    const at = (i) => t0 + (t1 - t0) * (i * step / total); // progress at which point i is reached
    for (let i = 4; i < pts.length - 1; i += 4 + Math.floor(rnd() * 3)) {
      const [x, y] = pts[i], [x2, y2] = pts[i + 1];
      const ang = Math.atan2(y2 - y, x2 - x) * 180 / Math.PI + (i % 2 ? 50 : -50) + (rnd() - 0.5) * 30;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(0)}) scale(${((0.6 + rnd() * 0.6) * (1.15 - level * 0.15)).toFixed(2)})`);
      const leaf = document.createElementNS(NS, 'path');
      leaf.setAttribute('d', leafPath); leaf.setAttribute('class', 'leaf');
      leaf.style.fill = green(col.h - 6 + rnd() * 22, col.s + 10 + rnd() * 10, col.l + 10 + rnd() * 12);
      g.appendChild(leaf); plantG.appendChild(g);
      plant.leaves.push({ el: leaf, t: at(i) + 0.01, x, y, ang, col: [col.h + 5, col.s + 14, col.l + 15] }); // no extra rnd(): keeps the seeded pattern
      // Branches: each with its own growth time, branching again (up to 4 levels).
      if (level < 4 && plant.stems.length < Math.min(900, 420 * Math.max(1, amount, branch)) && rnd() < [0, 0.34, 0.25, 0.15][level] * branch) {
        const ti = at(i), dir = rnd() < 0.7 ? 1 : -1; // mostly towards the centre, sometimes back along the edge
        const bl = (140 + rnd() * 160) / level;
        grow(e, along0(e, x, y), dist0(e, x, y), dir * (0.5 + rnd() * 0.7), bl, depth * (1 + level * 0.25),
          ti, Math.min(1, ti + 0.06 + rnd() * 0.3), Math.max(0.7, width * 0.7), level + 1,
          { h: col.h + (rnd() - 0.5) * 12, s: col.s, l: col.l + (rnd() - 0.5) * 8 });
      }
    }
    // A blossom at the tip; blossoms open only near the end of the phase (staggered, see plantUpdate).
    if (level <= 2 && rnd() < 0.45) {
      const [x, y] = pts[pts.length - 1];
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      const b = document.createElementNS(NS, 'g'); b.setAttribute('class', 'bloom');
      // Each blossom: a slight variation of the phase colour (hue ±6°, saturation ±8, lightness ±5).
      const [bh, bs, bl] = bloomHsl, fill = `hsl(${(bh + (rnd() - 0.5) * 12).toFixed(0)} ${Math.max(0, Math.min(100, bs + (rnd() - 0.5) * 16)).toFixed(0)}% ${Math.max(0, Math.min(100, bl + (rnd() - 0.5) * 10)).toFixed(0)}%)`;
      b.innerHTML = [0, 72, 144, 216, 288].map(a => `<circle r="4.5" style="fill:${fill}" cx="${(5 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(5 * Math.sin(a * Math.PI / 180)).toFixed(1)}"/>`).join('') + '<circle class="c" r="3"/>';
      g.appendChild(b); plantG.appendChild(g);
      plant.leaves.push({ el: b, bloom: rnd(), x, y, fill });
    }
  }
  // A crack in the screen where a vine breaks through: a dark hole and jagged rays with a light bevel.
  function crack(x, y, nx, ny, t) {
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'crack');
    const base = Math.atan2(ny, nx), rays = 3 + Math.floor(rnd() * 3);
    let d = '';
    for (let k = 0; k < rays; k++) {
      let a = base + (rnd() - 0.5) * 2.6, px = x, py = y;
      const len = 26 + rnd() * 50, segs = 4 + Math.floor(rnd() * 3);
      d += `M${x.toFixed(1)} ${y.toFixed(1)}`;
      for (let j = 0; j < segs; j++) {
        a += (rnd() - 0.5) * 0.9; px += Math.cos(a) * len / segs; py += Math.sin(a) * len / segs;
        d += `L${px.toFixed(1)} ${py.toFixed(1)}`;
        if (j === 1 && rnd() < 0.6) { // small side fissure
          const b = a + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.5), bl = len * (0.2 + rnd() * 0.25);
          d += `M${px.toFixed(1)} ${py.toFixed(1)}L${(px + Math.cos(b) * bl).toFixed(1)} ${(py + Math.sin(b) * bl).toFixed(1)}M${px.toFixed(1)} ${py.toFixed(1)}`;
        }
      }
    }
    const r = 4 + rnd() * 4, hole = Array.from({ length: 7 }, (_, k) => {
      const a = k / 7 * Math.PI * 2, rr = r * (0.6 + rnd() * 0.6);
      return `${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`;
    }).join('L');
    g.innerHTML = `<path class="hl" pathLength="1" transform="translate(1.2 1.2)" d="${d}"/><path class="dk" pathLength="1" d="${d}"/><path class="hole" d="M${hole}Z"/>`;
    cracksG.appendChild(g);
    plant.cracks.push({ el: g, t });
  }
  const along0 = (e, x, y) => (x - e.o[0]) * e.t[0] + (y - e.o[1]) * e.t[1];
  const dist0 = (e, x, y) => (x - e.o[0]) * e.n[0] + (y - e.o[1]) * e.n[1];
  for (const e of edges) {
    // New vines keep sprouting over the whole phase, each growing at its own pace.
    const n = Math.max(1, Math.round(e.len / 160 * amount));
    for (let k = 0; k < n; k++) {
      // Varied origins: most from the very edge, some a little further in; own shade of green each.
      // Each vine has a fixed slot along the edge; it may stray from it by up to half the edge
      // (fully random, wrapped round) at 0 % and by a small jitter at 100 %. The stray shrinks
      // geometrically in between, so every step of the slider looks about equally more regular.
      const slot = e.len / n, minStray = slot * 0.15, stray = minStray * Math.pow((e.len / 2) / minStray, 1 - even);
      const start = ((((k + 0.5) * slot + (rnd() * 2 - 1) * stray) % e.len) + e.len) % e.len, d0 = rnd() < 0.35 ? rnd() * depth * 0.5 * (1 - even * 0.6) : 0;
      const t0 = Math.pow(rnd(), 1.3) * 0.85, t1 = Math.min(1, t0 + 0.12 + rnd() * 0.45);
      const col = { h: 85 + rnd() * 55, s: 25 + rnd() * 25, l: -6 + rnd() * 12 };
      crack(e.o[0] + start * e.t[0] + d0 * e.n[0], e.o[1] + start * e.t[1] + d0 * e.n[1], e.n[0], e.n[1], Math.max(0, t0 - 0.015));
      grow(e, start, d0, (rnd() < 0.5 ? -1 : 1) * (0.2 + rnd() * 0.6), 120 + rnd() * Math.min(520, e.len * 0.5), depth, t0, t1, 1.8 + rnd() * 1, 1, col);
    }
  }
}
function plantUpdate() {
  const svg = $('#pomo-plant');
  const D = pomoDone;
  if (!settings().pomoPlant || (D ? D.mode : P.s.mode) !== 'focus') { svg.toggleAttribute('hidden', true); $('#pomo-ascii').hidden = true; return; }
  if (!pomoBigOn) return; // keep it while the view fades out
  const ascii = pomoSurprise === 'ascii';
  svg.toggleAttribute('hidden', ascii); $('#pomo-ascii').hidden = !ascii;
  const key = `${today()}|${D ? D.round : P.s.round}|${innerWidth}x${innerHeight}|${settings().pomoVines}|${settings().pomoBranch}|${settings().pomoEven}|${settings().pomoVinesMode}${settings().pomoBranchMode}${settings().pomoEvenMode}|${settings().pomoVinesSpread},${settings().pomoBranchSpread},${settings().pomoEvenSpread}`;
  if (plant.key !== key) { plant.key = key; plantBuild([...key].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)); }
  const S = settings();
  svg.querySelector('#plant-g').toggleAttribute('filter', false);
  if (S.pomoDepth) svg.querySelector('#plant-g').setAttribute('filter', 'url(#vine-depth)');
  svg.querySelector('#plant-cracks').toggleAttribute('hidden', !S.pomoBreakout);
  svg.classList.toggle('depth', S.pomoDepth);
  const p = D ? 1 : 1 - pomoLeft() / pomoDur('focus');
  for (const c of plant.cracks) c.el.classList.toggle('on', p >= c.t);
  for (const s of plant.stems) {
    const f = Math.max(0, Math.min(1, (p - s.t0) / (s.t1 - s.t0)));
    s.el.style.strokeDashoffset = s.total * (1 - f);
  }
  // Blossoms open in the last 10 % of the phase; beyond 10 min that window grows more slowly
  // (25 min → ~1:55 instead of 2:30, 50 min → ~3:05 instead of 5:00). All open just before the end.
  const durS = pomoDur('focus') / 1000, leftS = pomoLeft() / 1000;
  const win = durS <= 600 ? durS * 0.1 : 60 * Math.pow(durS / 600, 0.7), last = Math.min(2, win * 0.1);
  for (const l of plant.leaves)
    l.el.classList.toggle('on', l.on = l.bloom === undefined ? p >= l.t : !!(D || leftS <= last + l.bloom * (win - last)));
  if (ascii) asciiDraw(p);
}

