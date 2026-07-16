# Victoria's Meeting Manager

A browser-based monitoring and management interface for **Pexip Infinity** video infrastructure. View live conferences, participants, nodes, and alarms — control meetings in real time — dial Cisco RoomOS endpoints — all from a single dashboard.

---

## Requirements

- **Node.js** — [download at nodejs.org](https://nodejs.org) (used to run the local proxy)
- A modern web browser (Chrome, Safari, Firefox, Edge)
- Access to a Pexip Infinity management node

---

## Quick Start

### 1. Download the project

Clone or download this repository:

```bash
git clone https://github.com/catherinecq-pexip/Meeting-Manager.git
```

Or download the ZIP from GitHub and unzip it.

---

### 2. Start the Local Web Proxy

The proxy handles CORS, self-signed certificates, and persistent device storage between the browser and Pexip.

#### Option A — Double-click (easiest)

1. Open Finder and navigate to the `Meeting-Manager` folder
2. Double-click **`Local Web Proxy.command`**
3. A Terminal window opens and the proxy starts

> **First time only:** macOS may block the file. Right-click → **Open** → **Open** to allow it.

#### Option B — Terminal

```bash
node web/proxy.js https://pexip.yourcompany.com
```

Replace `pexip.yourcompany.com` with your Pexip manager hostname.

The proxy runs on `http://localhost:8080`. **Keep the Terminal window open** while using the app.

---

### 3. Open the App

Open `web/index.html` in your browser.

---

### 4. Configure the Connection

Click the **⚙ Settings** button (top right) and fill in:

| Field | Value |
| --- | --- |
| **Manager URL** | `http://localhost:8080` |
| **Username** | Your Pexip admin username |
| **Password** | Your Pexip admin password |
| **Preview node** | Public-facing Pexip hostname for live video (e.g. `pexip.yourcompany.com`) — leave blank to auto-detect |

Click **Save & Connect**. The dashboard will start polling your Pexip deployment.

---

## Features

### Conference Monitoring

- **Live conference list** — active conferences with service type, lock/mute status, participant count, and duration
- **Participant table** — name, role (Host/Guest), protocol, call quality, bandwidth, and status icons (muted, presenting, recording, on hold, streaming)
- **Per-participant actions** — mute/unmute and disconnect individual participants
- **Alarms banner** — active Pexip alarms surfaced at the top of the dashboard
- **Summary cards** — at-a-glance counts for conferences, participants, nodes online, and alarms
- **Search** — filter conferences by name, type, or tag
- **Auto-refresh** — configurable polling interval (5s / 10s / 30s / 1m)

### Conference Controls (Host)

All meeting controls use a PexRTC WebSocket connection with host role. When a conference has a host PIN, a **Host PIN** prompt appears automatically when the card is expanded.

- **Layout** — change the conference video layout for all participants (Adaptive Composition, grid layouts, Teams-style, and more)
- **📢 Banner** — set or clear a text message displayed as an overlay inside the meeting
- **Countdown Timer** — start a countdown, elapsed timer, or current-time display visible to all participants
- **🎤 Guests Can Present** — toggle whether guest participants are allowed to share their screen
- **🔇 Mute Guests** — mute or unmute all guest participants simultaneously
- **✕ Disconnect participant** — remove a specific participant from the meeting with a confirmation prompt
- **End** — disconnect all participants from a conference with a confirmation prompt

### Live Preview

- **◎ Preview** — inline live video thumbnail alongside the participant table; receive-only WebRTC join (no camera or mic, not visible in the conference layout); supports PIN-protected conferences

### Manage Link

- **Manage ↗** — opens the Pexip Web App for that conference in a new tab, pre-joined as operator for full meeting control

### SIP Dialer (Cisco Endpoints)

- **Persistent device list** — saved to `devices.json` on disk via the proxy; survives browser restarts
- **Dial** — send a SIP address to any Cisco RoomOS endpoint with one click
- **Bulk dial** — select multiple devices and dial them all simultaneously
- **Disconnect** — hang up individual devices or all at once

---

## Project Structure

```text
Meeting-Manager/
  Local Web Proxy.command   — double-click to start the proxy on macOS
  web/
    index.html              — app shell
    style.css               — dark monitoring theme
    api.js                  — Pexip Status & Command API client
    clientapi.js            — Pexip Client REST API (token management)
    app.js                  — state, polling, rendering, conference actions
    preview.js              — PexRTC live video preview + host control connection
    dialer.js               — Cisco SIP Dialer panel
    proxy.js                — local CORS proxy (Node.js); also serves device storage
    devices.json            — persisted device list (created automatically, not committed)
```

---

## Changing the Management Node

To point the proxy at a different Pexip manager, start it manually in Terminal:

```bash
node web/proxy.js https://pexip.yourcompany.com
```

Or edit `Local Web Proxy.command` in a text editor and update the hostname on the last line.

---

## Troubleshooting

### CORS error / cannot connect

Make sure the proxy is running and the Manager URL in Settings is set to `http://localhost:8080`.

### Live preview shows no video

Open the browser DevTools console and look for `[VMS preview]` log lines. Common fixes:

- Set the **Preview node** in Settings to a public-facing hostname with a valid TLS certificate
- If the node uses a self-signed certificate, open `https://your-node.example.com` in a new tab, accept the warning, then retry

### Meeting controls have no effect

Meeting controls (banner, timer, layout, guest presentation) require a **host-role** PexRTC connection. If the conference has a host PIN, expand the conference card — a yellow **Host PIN required** bar will appear. Enter the host PIN to enable all controls.

### Manage link gives "Page not found"

Check that the **Preview node** setting matches your Pexip Web App hostname and that the conference alias is correctly resolved. The URL format is `https://<preview-node>/webapp/m/<alias>/mm?name=operator&join=1`.

### Devices disappeared after browser restart

The proxy must be running for device persistence to work. Restart the proxy and re-add your devices — they will then be saved to `devices.json` and persist automatically.
