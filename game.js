'use strict';

// 2048: 화면·입력·흐름. 판 규칙은 logic.js (LOGIC) 에 있다.
(() => {
const L = LOGIC;
const { SIZE } = L;

// ---------- 모양 ----------
const W = 400, H = 540;
const CELL = 80, GAP = 10, PAD = 10;
const BW = SIZE * CELL + (SIZE - 1) * GAP + PAD * 2;        // 판 한 변
const BX = (W - BW) / 2, BY = 78;
const INK = '#2b1d52';
const FONT = '"Jua", "Apple SD Gothic Neo", sans-serif';
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

const SLIDE_T = 0.11, POP_T = 0.16;
const UNDOS = 3;
const SWIPE = 24;              // 이만큼(화면 픽셀) 밀면 한 수

const BTN = {
  undo: { x: 15, y: BY + BW + 22, w: 180, h: 46 },
  again: { x: W - 15 - 180, y: BY + BW + 22, w: 180, h: 46 },
};

// 타일 색: 작은 수는 따뜻한 색, 커질수록 붉고 보랏빛으로
const COLORS = {
  2: ['#fff6da', INK], 4: ['#ffe9a8', INK], 8: ['#ffb45a', '#fff'], 16: ['#ff8a5a', '#fff'],
  32: ['#ff6a7a', '#fff'], 64: ['#ff4d9a', '#fff'], 128: ['#c56cff', '#fff'], 256: ['#8a7cff', '#fff'],
  512: ['#4f8cff', '#fff'], 1024: ['#2fb6e0', '#fff'], 2048: ['#ffd23f', INK],
};
const colorOf = (v) => COLORS[v] || ['#3a2a78', '#ffd23f'];
const shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16), cl = (v) => Math.max(0, Math.min(255, v));
  return `rgb(${cl((n >> 16) + amt)},${cl(((n >> 8) & 255) + amt)},${cl((n & 255) + amt)})`;
};

// ---------- 캔버스 ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const hudH = 62;
  const scale = Math.min((innerWidth - 24) / W, (innerHeight - 28 - hudH) / H);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = Math.max(cssW, Math.min(innerWidth - 20, 340)) + 'px';
  $('wrap').style.width = cssW + 'px';
  $('wrap').style.margin = '0 auto';
}
addEventListener('resize', fit);

function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------- 저장·소리 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let muted = store.get('game2048Muted') === '1';
let audio = null;
function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const sfx = {
  slide: () => tone(300, 0.05, 'triangle', 0.07, 100),
  merge: (v) => tone(400 + Math.min(Math.log2(v), 11) * 55, 0.1, 'sine', 0.12, 240),
  nope: () => tone(160, 0.08, 'square', 0.04, -30),
  undo: () => tone(500, 0.1, 'triangle', 0.08, -200),
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'triangle', 0.1), i * 100)),
  end: () => [784, 659, 523, 392].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.1), i * 140)),
};

// ---------- 상태 ----------
let state = 'title';          // title | play | paused | won | over
let grid = L.newBoard();
let score = 0, best = Number(store.get('game2048Best')) || 0;
let undosLeft = UNDOS, history = [];
let moves = 0, wonShown = false;
let slide = null;             // { t, items:[{v, from, to}], hidden:id }  타일이 미끄러지는 중
const pops = new Map();       // 타일 id → 튀어나오는 시간 (합쳐졌거나 새로 생긴 타일)
let texts = [], particles = [], banner = null;
let clock = 0;

function snapshot() {
  return { vals: grid.map((row) => row.map((t) => (t ? t.v : 0))), score };
}
function restore(snap) {
  grid = snap.vals.map((row) => row.map((v) => (v ? L.tile(v) : null)));
  score = snap.score;
}

function startGame() {
  grid = L.newBoard();
  score = 0; undosLeft = UNDOS; history = []; moves = 0; wonShown = false;
  slide = null; pops.clear(); texts = []; particles = []; banner = null;
  for (const row of grid) for (const t of row) if (t) pops.set(t.id, 0.0001);
  state = 'play';
  hideOverlay();
  updateHud();
}

