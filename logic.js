'use strict';

// 2048: 판 규칙만 모아 둔 파일 (그리기·입력 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// 판은 SIZE × SIZE, 칸은 { id, v } 타일 또는 null.
const SIZE = 4;
let nextId = 1;
const tile = (v) => ({ id: nextId++, v });

function emptyBoard() {
  return Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
}

// 빈 칸 하나에 2(90%) 또는 4(10%)를 놓는다. 놓은 칸을 돌려주고, 빈 칸이 없으면 null
function spawn(g, rng = Math.random) {
  const empty = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!g[r][c]) empty.push([r, c]);
  if (!empty.length) return null;
  const [r, c] = empty[Math.floor(rng() * empty.length)];
  g[r][c] = tile(rng() < 0.9 ? 2 : 4);
  return { r, c, tile: g[r][c] };
}

function newBoard(rng = Math.random) {
  const g = emptyBoard();
  spawn(g, rng); spawn(g, rng);
  return g;
}

// 방향 dir: 0 위, 1 오른쪽, 2 아래, 3 왼쪽.
// 줄 하나를 '가는 방향의 끝'으로 몰고 같은 숫자 둘을 합친다 (한 번 합쳐진 타일은 그 수에 다시 합치지 않는다).
// 줄은 [ {r,c} ... ] 를 가는 방향의 앞쪽부터 늘어놓은 것.
function lineCells(dir, i) {
  const cells = [];
  for (let k = 0; k < SIZE; k++) {
    if (dir === 3) cells.push([i, k]);
    else if (dir === 1) cells.push([i, SIZE - 1 - k]);
    else if (dir === 0) cells.push([k, i]);
    else cells.push([SIZE - 1 - k, i]);
  }
  return cells;
}

// 한 수를 적용한다. 판을 직접 고치고 결과를 돌려준다.
//   moved  : 움직인 게 있는가 (없으면 유효한 수가 아니다)
//   gained : 이번에 얻은 점수(합쳐진 타일 값의 합)
//   moves  : [{ id, from:[r,c], to:[r,c] }] 살아남은 타일의 이동 (그림 애니메이션용)
//   merges : [{ to:[r,c], tile, absorbed:[id,id] }] 합쳐져 새로 생긴 타일
function move(g, dir) {
  let moved = false, gained = 0;
  const moves = [], merges = [];
  for (let i = 0; i < SIZE; i++) {
    const cells = lineCells(dir, i);
    const items = cells.map(([r, c]) => (g[r][c] ? { t: g[r][c], from: [r, c] } : null)).filter(Boolean);
    const out = [];
    for (let k = 0; k < items.length; k++) {
      const a = items[k], b = items[k + 1];
      if (b && a.t.v === b.t.v) {
        const merged = tile(a.t.v * 2);
        out.push({ t: merged, absorbed: [a, b] });
        gained += merged.v;
        k++;
      } else out.push({ t: a.t, from: a.from });
    }
    cells.forEach(([r, c], k) => {
      const o = out[k];
      const old = g[r][c];
      g[r][c] = o ? o.t : null;
      if (!o) { if (old) moved = true; return; }
      if (o.absorbed) {
        moved = true;
        merges.push({ to: [r, c], tile: o.t, absorbed: o.absorbed.map((x) => x.t.id) });
        for (const x of o.absorbed) moves.push({ id: x.t.id, from: x.from, to: [r, c] });
      } else if (o.from[0] !== r || o.from[1] !== c) {
        moved = true;
        moves.push({ id: o.t.id, from: o.from, to: [r, c] });
      }
    });
  }
  return { moved, gained, moves, merges };
}

// 판을 건드리지 않고 이 방향으로 움직일 수 있는지
function canMove(g, dir) {
  for (let i = 0; i < SIZE; i++) {
    const vals = lineCells(dir, i).map(([r, c]) => (g[r][c] ? g[r][c].v : 0));
    let seenGap = false;
    for (let k = 0; k < SIZE; k++) {
      if (!vals[k]) seenGap = true;
      else if (seenGap) return true;                       // 빈 칸 뒤에 타일이 있으면 밀린다
      if (k + 1 < SIZE && vals[k] && vals[k] === vals[k + 1]) return true;
    }
  }
  return false;
}

const hasMove = (g) => [0, 1, 2, 3].some((d) => canMove(g, d));
const maxTile = (g) => Math.max(...g.flat().map((t) => (t ? t.v : 0)));

const LOGIC = { SIZE, tile, newBoard, spawn, move, canMove, hasMove, maxTile };
if (typeof module !== 'undefined') module.exports = LOGIC;
