const { StudioBoard, PEOPLE, ZONES, ZONE_ORDER } = StudioSignals;

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
let bannerTimer = null;
let ticking = false;
let stream = null;

// ---- status screen -------------------------------------------------------

function renderPeople(snapshot) {
  peopleList.innerHTML = '';
  for (const p of snapshot.people) {
    const li = document.createElement('li');
    li.className = 'person';
    li.dataset.zone = p.zone || '';
    const detail = p.zone
      ? `${ZONES[p.zone].name}${p.helpers.length ? ` · Talk to: ${p.helpers.join(', ')}` : p.zone === 'feedback' ? ' · Nobody open yet' : ''}`
      : 'Put your object on the table';
    li.innerHTML = `<div class="avatar" style="background:${p.color}">${p.name}</div>`
      + `<div><div class="status">${p.status}</div><div class="detail">${detail}</div></div>`;
    peopleList.appendChild(li);
  }
  openList.textContent = snapshot.open.length ? snapshot.open.join(', ') : 'Nobody yet';
}

function say(event) {
  const li = document.createElement('li');
  li.textContent = event.text;
  logList.prepend(li);
  while (logList.children.length > LOG_LIMIT) logList.lastChild.remove();
  banner.textContent = event.text;
  banner.className = `banner ${event.kind === 'match' ? 'match' : ''}`;
  banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { banner.hidden = true; }, BANNER_MS);
}

function refresh(events) {
  events.forEach(say);
  renderPeople(board.snapshot());
  renderSim();
}

// ---- simulator (no camera) ----------------------------------------------

const SIM_CHOICES = [...ZONE_ORDER.map((z) => [z, ZONES[z].name]), [null, 'Remove']];

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
    sim.appendChild(row);
  }
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
}

document.getElementById('startButton').addEventListener('click', async () => {
  startMessage.textContent = 'Opening camera…';
  try {
    stream = await openCamera();
    video.srcObject = stream;
  } catch (error) {
    console.error('Unable to access webcam:', error);
    startMessage.textContent = 'Could not open the camera. Allow camera access (needs http://localhost or HTTPS), or try the demo without a camera.';
    return;
  }
  begin();
});

document.getElementById('demoButton').addEventListener('click', begin);

video.addEventListener('loadedmetadata', () => {
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  scanner.reset(video.videoWidth, video.videoHeight);
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(tick);
  }
});

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

function drawTag(location, text, color) {
  const fontSize = Math.max(18, overlay.width * 0.022);
  const pad = fontSize * 0.3;
  const x = Math.min(location.topLeftCorner.x, location.bottomLeftCorner.x);
  const y = Math.max(location.bottomLeftCorner.y, location.bottomRightCorner.y) + pad;
  overlayCtx.font = `600 ${fontSize}px "Helvetica Neue","PingFang SC",Arial,sans-serif`;
  overlayCtx.textBaseline = 'top';
  const width = overlayCtx.measureText(text).width;
  overlayCtx.fillStyle = 'rgba(0,0,0,0.7)';
  overlayCtx.fillRect(x - pad, y - pad, width + pad * 2, fontSize + pad * 2);
  overlayCtx.fillStyle = color;
  overlayCtx.fillText(text, x, y);
}

let lastSnapshotKey = '';

function tick() {
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    const codes = scanner.scan(video);
    const sightings = [];
    for (const code of codes) {
      const person = StudioSignals.personForCode(code.data);
      if (!person) {
        drawBox(code.location, '#888');   // unused codes only get a grey box
        continue;
      }
      const c = qrCenterOf(code.location);
      sightings.push({ id: person.id, x: (c.x / overlay.width) * 100, y: (c.y / overlay.height) * 100 });
      const zone = board.snapshot().people.find((p) => p.id === person.id).zone;
      drawBox(code.location, person.color);
      drawTag(code.location, `${board.nameOf(person.id)} · ${zone ? ZONES[zone].status : 'Moving'}`, person.color);
    }
    const events = board.observe(performance.now(), sightings);
    const key = JSON.stringify(board.snapshot().people.map((p) => [p.zone]));
    if (events.length || key !== lastSnapshotKey) {
      lastSnapshotKey = key;
      refresh(events);
    }
  }
  requestAnimationFrame(tick);
}

// Keep the rows alive when someone only uses the simulator.
setInterval(() => {
  if (!ticking) {
    const events = board.observe(performance.now(), []);
    if (events.length) refresh(events);
  }
}, 250);

renderPeople(board.snapshot());
renderSim();