// ---------- 흐름 ----------
function finishSlide() {
  if (!slide) return;
  const s = slide;
  slide = null;
  if (s.spawned) pops.set(s.spawned, 0.0001);
  for (const id of s.mergedIds) pops.set(id, 0.0001);
  afterMove();
}

function tryMove(dir) {
  if (state !== 'play') return;
  finishSlide();                                    // 앞 수가 아직 미끄러지는 중이면 바로 끝낸다
  if (state !== 'play') return;
  if (!L.canMove(grid, dir)) { sfx.nope(); return; }
  history.push(snapshot());
  if (history.length > UNDOS + 1) history.shift();
  // 미끄러지기 전 모습을 기록해 둔다
  const before = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (grid[r][c]) before.push({ id: grid[r][c].id, v: grid[r][c].v, from: [r, c] });
  const res = L.move(grid, dir);
  const target = new Map(res.moves.map((m) => [m.id, m.to]));
  const items = before.map((b) => ({ v: b.v, from: b.from, to: target.get(b.id) || b.from }));
  const sp = L.spawn(grid);
  score += res.gained;
  moves++;
  if (score > best) { best = score; store.set('game2048Best', String(best)); }
  slide = { t: 0, items, spawned: sp ? sp.tile.id : null, mergedIds: res.merges.map((m) => m.tile.id), merges: res.merges };
  // 안 미끄러진 타일도 그대로 그려야 하므로 합쳐질 곳/생길 곳은 미끄러지는 동안 감춘다
  slide.hidden = new Set([...slide.mergedIds, ...(sp ? [sp.tile.id] : [])]);
  if (res.merges.length) {
    const top = Math.max(...res.merges.map((m) => m.tile.v));
    sfx.merge(top);
    for (const m of res.merges) {
      texts.push({ text: `+${m.tile.v}`, x: BX + PAD + m.to[1] * (CELL + GAP) + CELL / 2, y: BY + PAD + m.to[0] * (CELL + GAP) + 10, t: 0 });
      burst(BX + PAD + m.to[1] * (CELL + GAP) + CELL / 2, BY + PAD + m.to[0] * (CELL + GAP) + CELL / 2, colorOf(m.tile.v)[0]);
    }
    if (top >= 2048 && !wonShown) { wonShown = true; slide.won = true; }
  } else sfx.slide();
  updateHud();
}

function afterMove() {
  if (wonPending) { wonPending = false; return showWin(); }
  if (!L.hasMove(grid)) gameOver();
}
let wonPending = false;

function burst(x, y, col) {
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 110;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 50, life: 0.5, col });
  }
}

function undo() {
  if (state !== 'play' || undosLeft <= 0 || !history.length) return;
  finishSlide();
  restore(history.pop());
  undosLeft--;
  pops.clear();
  sfx.undo();
  updateHud();
}

function showWin() {
  state = 'won';
  sfx.win();
  showOverlay(`
    <h2 class="inked">2048 달성!</h2>
    <div class="big inked">${score.toLocaleString()}</div>
    <span class="tag">🎉 대단해요!</span>
    <button id="startBtn">계속하기</button>
    <button id="againBtn" class="sub">새 게임</button>`);
  $('againBtn').onclick = () => startGame();
}

function gameOver() {
  state = 'over';
  sfx.end();
  const top = L.maxTile(grid);
  const isBest = score >= best && score > 0;
  setTimeout(() => showOverlay(`
    <h2 class="inked">더 못 움직여요!</h2>
    <div class="big inked">${score.toLocaleString()}</div>
    <span class="tag">${isBest ? '🏆 최고 기록!' : `최고 기록 ${best.toLocaleString()}`}</span>
    <div class="card"><dl class="stats">
      <dt>가장 큰 숫자</dt><dd>${top}</dd>
      <dt>움직인 횟수</dt><dd>${moves}번</dd>
    </dl></div>
    <button id="startBtn">한 번 더</button>`), 700);
}

