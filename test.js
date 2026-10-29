// node test.js  -- walks the full story from the brief.
const assert = require('assert');
require('./signals.js');
const { StudioBoard, zoneAt, SETTLE_MS, LEAVE_MS } = globalThis.StudioSignals;

assert.strictEqual(zoneAt(10), 'focus');
assert.strictEqual(zoneAt(50), 'open');
assert.strictEqual(zoneAt(90), 'feedback');
assert.strictEqual(zoneAt(35, 'focus'), 'focus', 'hysteresis keeps the zone near the line');
assert.strictEqual(zoneAt(38, 'focus'), 'open');

const board = new StudioBoard();
const texts = (events) => events.map((e) => e.text);

// 1. A goes to focus, B to feedback.
board.place('a', 'focus', 0);
let s = board.snapshot();
assert.strictEqual(s.people[0].status, '专注中');
assert.deepStrictEqual(s.open, [], 'focus is not on the open list');
const bEvents = board.place('b', 'feedback', 10);
assert.ok(texts(bEvents)[0].includes('没有人'));

// 2. C moves into open: the prompt from the brief.
const cEvents = board.place('c', 'open', 20);
assert.strictEqual(cEvents[0].kind, 'match');
assert.strictEqual(cEvents[0].text, 'B 想讨论一个项目想法，C 现在可以和 B 聊一聊。');
s = board.snapshot();
assert.deepStrictEqual(s.open, ['C']);
assert.deepStrictEqual(s.people[1].helpers, ['C']);

// 3. C goes back to focus: the open list updates, B is told.
const back = board.place('c', 'focus', 30);
assert.ok(back[0].text.includes('回到专注区'));
assert.ok(back.some((e) => e.id === 'b' && e.text.includes('没有人')));
assert.deepStrictEqual(board.snapshot().open, []);

// 4. Camera path: a code must settle, and must be missing for LEAVE_MS to leave.
const cam = new StudioBoard();
let t = 1000;
assert.deepStrictEqual(cam.observe(t, [{ id: 'a', x: 15, y: 50 }]), []);
t += SETTLE_MS;
assert.strictEqual(cam.observe(t, [{ id: 'a', x: 15, y: 50 }])[0].to, 'focus');
t += 100;
assert.deepStrictEqual(cam.observe(t, [{ id: 'a', x: 50, y: 50 }]), [], 'a move in progress is not a move yet');
t += SETTLE_MS;
assert.strictEqual(cam.observe(t, [{ id: 'a', x: 50, y: 50 }])[0].to, 'open');
t += 200;
assert.deepStrictEqual(cam.observe(t, []), [], 'one missed frame is not leaving');
t += LEAVE_MS;
assert.strictEqual(cam.observe(t, [])[0].kind, 'leave');
assert.strictEqual(cam.snapshot().people[0].status, '不在桌上');

console.log('studio-signals: all checks passed');
