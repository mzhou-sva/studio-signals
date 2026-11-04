const { StudioBoard, ZONES, LINK_COLOR } = StudioSignals;

const video = document.getElementById('webcam');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');
const banner = document.getElementById('banner');
const peopleList = document.getElementById('people');
const openList = document.getElementById('openList');
const logList = document.getElementById('log');
const sim = document.getElementById('sim');
const startScreen = document.getElementById('start');
const startMessage = document.getElementById('startMessage');

const board = new StudioBoard();
const scanner = new QRScanner();
const LOG_LIMIT = 8;
const BANNER_MS = 6000;
const FLASH_MS = 900;
const DEMO_SIZE = [1600, 900];
let bannerTimer = null;
let running = false;
let cameraOn = false;
let stream = null;
// Last zone change per person, for the ring that grows around the object.
const flashes = new Map();

function setOverlaySize(width, height) {
  overlay.width = width;
  overlay.height = height;
  board.aspect = width / height;
}
setOverlaySize(...DEMO_SIZE);

// ---- status screen -------------------------------------------------------

function detailOf(p) {
  if (p.link) {
    if (p.link.stage === 'talk') return `Linked with ${p.link.with} · talking about a project`;
    return p.link.role === 'asker' ? `Invitation sent to ${p.link.with} · waiting for them to come closer` : `${p.link.with} wants to talk · move closer to join`;
  }
  if (!p.zone) return 'Put your object on the table';
  const where = ZONES[p.zone].name;
  if (p.helpers.length) return `${where} · Talk to: ${p.helpers.join(', ')}`;
  return p.zone === 'feedback' ? `${where} · Nobody open yet` : where;
}

function renderPeople(snapshot) {
  peopleList.innerHTML = '';
  for (const p of snapshot.people) {
    const li = document.createElement('li');
    li.className = 'person';
    li.dataset.zone = p.zone || '';
    li.dataset.link = p.link ? p.link.stage : '';
    li.innerHTML = `<div class="avatar" style="background:${p.color}">${p.name}</div>`
      + `<div><div class="status">${p.status}</div><div class="detail">${detailOf(p)}</div></div>`;
    peopleList.appendChild(li);
  }
  openList.textContent = snapshot.open.length ? snapshot.open.join(', ') : 'Nobody yet';
}

function pulseBand(zone) {
  const band = document.querySelector(`.band[data-zone="${zone}"]`);
  if (!band) return;
  band.classList.remove('pulse');
  void band.offsetWidth;       // restart the animation
  band.classList.add('pulse');
}

function say(event) {
  const li = document.createElement('li');
  li.textContent = event.text;
  logList.prepend(li);
  while (logList.children.length > LOG_LIMIT) logList.lastChild.remove();
  banner.textContent = event.text;
  banner.className = `banner ${event.kind}`;
  banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { banner.hidden = true; }, BANNER_MS);
  if (event.kind === 'move' || event.kind === 'match') {
    if (event.to) {
      flashes.set(event.id, { at: performance.now(), color: ZONES[event.to].color });
      pulseBand(event.to);
    }
  }
}

function refresh(events) {
  events.forEach(say);
  renderPeople(board.snapshot());
  renderSim();
}

// ---- simulator (no camera) ----------------------------------------------

const SIM_CHOICES = [...StudioSignals.ZONE_ORDER.map((z) => [z, ZONES[z].name]), [null, 'Remove']];