function update(dt) {
  clock += dt;
  for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt; }
  particles = particles.filter((p) => p.life > 0);
  for (const t of texts) { t.t += dt; t.y -= 34 * dt; }
  texts = texts.filter((t) => t.t < 0.8);
  for (const [id, t] of pops) { if (t + dt > POP_T) pops.delete(id); else pops.set(id, t + dt); }
  if (banner) { banner.t += dt; if (banner.t > 1.2) banner = null; }
  if (slide) {
    slide.t += dt;
    if (slide.t >= SLIDE_T) {
      if (slide.won) wonPending = true;
      finishSlide();
    }
  }
}

// ---------- 그리기 ----------
function label(text, x, y, size, fill = '#fff', align = 'center') {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.2); ctx.strokeStyle = INK; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
function panel(x, y, w, h, r, fill, lift = 4) {
  ctx.fillStyle = INK; roundRect(ctx, x, y + lift, w, h, r); ctx.fill();
  ctx.fillStyle = fill; roundRect(ctx, x, y, w, h, r); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = INK; roundRect(ctx, x, y, w, h, r); ctx.stroke();
}

const cellX = (c) => BX + PAD + c * (CELL + GAP);
const cellY = (r) => BY + PAD + r * (CELL + GAP);

// 타일 하나. (px, py) 는 칸의 왼쪽 위, scale 은 가운데 기준 배율
function drawTile(v, px, py, scale = 1) {
  const [bg, fg] = colorOf(v);
  ctx.save();
  ctx.translate(px + CELL / 2, py + CELL / 2);
  ctx.scale(scale, scale);
  const x = -CELL / 2, y = -CELL / 2, w = CELL, h = CELL - 5;
  ctx.fillStyle = INK; roundRect(ctx, x, y + 5, w, h, 16); ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, shade(bg, 28)); g.addColorStop(0.12, bg); g.addColorStop(1, shade(bg, -34));
  ctx.fillStyle = g; roundRect(ctx, x, y, w, h, 16); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = INK; roundRect(ctx, x, y, w, h, 16); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.5)'; roundRect(ctx, x + 9, y + 6, w - 32, 6, 3); ctx.fill();
  const digits = String(v).length;
  const size = digits <= 2 ? 38 : digits === 3 ? 32 : digits === 4 ? 26 : 21;
  if (fg === INK) {
    ctx.font = `${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = fg; ctx.fillText(String(v), 0, -1);
  } else label(String(v), 0, -1, size, fg);
  if (v === 2048) {
    ctx.font = `20px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
    ctx.fillText('⭐', w / 2 - 12, y + 14);
  }
  ctx.restore();
}

function drawButton(b, text, enabled) {
  panel(b.x, b.y, b.w, b.h, 23, enabled ? '#ffd23f' : '#d9d3ea', 5);
  ctx.globalAlpha = enabled ? 1 : 0.6;
  label(text, b.x + b.w / 2, b.y + b.h / 2 + 1, 20, enabled ? '#fff' : '#b5acd0');
  ctx.globalAlpha = 1;
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  // 제목 + 가장 큰 숫자
  label('2048', 15, 38, 46, '#ffd23f', 'left');
  panel(W - 15 - 130, 14, 130, 46, 16, '#ffffff', 4);
  ctx.font = `12px ${FONT}`; ctx.fillStyle = '#6b5c95'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('가장 큰 숫자', W - 15 - 65, 28);
  ctx.font = `24px ${FONT}`; ctx.fillStyle = INK; ctx.fillText(String(L.maxTile(grid) || 0), W - 15 - 65, 49);

  // 판: 어두운 판 위에 빈 칸 자리
  ctx.fillStyle = INK; roundRect(ctx, BX, BY + 6, BW, BW, 24); ctx.fill();
  ctx.fillStyle = '#8f7fd6'; roundRect(ctx, BX, BY, BW, BW, 24); ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = INK; roundRect(ctx, BX, BY, BW, BW, 24); ctx.stroke();
  ctx.fillStyle = 'rgba(43,29,82,.35)';
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) { roundRect(ctx, cellX(c), cellY(r), CELL, CELL - 5, 16); ctx.fill(); }

  if (slide) {
    const k = Math.min(1, slide.t / SLIDE_T), e = 1 - (1 - k) * (1 - k);
    for (const it of slide.items) {
      drawTile(it.v, cellX(it.from[1] + (it.to[1] - it.from[1]) * e), cellY(it.from[0] + (it.to[0] - it.from[0]) * e));
    }
    // 안 움직인 타일 중 합쳐지는 자리에 있는 것도 위 items 에 이미 들어 있다
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const t = grid[r][c];
      if (t && !slide.hidden.has(t.id) && !slide.items.some((it) => it.to[0] === r && it.to[1] === c)) drawTile(t.v, cellX(c), cellY(r));
    }
  } else {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const t = grid[r][c];
      if (!t) continue;
      let scale = 1;
      const pt = pops.get(t.id);
      if (pt !== undefined) {
        const k = pt / POP_T;
        scale = k < 0.5 ? 0.6 + k * 1.2 * 1.0 : 1.2 - (k - 0.5) * 0.4;     // 작게 시작 → 살짝 커졌다가 → 1
        scale = Math.min(scale, 1.2);
      }
      drawTile(t.v, cellX(c), cellY(r), scale);
    }
  }

  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 3);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(p.x, p.y + 1, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const t of texts) {
    ctx.globalAlpha = Math.min(1, (0.8 - t.t) * 3);
    label(t.text, t.x, t.y, 22, '#fff');
  }
  ctx.globalAlpha = 1;

  drawButton(BTN.undo, `↩ 되돌리기 ${undosLeft}`, undosLeft > 0 && history.length > 0 && state === 'play');
  drawButton(BTN.again, '🔄 새 게임', true);
}

