================================================================================
 VICTORIA'S MANAGEMENT SERVER (VMS)
================================================================================

DESCRIPTION
-----------
Victoria's Meeting Manager is a browser-based management and monitoring
interface for Pexip Infinity video conferencing infrastructure. It runs
entirely in a web browser with no installation required — open the HTML
file directly on any device and it connects to your Pexip deployment via
a lightweight local proxy.

The interface provides real-time visibility into active conferences,
participants, node health, and alarms, with a live video preview of any
conference using Pexip's PexRTC WebRTC library. A built-in SIP Dialer
lets you send dial commands to Cisco RoomOS/CE video endpoints directly
from the same interface.

Built with plain HTML, CSS, and JavaScript — no frameworks, no build
step, no dependencies.


--------------------------------------------------------------------------------
BUILD GUIDE — PROMPTS
--------------------------------------------------------------------------------

Use the following prompts in order to build this project from scratch.
Each prompt describes one self-contained piece of the application.


────────────────────────────────────────────────────────────────────────────────
1. PROJECT SCAFFOLD
────────────────────────────────────────────────────────────────────────────────
Build a browser-based Pexip Infinity management dashboard using only plain
HTML, CSS, and JavaScript — no frameworks, no build step, no dependencies.
It must open directly from the filesystem as a local HTML file. Use a dark
monitoring theme with CSS custom properties (dark navy/slate backgrounds,
white text, colored accent badges). Two-column layout: a wide left panel
for the conference monitor, a fixed 320 px right sidebar for a SIP dialer.


────────────────────────────────────────────────────────────────────────────────
2. CORS PROXY
────────────────────────────────────────────────────────────────────────────────
Write a Node.js HTTP proxy server (proxy.js) with no npm dependencies
(stdlib only). It should:

  - Accept a Pexip manager URL as a CLI argument:
    node proxy.js https://pexip.example.com
  - Forward all unmatched requests to that target, injecting
    Access-Control-Allow-* CORS headers on every response
  - Disable TLS certificate verification (rejectUnauthorized: false)
    for both Pexip and downstream Cisco endpoints
  - Expose a GET /api/target endpoint that returns the target URL as
    JSON, so the browser can discover the real hostname for WebRTC
  - Expose POST /api/cisco/dial and POST /api/cisco/disconnect routes
    for Cisco xAPI (described later)
  - Expose GET /api/devices and POST /api/devices routes that read/write
    a devices.json file next to the proxy for device persistence
  - Listen on 127.0.0.1:8080 by default, with an optional second CLI
    argument to override the port


────────────────────────────────────────────────────────────────────────────────
3. PEXIP API CLIENT
────────────────────────────────────────────────────────────────────────────────
Write a PexipAPI class that wraps Pexip Infinity's read-only Status REST
API. Base URL is https://<manager>/api/admin/status/v1/. Auth is HTTP
Basic, sent as an Authorization header. All requests add limit=500 as a
query parameter. Implement methods for: getConferences(), getParticipants(),
getNodes(), getAlarms(), and disconnectParticipant(participantId) — the
last one is a POST to /api/admin/command/v1/participant/disconnect/. A 401
response should throw a human-readable "Authentication failed" error.


────────────────────────────────────────────────────────────────────────────────
4. SETTINGS AND POLLING LOOP
────────────────────────────────────────────────────────────────────────────────
Build a settings system that stores manager URL, username, password,
refresh interval (5s / 10s / 30s / 1m), and a "remember credentials"
checkbox. When remember is off, use sessionStorage; when on, use
localStorage. On page load, restore settings automatically and begin
polling. Show a settings modal (gear icon in the header) that opens on
first load if no credentials are saved. The header should show a status
badge that cycles through: Disconnected → Connecting → Connected / Error,
plus a "last refreshed" timestamp and a manual refresh button that spins
while fetching.


────────────────────────────────────────────────────────────────────────────────
5. CONFERENCE MONITOR — SUMMARY CARDS
────────────────────────────────────────────────────────────────────────────────
At the top of the left panel, show four stat cards: Active Conferences,
Total Participants, Nodes Online (shown as online / total), and Alarms.
The alarms card should turn amber and show a border when the count is
greater than zero. Above the conference list, show an alarms banner listing
alarm names when any are active.


────────────────────────────────────────────────────────────────────────────────
6. CONFERENCE MONITOR — CONFERENCE CARDS
────────────────────────────────────────────────────────────────────────────────
Render each active conference as a collapsible card. The header row shows:
expand chevron, conference name, a service-type badge (VMR / Auditorium /
Reception / Gateway / Test Call, color-coded), lock/mute status badges,
participant count and host/guest split, and how long ago it started.
Clicking the header toggles expansion to show the participant table. Add a
search input that filters conferences by name, service type, or tag. Each
card also has an "End" button that calls disconnectParticipant on all
participants in that conference after a confirmation dialog.


────────────────────────────────────────────────────────────────────────────────
7. CONFERENCE MONITOR — PARTICIPANT TABLE
────────────────────────────────────────────────────────────────────────────────
Inside an expanded conference card, render a table with columns:
Participant (display name + alias below), Role (Host/Guest badge),
Protocol, Call Quality (colored dot: Good=green / OK=yellow / Bad=red /
Terrible=pulsing red), Bandwidth (↓ rx / ↑ tx in kbps or Mbps), Status
icons (muted, presenting, recording, on hold, streaming, transcribing),
and Media Node. The quality values from the Pexip API are strings like
"1_good", "2_ok", "3_bad", "4_terrible".