function renderSim() {
  sim.innerHTML = '';
  const snapshot = board.snapshot();
  for (const p of snapshot.people) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<b>${p.name}</b>`;
    for (const [zone, label] of SIM_CHOICES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label.replace(' zone', '');
      button.title = label;
      button.setAttribute('aria-pressed', String(p.zone === zone));
      button.addEventListener('click', () => refresh(board.place(p.id, zone, performance.now())));
      row.appendChild(button);
    }
    const closer = document.createElement('button');
    closer.type = 'button';
    closer.textContent = 'Closer';
    closer.title = 'Move toward the person who is open (or, if you are open, toward the person who needs feedback)';
    closer.disabled = p.zone !== 'feedback' && p.zone !== 'open';
    closer.addEventListener('click', () => refresh(board.approach(p.id, performance.now())));
    row.appendChild(closer);
    sim.appendChild(row);
  }
  const apart = document.createElement('button');
  apart.type = 'button';
  apart.className = 'apart';
  apart.textContent = 'Move everyone apart';
  apart.addEventListener('click', () => refresh(board.spread(performance.now())));
  sim.appendChild(apart);
}

// ---- camera --------------------------------------------------------------

async function openCamera() {
  const steps = [[2560, 1440], [1920, 1080], [1280, 720], [640, 480]];
  for (const [width, height] of steps) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } },
        audio: false,
      });
    } catch (error) {
      if (['NotAllowedError', 'SecurityError', 'NotFoundError'].includes(error.name)) throw error;
    }
  }
  return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
}

function begin() {
  document.body.classList.add('live');
  startScreen.classList.add('hidden');
  refresh([]);
  if (!running) {
    running = true;
    requestAnimationFrame(tick);
  }
}

document.getElementById('startButton').addEventListener('click', async () => {
  startMessage.textContent = 'Opening camera…';
  try {
    stream = await openCamera();
    video.srcObject = stream;
    cameraOn = true;
  } catch (error) {
    console.error('Unable to access webcam:', error);
    startMessage.textContent = 'Could not open the camera. Allow camera access (needs http://localhost or HTTPS), or try the demo without a camera.';
    return;
  }
  document.body.classList.add('camera');
  begin();
});

document.getElementById('demoButton').addEventListener('click', begin);

video.addEventListener('loadedmetadata', () => {
  setOverlaySize(video.videoWidth, video.videoHeight);
  scanner.reset(video.videoWidth, video.videoHeight);
});

// ---- drawing -------------------------------------------------------------

const FONT = '"Helvetica Neue","PingFang SC",Arial,sans-serif';

function drawBox(location, color) {
  const { topLeftCorner: a, topRightCorner: b, bottomRightCorner: c, bottomLeftCorner: d } = location;
  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth = Math.max(3, overlay.width * 0.003);
  overlayCtx.beginPath();
  overlayCtx.moveTo(a.x, a.y);
  [b, c, d].forEach((p) => overlayCtx.lineTo(p.x, p.y));
  overlayCtx.closePath();
  overlayCtx.stroke();
}

function drawTag(x, y, text, color) {
  const fontSize = Math.max(18, overlay.width * 0.022);
  const pad = fontSize * 0.3;
  overlayCtx.font = `600 ${fontSize}px ${FONT}`;
  overlayCtx.textBaseline = 'top';
  const width = overlayCtx.measureText(text).width;
  overlayCtx.fillStyle = 'rgba(0,0,0,0.7)';
  overlayCtx.fillRect(x - pad, y - pad, width + pad * 2, fontSize + pad * 2);
  overlayCtx.fillStyle = color;
  overlayCtx.fillText(text, x, y);
}

function pixelOf(p) {
  return { x: (p.x / 100) * overlay.width, y: (p.y / 100) * overlay.height };
}

// A marker for an object when there is no camera picture to draw a box on.
function drawMarker(p) {
  const { x, y } = pixelOf(p);
  const radius = overlay.height * 0.045;
  const color = p.zone ? ZONES[p.zone].color : '#888';
  overlayCtx.fillStyle = p.color;
  overlayCtx.beginPath();
  overlayCtx.arc(x, y, radius, 0, Math.PI * 2);
  overlayCtx.fill();
  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth = Math.max(4, overlay.width * 0.004);
  overlayCtx.stroke();
  overlayCtx.fillStyle = '#111';
  overlayCtx.font = `700 ${radius * 1.1}px ${FONT}`;
  overlayCtx.textAlign = 'center';
  overlayCtx.textBaseline = 'middle';
  overlayCtx.fillText(p.name, x, y + 1);
  overlayCtx.textAlign = 'start';
  if (!p.link) drawTag(x - radius, y + radius * 1.4, p.status, color);
}

// Dashed line while one person has invited, solid thick line once both have come closer.
function drawLink(a, b, stage, now) {
  const pa = pixelOf(a);
  const pb = pixelOf(b);
  overlayCtx.save();
  overlayCtx.strokeStyle = LINK_COLOR;
  overlayCtx.lineCap = 'round';
  if (stage === 'talk') {
    overlayCtx.lineWidth = Math.max(6, overlay.width * 0.007);
    overlayCtx.shadowColor = '#3ecf8e';
    overlayCtx.shadowBlur = 18 + 8 * Math.sin(now / 250);
  } else {
    overlayCtx.lineWidth = Math.max(3, overlay.width * 0.003);
    overlayCtx.setLineDash([overlay.width * 0.012, overlay.width * 0.01]);
    overlayCtx.lineDashOffset = -now / 40;
    overlayCtx.globalAlpha = 0.85;
  }
  overlayCtx.beginPath();
  overlayCtx.moveTo(pa.x, pa.y);
  overlayCtx.lineTo(pb.x, pb.y);
  overlayCtx.stroke();
  overlayCtx.restore();
  const mx = (pa.x + pb.x) / 2;
  const my = (pa.y + pb.y) / 2;
  const text = stage === 'talk' ? 'Discussing' : 'Invitation';
  overlayCtx.font = `600 ${Math.max(18, overlay.width * 0.022)}px ${FONT}`;
  const half = overlayCtx.measureText(text).width / 2;
  drawTag(mx - half, my - overlay.height * 0.13, text, stage === 'talk' ? '#3ecf8e' : LINK_COLOR);
}

function drawFlashes(snapshot, now) {
  for (const [id, flash] of flashes) {
    const age = now - flash.at;
    const p = snapshot.people.find((q) => q.id === id);
    if (age > FLASH_MS || !p || p.x === null) {
      if (age > FLASH_MS) flashes.delete(id);
      continue;
    }
    const t = age / FLASH_MS;
    const { x, y } = pixelOf(p);
    overlayCtx.strokeStyle = flash.color;
    overlayCtx.globalAlpha = 1 - t;
    overlayCtx.lineWidth = Math.max(4, overlay.width * 0.005);
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, overlay.height * (0.05 + 0.12 * t), 0, Math.PI * 2);
    overlayCtx.stroke();
    overlayCtx.globalAlpha = 1;
  }
}

let lastKey = '';

function tick(now) {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  const sightings = [];
  const boxes = [];
  if (cameraOn && video.readyState === video.HAVE_ENOUGH_DATA) {
    for (const code of scanner.scan(video)) {
      const person = StudioSignals.personForCode(code.data);
      if (!person) {
        drawBox(code.location, '#888');   // unused codes only get a grey box
        continue;
      }
      const c = qrCenterOf(code.location);
      sightings.push({ id: person.id, x: (c.x / overlay.width) * 100, y: (c.y / overlay.height) * 100 });
      boxes.push({ id: person.id, location: code.location });
    }
  }
  const events = board.observe(performance.now(), sightings);
  const snapshot = board.snapshot();

  for (const { id, location } of boxes) {
    const p = snapshot.people.find((q) => q.id === id);
    const color = p.zone ? ZONES[p.zone].color : p.color;
    drawBox(location, color);
    const x = Math.min(location.topLeftCorner.x, location.bottomLeftCorner.x);
    const y = Math.max(location.bottomLeftCorner.y, location.bottomRightCorner.y) + overlay.width * 0.007;
    drawTag(x, y, `${p.name} · ${p.zone ? p.status : 'Moving'}`, color);
  }
  if (!cameraOn) snapshot.people.filter((p) => p.x !== null && p.zone).forEach(drawMarker);

  const byId = new Map(snapshot.people.map((p) => [p.id, p]));
  for (const link of snapshot.links) {
    const a = byId.get(link.asker);
    const b = byId.get(link.helper);
    if (a.x !== null && b.x !== null) drawLink(a, b, link.stage, now);
  }
  drawFlashes(snapshot, now);

  const key = JSON.stringify(snapshot.people.map((p) => [p.zone, p.status]));
  if (events.length || key !== lastKey) {
    lastKey = key;
    refresh(events);
  }
  requestAnimationFrame(tick);
}

renderPeople(board.snapshot());
renderSim();