function updateHud() {
  $('score').textContent = score.toLocaleString();
  $('best').textContent = best.toLocaleString();
}

// ---------- 루프 ----------
let last = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  if (state !== 'paused') update(dt);
  draw();
  requestAnimationFrame(frame);
}

// ---------- 오버레이 ----------
function showOverlay(html) {
  const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden');
  const b = $('startBtn'); if (b) b.onclick = onOverlayButton;
}
function hideOverlay() { $('overlay').classList.add('hidden'); }
function onOverlayButton() {
  if (state === 'paused') resume();
  else if (state === 'won') { state = 'play'; hideOverlay(); if (!L.hasMove(grid)) gameOver(); }   // 이어서 계속
  else startGame();
}
function pause() {
  if (state !== 'play') return;
  state = 'paused';
  showOverlay(`<h2 class="inked">일시정지</h2><button id="startBtn">계속하기</button>`);
}
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); }

// ---------- 입력 ----------
// 손가락(또는 마우스)으로 일정 거리 밀면 그 방향으로 한 수. 화면이 스크롤되지 않게 막아 둔다.
let drag = null;
function toLogical(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
}
const hit = (b, p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h + 6;
canvas.addEventListener('pointerdown', (e) => {
  const p = toLogical(e);
  if (state === 'play' || state === 'won') {
    if (hit(BTN.undo, p)) { undo(); return; }
    if (hit(BTN.again, p)) { startGame(); return; }
  }
  if (state !== 'play') return;
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId, done: false };
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.done || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return;
  drag.done = true;
  tryMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

const KEYS = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3, W: 0, D: 1, S: 2, A: 3 };
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { state === 'paused' ? resume() : pause(); return; }
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  if (!$('overlay').classList.contains('hidden')) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOverlayButton(); }
    return;
  }
  if (e.key === 'z' || e.key === 'Z') { undo(); return; }
  if (e.key in KEYS) { e.preventDefault(); tryMove(KEYS[e.key]); }
});
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('game2048Muted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('startBtn').onclick = onOverlayButton;
$('muteBtn').textContent = muted ? '🔇' : '🔊';

for (const row of grid) for (const t of row) if (t) pops.set(t.id, 0.0001);
updateHud();
fit();
requestAnimationFrame(frame);

// 테스트용
window.__g = { get grid() { return grid; }, get state() { return state; }, get score() { return score; }, get slide() { return slide; },
  get undosLeft() { return undosLeft; }, tryMove, undo, update, draw, startGame, setGrid(rows) { grid = rows.map((r) => r.map((v) => (v ? L.tile(v) : null))); }, W, H, BTN };
})();
