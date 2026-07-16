# Victors Management Server (VMS)

## What This Is
A browser-based management interface for Pexip Infinity video infrastructure, built with plain HTML/CSS/JS (no framework, no build step). Works in any web browser.

## Project Location
`~/Desktop/VMS/web/` — all active files are here.

> Note: The folder also contains an Xcode project (`Victor's TMS.xcodeproj`) from an earlier iOS approach — this is superseded by the web app and can be ignored.

## File Structure
```
web/
  index.html   — App shell: header, two-column layout, settings modal
  style.css    — Dark monitoring theme (CSS custom properties, no framework)
  api.js       — PexipAPI class wrapping all Status API endpoints
  app.js       — State, polling loop, rendering, search, settings
  preview.js   — Live conference preview via PexRTC WebRTC (recvonly, invisible participant)
  dialer.js    — SIP Dialer panel: device management, dial logic
  proxy.js     — Local CORS proxy (Node.js, no dependencies) — handles both Pexip and Cisco
```

## Layout
Two-column split:
- **Left panel** — Pexip live conference monitor
- **Right panel (320px)** — SIP Dialer (Cisco endpoint management)

## Pexip API
- **Docs:** https://docs.pexip.com
- **Base URL:** `https://<manager>/api/admin/status/v1/` (Status, read-only)
- **Config URL:** `https://<manager>/api/admin/configuration/v1/` (not yet wired up)
- **Auth:** HTTP Basic (username + password via Authorization header)
- **Method:** Polling (no push/websocket on the status API)

### Status endpoints used
| Resource | Path |
|---|---|
| Conferences | `/api/admin/status/v1/conference/` |
| Participants | `/api/admin/status/v1/participant/` |
| Nodes | `/api/admin/status/v1/worker_vm/` |
| Alarms | `/api/admin/status/v1/alarm/` |
| Media streams | `/api/admin/status/v1/participant/<id>/media_stream/` |

## Cisco SIP Dialer
Ported from `~/Desktop/CiscoSIPDialer` (Swift/macOS app). Sends dial commands to Cisco RoomOS/CE endpoints via the xAPI.

- **Endpoint API:** POST `https://<device>/putxml` with XML body
- **Auth:** HTTP Basic per device
- **Credentials:** stored per-device in `localStorage` (`vms_cisco_devices_v1`)
- **Proxy route:** `POST http://localhost:8080/api/cisco/dial` — proxy builds and sends the XML, handles self-signed certs

### XML format sent to Cisco
```xml
<Command>
  <Dial>
    <Number>user@conference.example.com</Number>
    <Protocol>Sip</Protocol>
    <CallType>Video</CallType>
  </Dial>
</Command>
```

### Dialer UI
- SIP address input at top of right panel (prominent, monospace, blue-bordered)
- Device list below — each entry has a checkbox (for bulk dial), name, host/IP, ▶ Dial button, ✎ edit button
- Devices header has a select-all checkbox and a **Dial N** green button (appears when ≥1 device is selected) that dials all selected devices simultaneously via `Promise.all`
- Inline add/edit form: Name, Host/IP, Username, Password
- Per-device status: yellow "Dialing…", green "Connected — HTTP 200", red error; success auto-clears after 8s
- Empty SIP field triggers red shake animation on the input
- Selected device rows highlighted with a blue tint

## CORS Workaround
Direct browser → Pexip API calls are blocked by CORS. The proxy handles both Pexip forwarding and Cisco dialing.

```bash
node ~/Desktop/VMS/web/proxy.js https://your-pexip-manager.com
```

Then set Manager URL in the app to `http://localhost:8080`. Proxy handles self-signed certs (`rejectUnauthorized: false`) for both Pexip and Cisco endpoints.

## What's Built
- **Header** — app title, connection status badge (disconnected / connecting / connected / error), last refresh time, refresh button, settings button
- **Summary cards** — active conferences, total participants, nodes online, alarms (turns amber when alarms exist)
- **Alarms banner** — appears at top when active alarms are present
- **Conference list** — expandable cards per conference showing name, service type badge, lock/mute status, participant count, duration
- **Participant table** — inside each expanded conference: name, alias, role (Host/Guest), protocol, call quality dot (Good/OK/Bad/Terrible), bandwidth (↓↑), status icons (muted/presenting/recording/on hold/streaming/transcribing), media node
- **Search** — filters conferences by name, type, or tag
- **Auto-refresh** — configurable: 5s (default) / 10s / 30s / 1m
- **Settings modal** — manager URL, username, password, refresh interval, "remember credentials" checkbox (sessionStorage vs localStorage)
- **SIP Dialer panel** — right sidebar with SIP address input and managed list of Cisco video endpoints; each device has a checkbox for selection; a "Dial N" button in the header dials all selected devices simultaneously
- **Bulk dial** — select any combination of devices with checkboxes, then hit "Dial N" to call the same SIP address on all selected endpoints in parallel (`Promise.all`)
- **Error states** — connection errors surface with helpful CORS proxy instructions

## Live Preview (preview.js)

PexRTC WebRTC integration for viewing the conference composite inside an expanded conference card.

- **Call type:** `recvonly` — joins as an invisible, receive-only participant (no camera prompt, not visible in the conference layout)
- **Do NOT change to `video`** — that triggers a camera permission prompt and makes VMS Monitor appear as a participant inside the conference video
- **Stream delivery:** PexRTC calls `onConnect(null)` in recvonly mode; the composite arrives via `onPresentation` → `rtc.getPresentation()` → `onPresentationConnected(stream)`
- **PexRTC reset:** `_resetPexRTC()` tears down the script tag and clears the `PexRTC` global between sessions — required so the next preview gets clean internal state (reused global causes `onPresentation` not to fire on restart)
- **Page lifecycle:** `pagehide` disconnects open previews; `pageshow` with `event.persisted` detects bfcache restore and resets PexRTC before the user can click Preview again

## Possible Next Improvements
- VMR management (Configuration API) — list, create, edit, delete Virtual Meeting Rooms
- Node health detail view — per-node load stats and capacity
- Participant media stream drill-down — audio/video codec, bitrate, packet loss, jitter
- Conference actions — lock/unlock, mute guests (requires Command API)
- Alarms detail panel
- Dark/light theme toggle
- Export conference data to CSV
- Multi-manager support (connect to more than one Pexip deployment)
- Disconnect/hangup button per Cisco device (xAPI `Call Disconnect`)

## Running the App
1. Start the proxy: `node ~/Desktop/VMS/web/proxy.js https://mgr1.kinneycollab.com`
2. Open `~/Desktop/VMS/web/index.html` in any browser
3. Set Manager URL to `http://localhost:8080` in Settings

## Git Workflow
Whenever the user asks to save or commit changes, always push to the remote immediately after committing:
```
git push origin main
```
The remote is `https://github.com/makinney-pexip/VMS.git`. Commit then push in one step — never leave commits local.
