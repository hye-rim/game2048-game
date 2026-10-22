'use strict';
// 2048 규칙 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

function rng(seed) {                                   // mulberry32 (시험용 고정 난수)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEFT = 3, RIGHT = 1, UP = 0, DOWN = 2;
const board = (rows) => rows.map((row) => row.map((v) => (v ? L.tile(v) : null)));
const values = (g) => g.map((row) => row.map((t) => (t ? t.v : 0)));

test('one row to the left: merges once per tile, from the moving side', () => {
  const cases = [
    [[2, 2, 2, 2], [4, 4, 0, 0], 8],
    [[2, 2, 4, 0], [4, 4, 0, 0], 4],                   // 새로 생긴 4 는 옆의 4 와 또 합치지 않는다
    [[4, 4, 8, 8], [8, 16, 0, 0], 24],
    [[2, 0, 0, 2], [4, 0, 0, 0], 4],
    [[2, 2, 2, 0], [4, 2, 0, 0], 4],
    [[0, 0, 0, 2], [2, 0, 0, 0], 0],
    [[2, 4, 8, 16], [2, 4, 8, 16], 0],
  ];
  for (const [row, want, gained] of cases) {
    const g = board([row, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const r = L.move(g, LEFT);
    assert.deepStrictEqual(values(g)[0], want, row.join(','));
    assert.strictEqual(r.gained, gained);
    assert.strictEqual(r.moved, row.join() !== want.join());
  }
});

test('all four directions behave like "left" on a turned board', () => {
  const rand = rng(7);
  const turn = (v) => v[0].map((_, c) => v.map((row) => row[c]).reverse());   // 시계 방향 90°
  const turnN = (v, n) => { for (let k = 0; k < n; k++) v = turn(v); return v; };
  // 방향 d 로 미는 것 = 판을 돌려 그 방향이 왼쪽이 되게 한 뒤 왼쪽으로 밀고 되돌리기
  const toLeft = { 3: 0, 0: 3, 1: 2, 2: 1 };
  for (let k = 0; k < 300; k++) {
    const vals = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => (rand() < 0.4 ? 0 : 2 ** (1 + Math.floor(rand() * 4)))));
    for (const d of [UP, RIGHT, DOWN, LEFT]) {
      const g = board(vals);
      L.move(g, d);
      const t = board(turnN(vals, toLeft[d]));
      L.move(t, LEFT);
      assert.deepStrictEqual(values(g), turnN(values(t), (4 - toLeft[d]) % 4));
    }
  }
});

test('canMove agrees with what move() actually does', () => {
  const rand = rng(11);
  for (let k = 0; k < 2000; k++) {
    const vals = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => (rand() < 0.25 ? 0 : 2 ** (1 + Math.floor(rand() * 3)))));
    for (const d of [0, 1, 2, 3]) {
      const g = board(vals);
      const can = L.canMove(g, d);
      assert.deepStrictEqual(values(g), vals, 'canMove must not change the board');
      assert.strictEqual(L.move(g, d).moved, can);
    }
  }
});

test('animation data: every surviving tile is accounted for, merges remove both old tiles', () => {
  const rand = rng(3);
  for (let k = 0; k < 300; k++) {
    const g = L.newBoard(rand);
    for (let n = 0; n < 30; n++) {
      const before = new Set(g.flat().filter(Boolean).map((t) => t.id));
      const r = L.move(g, Math.floor(rand() * 4));
      const after = new Set(g.flat().filter(Boolean).map((t) => t.id));
      for (const m of r.merges) {
        assert.strictEqual(g[m.to[0]][m.to[1]], m.tile);
        for (const id of m.absorbed) { assert.ok(before.has(id)); assert.ok(!after.has(id)); }
      }
      for (const m of r.moves) assert.ok(before.has(m.id));
      assert.strictEqual(r.gained, r.merges.reduce((s, m) => s + m.tile.v, 0));
      if (r.moved) L.spawn(g, rand);
    }
  }
});

test('spawn: only on empty cells, about 90% twos, nothing on a full board', () => {
  const rand = rng(5);
  let twos = 0, fours = 0;
  for (let k = 0; k < 2000; k++) {
    const g = board([[2, 0, 4, 0], [0, 8, 0, 0], [0, 0, 0, 16], [0, 0, 0, 0]]);
    const s = L.spawn(g, rand);
    assert.ok(![[0, 0], [0, 2], [1, 1], [2, 3]].some(([r, c]) => r === s.r && c === s.c));
    if (s.tile.v === 2) twos++; else if (s.tile.v === 4) fours++; else assert.fail('only 2 or 4');
  }
  assert.ok(twos / (twos + fours) > 0.85 && twos / (twos + fours) < 0.95);
  const full = board([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]);
  assert.strictEqual(L.spawn(full, rand), null);
  assert.strictEqual(L.hasMove(full), false);
  assert.strictEqual(L.maxTile(full), 4);
  const g = L.newBoard(rand);
  assert.strictEqual(g.flat().filter(Boolean).length, 2);
});

test('hasMove on a full board with one matching pair', () => {
  const g = board([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 8, 8]]);    // 맨 아래 오른쪽 8, 8 만 합칠 수 있다
  assert.strictEqual(L.hasMove(g), true);
  assert.strictEqual(L.canMove(g, UP), false);
  assert.strictEqual(L.canMove(g, DOWN), false);
  assert.strictEqual(L.canMove(g, LEFT), true);
  assert.strictEqual(L.canMove(g, RIGHT), true);
});
