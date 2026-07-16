# Victors Management Server (VMS)

A browser-based monitoring and management interface for **Pexip Infinity** video infrastructure. View live conferences, participants, nodes, and alarms — dial Cisco RoomOS endpoints — and join conferences as an operator — all from a single dashboard.

---

## Requirements

- **Node.js** — [download at nodejs.org](https://nodejs.org) (used to run the local proxy)
- A modern web browser (Chrome, Safari, Firefox, Edge)
- Access to a Pexip Infinity management node

---

## Quick Start

### 1. Download the project

Clone or download this repository to your Mac:

```bash
git clone https://github.com/makinney-pexip/VMS.git ~/Desktop/VMS
```

Or download the ZIP from GitHub and unzip it to your Desktop.

---

### 2. Start the Local Web Proxy

The proxy handles CORS, self-signed certificates, and persistent device storage between the browser and Pexip.

#### Option A — Double-click (easiest)

1. Open Finder and navigate to the `VMS` folder
2. Double-click **`Local Web Proxy.command`**
3. A Terminal window opens and the proxy starts

> **First time only:** macOS may block the file. Right-click → **Open** → **Open** to allow it.

#### Option B — Terminal

```bash
node ~/Desktop/VMS/web/proxy.js https://your-management-node.example.com
```

Replace `your-management-node.example.com` with your Pexip manager hostname.

The proxy runs on `http://localhost:8080`. **Keep the Terminal window open** while using the app.

---

### 3. Open the App

Open the file `~/Desktop/VMS/web/index.html` in your browser.

---

### 4. Configure the Connection

Click the **⚙ Settings** button (top right) and fill in:

| Field | Value |
| --- | --- |
| **Manager URL** | `http://localhost:8080` |
| **Username** | Your Pexip admin username |
| **Password** | Your Pexip admin password |
| **Preview node** | Public-facing Pexip hostname for live video (e.g. `proxy.example.com`) — leave blank to auto-detect |

Click **Save & Connect**. The dashboard will start polling your Pexip deployment.

---

## Features

### Conference Monitoring

- **Live conference list** — active conferences with service type, lock/mute status, participant count, and duration
- **Participant table** — name, role (Host/Guest), protocol, call quality, bandwidth, and status icons (muted, presenting, recording, on hold, streaming)
- **Alarms banner** — active Pexip alarms surfaced at the top of the dashboard
- **Summary cards** — at-a-glance counts for conferences, participants, nodes online, and alarms
- **Search** — filter conferences by name, type, or tag
- **Auto-refresh** — configurable polling interval (5s / 10s / 30s / 1m)

### Conference Actions

- **◎ Preview** — inline live video thumbnail alongside the participant table; receive-only WebRTC join (no camera or mic required); auto-closes when the conference ends; supports PIN-protected conferences
- **Manage ↗** — opens the Pexip Web App for that conference in a new tab, pre-joined as operator for full meeting control
- **End** — disconnects all participants from a conference simultaneously with a confirmation prompt

### SIP Dialer (Cisco Endpoints)

- **Persistent device list** — saved to `devices.json` on disk via the proxy; survives browser restarts and works across any browser on the same machine
- **Dial** — send a SIP address to any endpoint with one click
- **Bulk dial** — select multiple devices and dial them all simultaneously
- **Disconnect** — hang up individual devices or all at once

---

## Project Structure

```text
VMS/
  Local Web Proxy.command   — double-click to start the proxy on macOS
  web/
    index.html              — app shell
    style.css               — dark monitoring theme
    api.js                  — Pexip Status & Command API client
    app.js                  — state, polling, rendering, conference actions
    preview.js              — PexRTC live video preview
    dialer.js               — Cisco SIP Dialer panel
    proxy.js                — local CORS proxy (Node.js); also serves device storage
    devices.json            — persisted device list (created automatically, not committed)
```

---

## Changing the Management Node

To point the proxy at a different Pexip manager, start it manually in Terminal:

```bash
node ~/Desktop/VMS/web/proxy.js https://your-management-node.example.com
```

Or edit `Local Web Proxy.command` in a text editor and update the hostname on the last line.

---

## Troubleshooting

### CORS error / cannot connect

Make sure the proxy is running and the Manager URL in Settings is set to `http://localhost:8080`.

### Live preview shows no video

Open the browser DevTools console (⌘+Option+I) and look for `[VMS preview]` log lines showing the node and alias being used. Common fixes:

- Set the **Preview node** in Settings to a public-facing hostname with a valid TLS certificate (e.g. `proxy.example.com`)
- If the node uses a self-signed certificate, open `https://your-node.example.com` in a new tab, accept the warning, then retry

### Manage link gives "Page not found"

Check that the **Preview node** setting matches your Pexip Web App hostname and that the conference alias is correctly resolved. The URL format used is `https://<preview-node>/webapp/m/<alias>/mm?name=operator&join=1`.

### Devices disappeared after browser restart

The proxy must be running for device persistence to work. If it was not running when you added devices, they were saved to localStorage only. Restart the proxy and re-add your devices — they will then be saved to `devices.json` and persist automatically.

### "Cannot determine Pexip node address" alert

Set the **Preview node** field in Settings, or ensure at least one participant is active in the conference.
