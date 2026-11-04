// Studio Signals: who can be interrupted, and who wants to talk about a project.
//
// Each person is one QR code from the code sheet. The table is cut into three
// zones (left to right in the camera picture):
//
//   focus    Focus zone    "I want to work on my own."   -> Focusing, not on the open list
//   open     Open zone     "I'm happy to hear ideas."    -> on the open list
//   feedback Feedback zone "I want to talk my project."  -> Needs feedback, told who is open
//
// 3 positions (the zones) and 3 movements, each with visual feedback:
//
//   cross zones  the move settles -> status, colour and open list update
//   come closer  a person who needs feedback moves toward someone who is open
//                -> invitation; once the other person moves closer too, the two
//                are linked and show "Discussing"
//   move apart   the two objects separate -> the link goes, both go back to
//                their own status
//
// A code has to stay in a new zone for SETTLE_MS before the move counts, and a
// code that is not seen for LEAVE_MS counts as taken off the table. Distances
// are in "% of the frame height" so they mean the same in x and y. Pure logic,
// no DOM: the page (app.js) and the tests (test.js) both drive it.
(function (global) {
  const SETTLE_MS = 500;
  const LEAVE_MS = 1500;
  // A code has to cross a zone line by this many percentage points to switch.
  const ZONE_MARGIN = 3;

  // Distances between two objects, in % of the frame height. Entering and
  // leaving use different values so a shaky code does not flicker.
  const INVITE_ENTER = 40;
  const INVITE_EXIT = 50;
  const TALK_ENTER = 22;
  const TALK_EXIT = 30;
  // The open person must have moved this far since the invitation to count as "moved closer too".
  const HELPER_MOVE_MIN = 3;
  // Simulated objects stop this far apart, so their markers never sit on top of each other.
  const SIM_MIN_GAP = 14;
  const DEFAULT_ASPECT = 16 / 9;

  const ZONES = {
    focus: { name: 'Focus zone', status: 'Focusing', color: '#7c8cff' },
    open: { name: 'Open zone', status: 'Open to talk', color: '#3ecf8e' },
    feedback: { name: 'Feedback zone', status: 'Needs feedback', color: '#ffb547' },
  };
  // Left to right in the camera picture.
  const ZONE_ORDER = ['focus', 'open', 'feedback'];
  const ABSENT_STATUS = 'Not on table';
  const TALK_STATUS = 'Discussing';
  const LINK_COLOR = '#ffffff';

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

  // Centre of a zone in % of the frame width (where simulated objects sit).
  function zoneCenter(zone) {
    return (ZONE_ORDER.indexOf(zone) + 0.5) * (100 / ZONE_ORDER.length);
  }

  function joinNames(names) {
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  }

  class StudioBoard {
    constructor(people = PEOPLE) {
      this.people = people.map((p) => ({ ...p }));
      this.aspect = DEFAULT_ASPECT;     // frame width / height
      this.links = new Map();           // asker id -> { helper, stage, since, from }
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
      events.push(...this.updateLinks(now));
      return events;
    }

    // Put someone straight into a zone (null = take them off the table). Used
    // by the simulator buttons, and it skips the settle time.
    place(id, zone, now) {
      const s = this.state.get(id);
      s.candidate = null;
      s.rawZone = zone;
      s.x = zone ? zoneCenter(zone) : null;
      s.y = zone ? 50 : null;
      s.lastSeen = zone ? Infinity : -Infinity;
      const events = s.zone === zone ? [] : this.commit(id, zone, now);
      return [...events, ...this.updateLinks(now)];
    }

    // Simulator: move someone half way toward the person they are paired with.
    // A person who needs feedback heads for someone open, and the other way round.
    approach(id, now) {
      const s = this.state.get(id);
      const wanted = s.zone === 'feedback' ? 'open' : s.zone === 'open' ? 'feedback' : null;
      const partner = wanted && this.people.find((p) => {
        const o = this.state.get(p.id);
        return p.id !== id && o.zone === wanted && o.x !== null;
      });
      if (!partner || s.x === null) return [];
      const o = this.state.get(partner.id);
      const gap = this.distance(id, partner.id);
      if (gap > SIM_MIN_GAP) {
        const k = 1 - Math.max(gap / 2, SIM_MIN_GAP) / gap;     // go half way, but stop at SIM_MIN_GAP
        s.x += (o.x - s.x) * k;
        s.y += (o.y - s.y) * k;
      }
      return this.updateLinks(now);
    }

    // Simulator: put everyone back at the centre of their zone.
    spread(now) {
      for (const p of this.people) {
        const s = this.state.get(p.id);
        if (s.zone && s.lastSeen === Infinity) { s.x = zoneCenter(s.zone); s.y = 50; }
      }
      return this.updateLinks(now);
    }

    inZone(zone) {
      return this.people.filter((p) => this.state.get(p.id).zone === zone).map((p) => p.id);
    }

    distance(a, b) {
      const sa = this.state.get(a);
      const sb = this.state.get(b);
      if (sa.x === null || sb.x === null) return Infinity;
      return Math.hypot((sa.x - sb.x) * this.aspect, sa.y - sb.y);
    }

    busy(id) {
      for (const [asker, link] of this.links) if (asker === id || link.helper === id) return true;
      return false;
    }

    // Invitation -> discussing -> apart, from where the objects are right now.
    updateLinks(now) {
      const events = [];
      const linkEvent = (kind, asker, helper, text) => ({ kind, id: asker, with: helper, from: null, to: null, text, at: now });

      for (const [asker, link] of [...this.links]) {
        const a = this.state.get(asker);
        const h = this.state.get(link.helper);
        const d = this.distance(asker, link.helper);
        const both = a.zone && h.zone && a.zone !== 'focus' && h.zone !== 'focus';
        const name = `${this.nameOf(asker)} and ${this.nameOf(link.helper)}`;
        if (link.stage === 'talk') {
          if (!both || d > TALK_EXIT) {
            this.links.delete(asker);
            events.push(linkEvent('apart', asker, link.helper, `${name} moved apart. Back to their own status.`));
          }
        } else if (!(a.zone === 'feedback' && h.zone === 'open') || d > INVITE_EXIT) {
          this.links.delete(asker);
          events.push(linkEvent('cancel', asker, link.helper, `${this.nameOf(asker)} moved away. The invitation to ${this.nameOf(link.helper)} is cancelled.`));
        } else if (d < TALK_ENTER && Math.hypot((h.x - link.from.x) * this.aspect, h.y - link.from.y) >= HELPER_MOVE_MIN) {
          link.stage = 'talk';
          link.since = now;
          events.push(linkEvent('talk', asker, link.helper, `${name} are discussing.`));
        }
      }

      for (const asker of this.inZone('feedback')) {
        if (this.busy(asker)) continue;
        let best = null;
        for (const helper of this.inZone('open')) {
          if (this.busy(helper)) continue;
          const d = this.distance(asker, helper);
          if (d < INVITE_ENTER && (!best || d < best.d)) best = { helper, d };
        }
        if (!best) continue;
        const h = this.state.get(best.helper);
        this.links.set(asker, { helper: best.helper, stage: 'invite', since: now, from: { x: h.x, y: h.y } });
        events.push(linkEvent('invite', asker, best.helper,
          `${this.nameOf(asker)} is moving toward ${this.nameOf(best.helper)}: invitation to discuss. ${this.nameOf(best.helper)}, move closer to join.`));
      }
      return events;
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
      const partnerOf = new Map();
      for (const [asker, link] of this.links) {
        partnerOf.set(asker, { id: link.helper, stage: link.stage, role: 'asker' });
        partnerOf.set(link.helper, { id: asker, stage: link.stage, role: 'helper' });
      }
      const people = this.people.map((p) => {
        const s = this.state.get(p.id);
        const helpers = s.zone === 'feedback' ? openIds.filter((o) => o !== p.id) : [];
        const link = partnerOf.get(p.id);
        let status = s.zone ? ZONES[s.zone].status : ABSENT_STATUS;
        if (link && link.stage === 'talk') status = TALK_STATUS;
        else if (link) status = link.role === 'asker' ? `Inviting ${this.nameOf(link.id)}` : `Invited by ${this.nameOf(link.id)}`;
        return {
          ...p,
          zone: s.zone,
          pending: s.candidate,
          status,
          link: link ? { with: this.nameOf(link.id), withId: link.id, stage: link.stage, role: link.role } : null,
          helpers: helpers.map((o) => this.nameOf(o)),
          x: s.x,
          y: s.y,
          since: s.since,
        };
      });
      return {
        people,
        links: [...this.links].map(([asker, l]) => ({ asker, helper: l.helper, stage: l.stage })),
        open: openIds.map((o) => this.nameOf(o)),
        focus: this.inZone('focus').map((o) => this.nameOf(o)),
        feedback: this.inZone('feedback').map((o) => this.nameOf(o)),
      };
    }
  }

  global.StudioSignals = {
    StudioBoard, PEOPLE, ZONES, ZONE_ORDER, ABSENT_STATUS, TALK_STATUS, LINK_COLOR,
    SETTLE_MS, LEAVE_MS, INVITE_ENTER, TALK_ENTER, zoneAt, zoneCenter, personForCode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
