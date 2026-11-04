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
assert.strictEqual(s.people[0].status, 'Focusing');
assert.deepStrictEqual(s.open, [], 'focus is not on the open list');
const bEvents = board.place('b', 'feedback', 10);
assert.ok(texts(bEvents)[0].includes('Nobody'));

// 2. C moves into open: the prompt from the brief.
const cEvents = board.place('c', 'open', 20);
assert.strictEqual(cEvents[0].kind, 'match');
assert.strictEqual(cEvents[0].text, 'B wants to discuss a project idea. C, you can talk to B now.');
s = board.snapshot();
assert.deepStrictEqual(s.open, ['C']);
assert.deepStrictEqual(s.people[1].helpers, ['C']);

// 3. C goes back to focus: the open list updates, B is told.
const back = board.place('c', 'focus', 30);
assert.ok(back[0].text.includes('back in the Focus zone'));
assert.ok(back.some((e) => e.id === 'b' && e.text.includes('nobody')));
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
assert.strictEqual(cam.snapshot().people[0].status, 'Not on table');


// 5. Come closer, then apart (simulator path, no settle time).
const near = new StudioBoard();
near.place('a', 'focus', 0);
near.place('b', 'feedback', 0);
near.place('c', 'open', 0);
assert.strictEqual(near.snapshot().links.length, 0, 'zone centres are far apart');

let ev = near.approach('b', 1);                       // B moves toward C
assert.strictEqual(ev[0].kind, 'invite');
assert.strictEqual(ev[0].text, 'B is moving toward C: invitation to discuss. C, move closer to join.');
s = near.snapshot();
assert.strictEqual(s.people[1].status, 'Inviting C');
assert.strictEqual(s.people[2].status, 'Invited by B');

assert.deepStrictEqual(near.updateLinks(2), [], 'B alone closing in is still only an invitation');
assert.strictEqual(near.snapshot().links[0].stage, 'invite');

ev = near.approach('c', 3);                            // C moves closer too
assert.strictEqual(ev[0].kind, 'talk');
assert.strictEqual(ev[0].text, 'B and C are discussing.');
s = near.snapshot();
assert.strictEqual(s.people[1].status, 'Discussing');
assert.strictEqual(s.people[2].status, 'Discussing');
assert.strictEqual(s.people[0].status, 'Focusing', 'A is not part of the link');

ev = near.spread(4);                                   // objects separate
assert.strictEqual(ev[0].kind, 'apart');
s = near.snapshot();
assert.strictEqual(s.links.length, 0);
assert.strictEqual(s.people[1].status, 'Needs feedback');
assert.strictEqual(s.people[2].status, 'Open to talk');

// An invitation is cancelled when the asker backs off, and when the helper leaves the Open zone.
near.approach('b', 5);
assert.strictEqual(near.snapshot().links.length, 1);
ev = near.spread(6);
assert.strictEqual(ev[0].kind, 'cancel');
near.approach('b', 7);
near.place('c', 'focus', 8);
assert.strictEqual(near.snapshot().links.length, 0);

// Camera path: positions come from the picture, aspect 16:9 (x in % of width, y in % of height).
const live = new StudioBoard();
let n = 10000;
const frame = (b, c) => [{ id: 'b', x: b[0], y: b[1] }, { id: 'c', x: c[0], y: c[1] }];
live.observe(n, frame([85, 50], [50, 50]));
n += SETTLE_MS;
live.observe(n, frame([85, 50], [50, 50]));
assert.deepStrictEqual(live.snapshot().links, []);
n += 50;
assert.strictEqual(live.observe(n, frame([72, 50], [50, 50]))[0].kind, 'invite');   // 22 x 1.78 = 39 away
n += 50;
assert.deepStrictEqual(live.observe(n, frame([68, 50], [50, 50])), [], 'asker alone is not enough');
n += 50;
assert.strictEqual(live.observe(n, frame([68, 50], [60, 50]))[0].kind, 'talk');    // helper moved closer too, 14 away
n += 50;
assert.deepStrictEqual(live.observe(n, frame([71, 50], [60, 50])), [], 'a little jitter keeps the link (hysteresis)');
n += 50;
assert.strictEqual(live.observe(n, frame([88, 50], [50, 50]))[0].kind, 'apart');

console.log('studio-signals: all checks passed');
