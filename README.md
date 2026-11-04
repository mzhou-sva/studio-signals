# Studio Signals | Shared Studio Desk

Built around two questions: "Can I interrupt you right now?" and "I want to talk about my project. Who can I ask?"

Each person is represented by a small object with a QR code on it. Moving the object shows how that person is right now.
The camera picture is split into three zones, left to right:

| Zone | What the person means | What the system does |
|---|---|---|
| Focus zone | I want to work on my own for a while. | Shows "Focusing" and keeps the person off the open list. |
| Open zone | I'm happy to hear other people's ideas right now. | Shows the person can join a conversation. |
| Feedback zone | I want to talk about my project. | Shows a request for feedback and who is open to talk. |

Example: A is in the Focus zone, B is in the Feedback zone. C moves their object into the Open zone and the screen says
"B wants to discuss a project idea. C, you can talk to B now." When C goes back to the Focus zone, the open list updates.

## Three movements (new in 2026-11-03)

On top of the three zones, three movements each give visual feedback:

| Movement | What happens | Feedback |
|---|---|---|
| **Cross zones** | Move an object into another zone. | Status, colour and the open list update; the zone pulses and a ring grows around the object. |
| **Come closer** | Someone who needs feedback moves toward someone who is open. | A dashed line and "Invitation". When the other person moves closer too, a solid glowing line and **"Discussing"** on both. |
| **Move apart** | The two objects separate. | The line disappears and both go back to their own status. |

Distances are measured in % of the frame height. A line is drawn from 40 apart, "Discussing" needs 22 or less and the other
person must have moved at least 3; the line is dropped at 50 (invitation) or 30 (discussing), so a shaky code does not flicker
(`INVITE_*`, `TALK_*` in `signals.js`). In demo mode the **Closer** button moves an object half way toward its partner and
**Move everyone apart** puts everyone back.

## QR codes

`phone` = A, `object-a` = B, `object-b` = C. Any other code only gets a grey box.

## Run

```
python3 -m http.server 8000
```

Open `http://localhost:8000/`. The camera needs `http://localhost` or HTTPS. No camera? Use the demo button and move the objects with the buttons.

## Timing and tests

An object has to stay in a new zone for 0.5 s to count as a move, and be gone for 1.5 s to count as taken off the table
(`SETTLE_MS` and `LEAVE_MS` in `signals.js`). `node test.js` checks the whole story.

## Deploy

Static page, no keys needed. GitHub Pages: Settings → Pages → `main` branch, root folder. The QR library jsQR loads from a CDN.
