// Studio Signals: who can be interrupted, and who wants to talk about a project.
//
// Each person is one QR code from the code sheet. The table is cut into three
// zones (left to right in the camera picture):
//
//   focus    Focus zone    "I want to work on my own."   -> Focusing, not on the open list
//   open     Open zone     "I'm happy to hear ideas."    -> on the open list
//   feedback Feedback zone "I want to talk my project."  -> Needs feedback, told who is open
//
// A code has to stay in a new zone for SETTLE_MS before the move counts, and a
// code that is not seen for LEAVE_MS counts as taken off the table. Pure logic,
// no DOM: the page (app.js) and the tests (test.js) both drive it.
(function (global) {
  const SETTLE_MS = 500;
  const LEAVE_MS = 1500;
  // A code has to cross a zone line by this many percentage points to switch.
  const ZONE_MARGIN = 3;

  const ZONES = {
    focus: { name: 'Focus zone', status: 'Focusing', color: '#7c8cff' },
    open: { name: 'Open zone', status: 'Open to talk', color: '#3ecf8e' },
    feedback: { name: 'Feedback zone', status: 'Needs feedback', color: '#ffb547' },
  };
  // Left to right in the camera picture.
  const ZONE_ORDER = ['focus', 'open', 'feedback'];
  const ABSENT_STATUS = 'Not on table';

  // Payloads on the printed code sheet (same sheet as the snack beat machine).
  // bottle, object-c and notebook stay unused.
  const PEOPLE = [
    { id: 'a', code: 'phone', name: 'A', color: '#4aa8ff' },
    { id: 'b', code: 'object-a', name: 'B', color: '#ff6fb5' },
    { id: 'c', code: 'object-b', name: 'C', color: '#c58b4e' },
  ];

  function personForCode(data) {
    const code = String(data).trim().toLowerCase();
    return PEOPLE.find((p) => p.code === code) || null;
  }

  // Which zone a horizontal position (0-100 % of the frame) falls in. With a
  // current zone, the code must pass the line by ZONE_MARGIN before it changes.
  function zoneAt(xPercent, current) {
    const width = 100 / ZONE_ORDER.length;
    const raw = Math.min(ZONE_ORDER.length - 1, Math.max(0, Math.floor(xPercent / width)));
    if (!current || ZONE_ORDER[raw] === current) return ZONE_ORDER[raw];
    const index = ZONE_ORDER.indexOf(current);
    const low = index * width - ZONE_MARGIN;
    const high = (index + 1) * width + ZONE_MARGIN;
    return xPercent >= low && xPercent < high ? current : ZONE_ORDER[raw];
  }

  function joinNames(names) {
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  }

  class StudioBoard {
    constructor(people = PEOPLE) {
      this.people = people.map((p) => ({ ...p }));
      this.state = new Map(this.people.map((p) => [p.id, {
        zone: null,          // committed zone, null = not on the table
        candidate: null,     // zone it is moving into
        candidateSince: 0,
        lastSeen: -Infinity,
        rawZone: null,       // zone right now, with hysteresis
        x: null,
        y: null,
        since: 0,
      }]));
    }

    person(id) {
      return this.people.find((p) => p.id === id);
    }

    nameOf(id) {
      return this.person(id).name;
    }

    rename(id, name) {
      const person = this.person(id);
      if (person && name) person.name = name;
    }

    // sightings: [{ id, x, y }] with x and y as % of the frame. Returns the
    // events caused by moves that settled during this call.
    observe(now, sightings) {
      const events = [];
      const seen = new Set();
      for (const { id, x, y } of sightings) {
        const s = this.state.get(id);
        if (!s || seen.has(id)) continue;
        seen.add(id);
        s.lastSeen = now;
        s.x = x;
        s.y = y;
        s.rawZone = zoneAt(x, s.rawZone || s.zone);
        if (s.rawZone === s.zone) {
          s.candidate = null;
        } else if (s.candidate !== s.rawZone) {
          s.candidate = s.rawZone;
          s.candidateSince = now;
        }
        if (s.candidate && now - s.candidateSince >= SETTLE_MS) {
          events.push(...this.commit(id, s.candidate, now));
        }
      }
      for (const [id, s] of this.state) {
        if (seen.has(id) || now - s.lastSeen < LEAVE_MS) continue;
        s.candidate = null;
        s.rawZone = null;
        if (s.zone !== null) events.push(...this.commit(id, null, now));
      }
      return events;
    }

    // Put someone straight into a zone (null = take them off the table). Used
    // by the simulator buttons, and it skips the settle time.
    place(id, zone, now) {
      const s = this.state.get(id);
      s.candidate = null;
      s.rawZone = zone;
      s.x = null;
      s.y = null;
      s.lastSeen = zone ? Infinity : -Infinity;
      return s.zone === zone ? [] : this.commit(id, zone, now);
    }

    // Hand a simulated person back to the camera.
    release(id) {
      const s = this.state.get(id);
      if (s.lastSeen === Infinity) s.lastSeen = -Infinity;
    }

    inZone(zone) {
      return this.people.filter((p) => this.state.get(p.id).zone === zone).map((p) => p.id);
    }

    commit(id, zone, now) {
      const s = this.state.get(id);
      const from = s.zone;
      s.zone = zone;
      s.candidate = null;
      s.since = now;
      const name = this.nameOf(id);
      const others = (z) => this.inZone(z).filter((other) => other !== id);
      const event = (text, kind = 'move', extra = {}) => ({ kind, id, from, to: zone, text, at: now, ...extra });

      if (zone === 'focus') {
        const text = from === 'open'
          ? `${name} is back in the Focus zone. The open list is updated.`
          : `${name} is in the Focus zone: focusing, not on the open list.`;
        const events = [event(text)];
        if (from === 'open') {
          for (const asker of this.inZone('feedback')) {
            const open = this.inZone('open').map((o) => this.nameOf(o));
            events.push({
              kind: 'update', id: asker, from: 'feedback', to: 'feedback', at: now,
              text: open.length
                ? `${this.nameOf(asker)}, you can still talk to ${joinNames(open)}.`
                : `${this.nameOf(asker)}, nobody is in the Open zone right now. Check back soon.`,
            });
          }
        }
        return events;
      }

      if (zone === 'open') {
        const askers = others('feedback');
        if (!askers.length) return [event(`${name} is in the Open zone and can join a conversation.`)];
        // The prompt from the brief: tell the person who just opened up.
        return askers.map((asker) => event(
          `${this.nameOf(asker)} wants to discuss a project idea. ${name}, you can talk to ${this.nameOf(asker)} now.`,
          'match', { with: asker },
        ));
      }

      if (zone === 'feedback') {
        const open = others('open');
        if (!open.length) return [event(`${name} wants to talk about a project. Nobody is in the Open zone yet.`)];
        return [event(`${name} wants to talk about a project: ${joinNames(open.map((o) => this.nameOf(o)))} ${open.length > 1 ? 'are' : 'is'} open to talk.`, 'match', { with: open[0] })];
      }

      // zone === null: taken off the table.
      return [event(`${name}'s object left the table.`, 'leave')];
    }

    // Everything the status screen needs.
    snapshot() {
      const openIds = this.inZone('open');
      const people = this.people.map((p) => {
        const s = this.state.get(p.id);
        const helpers = s.zone === 'feedback' ? openIds.filter((o) => o !== p.id) : [];
        return {
          ...p,
          zone: s.zone,
          pending: s.candidate,
          status: s.zone ? ZONES[s.zone].status : ABSENT_STATUS,
          helpers: helpers.map((o) => this.nameOf(o)),
          x: s.x,
          y: s.y,
          since: s.since,
        };
      });
      return {
        people,
        open: openIds.map((o) => this.nameOf(o)),
        focus: this.inZone('focus').map((o) => this.nameOf(o)),
        feedback: this.inZone('feedback').map((o) => this.nameOf(o)),
      };
    }
  }

  global.StudioSignals = { StudioBoard, PEOPLE, ZONES, ZONE_ORDER, ABSENT_STATUS, SETTLE_MS, LEAVE_MS, zoneAt, personForCode };
})(typeof window !== 'undefined' ? window : globalThis);