────────────────────────────────────────────────────────────────────────────────
8. LIVE CONFERENCE PREVIEW  *** READ CONSTRAINTS CAREFULLY ***
────────────────────────────────────────────────────────────────────────────────
Add a live video preview to each conference card using Pexip's PexRTC
WebRTC library. When the user clicks a Preview button on a conference
card, load PexRTC dynamically from:

  https://<pexip-node>/static/webrtc/js/pexrtc.js

...and connect to the conference.

CRITICAL CONSTRAINTS — do not deviate from these:

  1. Always use call_type = 'recvonly'. Never use 'video'. Using 'video'
     triggers a camera permission prompt and makes the monitoring client
     visible as a participant inside the conference video layout, which
     is not acceptable for a passive monitoring tool.

  2. In recvonly mode, PexRTC calls onConnect(null). The composite
     conference video arrives via the presentation channel:
       onPresentation(active) → rtc.getPresentation()
                              → onPresentationConnected(stream)
     Treat this stream as the main stream.

  3. After each preview session ends, fully tear down the PexRTC script
     tag, set window.PexRTC = undefined, and reset all internal cache
     variables. If you skip this, PexRTC retains stale internal state
     and onPresentation will not fire on the next connection attempt,
     resulting in a permanent black screen.

  4. Handle the pagehide event by disconnecting all active previews.
     This prevents ghost participants lingering on the Pexip server
     after a page refresh.

  5. Handle the pageshow event with event.persisted = true (browser
     bfcache restore). Reset PexRTC and clear all preview state before
     the user can click Preview again, or the restored state will
     attempt to reuse dead WebRTC connections.

  6. If onConnect receives a non-null stream, use it directly. If it
     receives null, wait up to 10 seconds for onPresentationConnected
     to deliver the stream. If nothing arrives in 10 seconds, show a
     visible error — do not silently show a black screen.

  7. Show "Live" status only after a stream has been received and
     attached to the video element. Never show "Live" when stream is
     null.

UI: The preview panel is 240 px wide with a 16:9 aspect ratio, shown
to the left of the participant table inside the expanded card. Include
a mute/unmute audio button overlay and a PIN entry overlay for
PIN-protected conferences.


────────────────────────────────────────────────────────────────────────────────
9. MANAGE LINK
────────────────────────────────────────────────────────────────────────────────
For each conference card, resolve the Pexip node hostname in this
priority order: (1) explicit preview-node setting in app settings,
(2) participant media_node field, (3) real manager URL from proxy's
/api/target endpoint, (4) manager URL from settings if it is not
localhost. Build a "Manage ↗" link to:

  https://<node>/webapp/m/<alias>/mm?name=operator&join=1

Extract the alias from participants' destination_alias field — strip
the protocol prefix (sip:, h323:) and take only the local part before
the @ symbol. Open the link in a new tab.


────────────────────────────────────────────────────────────────────────────────
10. SIP DIALER — CISCO DEVICE MANAGEMENT
────────────────────────────────────────────────────────────────────────────────
In the right sidebar, build a SIP Dialer panel. At the top, a prominent
monospace text input for a SIP address (e.g. user@conference.example.com).
Below that, a list of saved Cisco RoomOS/CE video endpoints.

Each device row shows: a checkbox (for bulk selection), device name,
host/IP, a Dial button, a disconnect button, and an edit button.

Selecting one or more devices reveals a "Dial N" green button and a
disconnect "■ N" red button in the list header that act on all selected
devices simultaneously via Promise.all.

Devices are persisted to the proxy's /api/devices endpoint, falling back
to localStorage if the proxy is unreachable. Inline add/edit form fields:
Name, Host/IP, Username, Password.

An empty SIP address field when Dial is clicked should trigger a red shake
animation on the input rather than attempting a call.


────────────────────────────────────────────────────────────────────────────────
11. SIP DIALER — CISCO XAPI DIAL AND DISCONNECT
────────────────────────────────────────────────────────────────────────────────
The proxy's POST /api/cisco/dial route accepts JSON:
  { host, username, password, sipAddress, callType }

It sends the following XML to https://<host>/putxml with HTTP Basic auth:

  <Command>
    <Dial>
      <Number>…</Number>
      <Protocol>Sip</Protocol>
      <CallType>Video</CallType>
    </Dial>
  </Command>

The POST /api/cisco/disconnect route sends the following to the same
endpoint:

  <Command>
    <Call>
      <Disconnect/>
    </Call>
  </Command>

Both routes handle self-signed certificates and return JSON:
  { success: bool, statusCode: int, body: string }

Per-device status in the UI:
  - Yellow "Dialing…" while the request is in flight
  - Green "Connected — HTTP 200" on success (auto-clears after 8 seconds)
  - Red error message on failure


────────────────────────────────────────────────────────────────────────────────
RECOMMENDED BUILD ORDER
────────────────────────────────────────────────────────────────────────────────
  1.  Proxy + API client
  2.  Settings modal + polling loop + header status badge
  3.  Summary cards
  4.  Conference cards + participant table
  5.  Search + alarms banner
  6.  End conference button
  7.  Manage link
  8.  Live preview (PexRTC) — read all constraints before starting
  9.  SIP Dialer device list + CRUD
  10. Cisco dial / disconnect

================================================================================
