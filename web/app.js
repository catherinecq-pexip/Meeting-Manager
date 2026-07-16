// Victor's TMS — Application Controller

const STORAGE_KEY = 'pexip_tms_v1';

const state = {
  settings: null,
  conferences: [],
  participants: [],
  nodes: [],
  alarms: [],
  expandedConferences: new Set(),
  disconnectingConferences: new Set(),
  refreshTimer: null,
  lastRefresh: null,
  loading: false,
  error: null,
  searchQuery: '',
  pexipDirectUrl: null,
  confTokens: new Map(),    // alias  → { token, nodeHost, layouts: [] }
  bannerPanels: new Map(),  // confId → { open: bool, message: '', clock: null }
};

// ── Settings ──────────────────────────────────────────────

function loadSettings() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
    if (stored) {
      state.settings = JSON.parse(stored);
      populateSettingsForm();
      applySettings();
    } else {
      openSettings();
    }
  } catch (_) {
    openSettings();
  }
}

function saveSettings() {
  const s = {
    url:         document.getElementById('setting-url').value.trim().replace(/\/$/, ''),
    username:    document.getElementById('setting-username').value.trim(),
    password:    document.getElementById('setting-password').value,
    interval:    parseInt(document.getElementById('setting-interval').value, 10),
    remember:    document.getElementById('setting-remember').checked,
    previewNode: document.getElementById('setting-preview-node').value.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''),
  };

  if (!s.url || !s.username || !s.password) {
    showFormError('All fields are required.');
    return;
  }

  hideFormError();
  state.settings = s;

  const store = s.remember ? localStorage : sessionStorage;
  store.setItem(STORAGE_KEY, JSON.stringify(s));
  if (!s.remember) localStorage.removeItem(STORAGE_KEY);

  applySettings();
  closeSettings();
  refresh();
}

function populateSettingsForm() {
  if (!state.settings) return;
  document.getElementById('setting-url').value         = state.settings.url;
  document.getElementById('setting-username').value    = state.settings.username;
  document.getElementById('setting-password').value    = state.settings.password;
  document.getElementById('setting-interval').value    = state.settings.interval || 5;
  document.getElementById('setting-remember').checked  = !!state.settings.remember;
  document.getElementById('setting-preview-node').value = state.settings.previewNode || '';
}

function applySettings() {
  if (!state.settings) return;
  api.configure(state.settings.url, state.settings.username, state.settings.password);
  scheduleRefresh();
  fetchProxyTarget();
}

async function fetchProxyTarget() {
  if (!state.settings?.url) return;
  try {
    const res = await fetch(`${state.settings.url}/api/target`);
    if (res.ok) {
      const data = await res.json();
      state.pexipDirectUrl = data.url;
    }
  } catch (_) {}
}

function isPrivateHostname(h) {
  if (!h || !h.includes('.')) return true; // unqualified short hostnames are not globally resolvable
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/i.test(h) ||
         /^(::1|localhost)$/i.test(h);
}

function resolveNodeHostname(confParts) {
  // Explicit setting always wins
  if (state.settings?.previewNode) return state.settings.previewNode;

  // Derive base domain from manager URL (e.g. mgr.example.com → example.com)
  // so we can construct FQDNs for short-named worker nodes (e.g. node01 → node01.example.com)
  const managerDomain = (() => {
    try {
      const parts = new URL(state.settings?.url || '').hostname.split('.');
      return parts.length >= 3 ? parts.slice(1).join('.') : null;
    } catch (_) { return null; }
  })();

  // Diagnostic: show exactly what the function has to work with
  console.log('[VMS resolveNode] nodes count:', state.nodes.length,
    state.nodes.map(n => ({hostname: n.hostname, name: n.name, address: n.address, domain: n.domain})));
  console.log('[VMS resolveNode] managerDomain:', managerDomain);
  console.log('[VMS resolveNode] participant media_nodes:', confParts.map(p => p.media_node));

  // Participant's media node — skip private/VNet IPs that are unreachable from the browser
  for (const p of confParts) {
    if (!p.media_node) continue;
    if (!isPrivateHostname(p.media_node)) return p.media_node;

    // Private IP — try to find the matching worker_vm via several possible address fields
    const node = state.nodes.find(n =>
      n.address    === p.media_node ||
      n.ip_address === p.media_node ||
      n.hostname   === p.media_node
    );
    if (node) {
      const shortName = node.hostname || node.name;
      const domain    = node.domain || managerDomain;
      const fqdn      = (shortName && domain) ? `${shortName}.${domain}` : null;
      if (fqdn           && !isPrivateHostname(fqdn))           return fqdn;
      if (node.name      && !isPrivateHostname(node.name))      return node.name;
      if (node.hostname  && !isPrivateHostname(node.hostname))  return node.hostname;
    }
  }

  // General scan: any worker_vm with a public hostname works — Pexip routes calls between nodes
  for (const node of state.nodes) {
    const shortName = node.hostname || node.name;
    const domain    = node.domain || managerDomain;
    const fqdn      = (shortName && domain) ? `${shortName}.${domain}` : null;
    console.log('[VMS resolveNode] node candidate:', {shortName, domain, fqdn, address: node.address});
    if (fqdn          && !isPrivateHostname(fqdn))          return fqdn;
    if (node.name     && !isPrivateHostname(node.name))     return node.name;
    if (node.hostname && !isPrivateHostname(node.hostname)) return node.hostname;
    if (node.address  && !isPrivateHostname(node.address))  return node.address;
  }

  // Real Pexip URL from proxy /api/target
  if (state.pexipDirectUrl) {
    try { return new URL(state.pexipDirectUrl).hostname; } catch (_) {}
  }

  // Settings URL if it's not the local proxy
  if (state.settings?.url) {
    try {
      const u = new URL(state.settings.url);
      if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return u.hostname;
    } catch (_) {}
  }
  return null;
}

// For the Manage URL path — strip scheme AND domain: sip:hfr@vc.x.com → hfr
function extractConfAliasShort(confParts, fallback) {
  const raw = confParts.find(p => p.destination_alias)?.destination_alias;
  if (!raw) return fallback;
  let alias = raw.replace(/^(sips?|h323):/i, '');
  if (alias.includes('@')) alias = alias.split('@')[0];
  return alias || fallback;
}


// ── Refresh Loop ───────────────────────────────────────────

function scheduleRefresh() {
  clearInterval(state.refreshTimer);
  if (!state.settings) return;
  const ms = (state.settings.interval || 5) * 1000;
  state.refreshTimer = setInterval(refresh, ms);
}

async function refresh() {
  if (!state.settings || state.loading) return;
  state.loading = true;
  const el = document.getElementById('connection-status');
  if (el.classList.contains('status-disconnected') || el.classList.contains('status-error')) {
    setConnectionStatus('connecting');
  }
  document.getElementById('refresh-btn').classList.add('spinning');

  try {
    const [confs, parts, nodes, alarms] = await Promise.allSettled([
      api.getConferences(),
      api.getParticipants(),
      api.getNodes(),
      api.getAlarms(),
    ]);

    if (confs.status   === 'fulfilled') state.conferences  = confs.value.objects   || [];
    if (parts.status   === 'fulfilled') state.participants = parts.value.objects   || [];
    if (nodes.status   === 'fulfilled') state.nodes        = nodes.value.objects   || [];
    if (alarms.status  === 'fulfilled') state.alarms       = alarms.value.objects  || [];

    // Surface the first error (usually auth failure) if all failed
    if (confs.status === 'rejected') throw confs.reason;

    state.error      = null;
    state.lastRefresh = new Date();
    setConnectionStatus('connected');
    render();
  } catch (err) {
    state.error = err.message;
    setConnectionStatus('error', err.message);
    renderError(err.message);
  } finally {
    state.loading = false;
    document.getElementById('refresh-btn').classList.remove('spinning');
  }
}

// ── Rendering ─────────────────────────────────────────────

function render() {
  renderSummaryCards();
  renderConferences();
  renderAlarmsBanner();
  renderLastRefresh();
}

function renderSummaryCards() {
  const onlineNodes = state.nodes.filter(n =>
    (n.maintenance_mode === false || n.maintenance_mode == null)
  ).length;

  document.getElementById('stat-conferences').textContent  = state.conferences.length;
  document.getElementById('stat-participants').textContent = state.participants.length;
  document.getElementById('stat-nodes').textContent        = `${onlineNodes} / ${state.nodes.length}`;
  document.getElementById('stat-alarms').textContent       = state.alarms.length;

  document.getElementById('card-alarms').classList.toggle('card-warn', state.alarms.length > 0);
}

function renderAlarmsBanner() {
  const banner = document.getElementById('alarms-banner');
  if (state.alarms.length === 0) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  banner.innerHTML = `
    <strong>⚠ ${state.alarms.length} alarm${state.alarms.length > 1 ? 's' : ''}</strong>
    ${state.alarms.slice(0, 3).map(a => `<span class="alarm-item">${escHtml(a.name || a.details || 'Alarm')}</span>`).join('')}
    ${state.alarms.length > 3 ? `<span class="alarm-more">+${state.alarms.length - 3} more</span>` : ''}
  `;
}

function renderConferences(force = false) {
  const container = document.getElementById('conferences-container');
  if (!force) {
    const active = document.activeElement;
    if (active && container.contains(active) &&
        (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')) {
      return;
    }
  }
  const query = state.searchQuery.toLowerCase();

  let list = state.conferences;
  if (query) {
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(query) ||
      (c.service_type || '').toLowerCase().includes(query) ||
      (c.tag || '').toLowerCase().includes(query)
    );
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📡</div>
        <div>${state.settings ? (query ? 'No conferences match your search.' : 'No active conferences.') : 'Configure your Pexip manager to get started.'}</div>
      </div>`;
    return;
  }

  container.innerHTML = list.map(conf => renderConferenceCard(conf)).join('');
  preview.attachStreams();
}

function buildManageUrl(conf, confParts) {
  const node = state.settings?.previewNode
    || (state.pexipDirectUrl ? (() => { try { return new URL(state.pexipDirectUrl).hostname; } catch(_){} })() : null)
    || null;
  if (!node) return null;
  const alias = extractConfAliasShort(confParts, conf.name);
  if (!alias) return null;
  return `https://${node}/webapp/m/${encodeURIComponent(alias)}/mm?name=operator&join=1`;
}

function renderConferenceCard(conf) {
  const confParts = state.participants.filter(p => p.conference === conf.name);
  const isExpanded = state.expandedConferences.has(conf.id) || state.expandedConferences.has(conf.name);
  const previewActive = preview.isActive(conf.name);
  const showExpanded = isExpanded || previewActive;
  const isDisconnecting = state.disconnectingConferences.has(conf.name);
  const isGateway = conf.service_type === 'gateway';
  const manageUrl = buildManageUrl(conf, confParts);
  const hosts  = confParts.filter(p => p.role === 'chair').length;
  const guests = confParts.filter(p => p.role === 'guest').length;
  const confId = conf.name;
  const alias  = extractConfAliasShort(confParts, conf.name);
  const bannerOpen        = state.bannerPanels.get(confId)?.open || false;
  const guestsCanPresent  = preview.getGuestsCanPresent(conf.name); // null | true | false
  const guestPresentLabel = guestsCanPresent === null
    ? '🎤 Guests Present'
    : guestsCanPresent ? '🎤 Guests: Can Present' : '🚫 Guests: No Presenting';
  const guestPresentTitle = guestsCanPresent === null
    ? 'Expand conference to control guest presenting'
    : guestsCanPresent ? 'Click to disallow guests from presenting' : 'Click to allow guests to present';

  // Standard Pexip layout options — hardcoded, no REST API dependency
  const LAYOUTS = [
    ['ac',                    'Adaptive Composition'],
    ['1:0',                   '1 main, no pips'],
    ['1:7',                   '1 main + 7 pips'],
    ['2:21',                  '2 main + 21 pips'],
    ['1:33',                  '1 main + 33 pips'],
    ['2x2',                   '2×2 grid'],
    ['3x3',                   '3×3 grid'],
    ['4x4',                   '4×4 grid'],
    ['5x5',                   '5×5 grid'],
    ['teams',                 'Teams-style'],
  ];
  const layoutOptions = '<option value="" disabled selected>Layout…</option>' +
    LAYOUTS.map(([val, label]) => `<option value="${escAttr(val)}">${escHtml(label)}</option>`).join('');

  return `
    <div class="conf-card ${showExpanded ? 'expanded' : ''}">
      <div class="conf-header" onclick="toggleConference('${escAttr(conf.id)}')">
        <div class="conf-title-row">
          <span class="expand-chevron">${showExpanded ? '▾' : '▸'}</span>
          <span class="conf-name">${escHtml(conf.name || 'Unnamed')}</span>
          <span class="svc-badge svc-${conf.service_type}">${formatServiceType(conf.service_type)}</span>
          ${conf.is_locked    ? '<span class="badge badge-warn">Locked</span>'       : ''}
          ${conf.guests_muted ? '<span class="badge badge-info">Guests Muted</span>' : ''}
          ${conf.tag          ? `<span class="badge badge-neutral">${escHtml(conf.tag)}</span>` : ''}
          <select class="layout-select" title="Change conference layout"
                  onclick="event.stopPropagation()"
                  onchange="event.stopPropagation(); handleTransformLayout('${escAttr(conf.name)}', this.value)">
            ${layoutOptions}
          </select>
          <button class="btn-mute-guests"
                  onclick="event.stopPropagation(); handleMuteGuests('${escAttr(conf.name)}', ${!!conf.guests_muted})"
                  title="${conf.guests_muted ? 'Unmute all guests' : 'Mute all guests'}">
            ${conf.guests_muted ? '🔊 Unmute Guests' : '🔇 Mute Guests'}
          </button>
          <button class="btn-guests-present${guestsCanPresent === true ? ' guests-can-present' : guestsCanPresent === false ? ' guests-no-present' : ''}"
                  onclick="event.stopPropagation(); handleSetGuestsCanPresent('${escAttr(conf.name)}')"
                  ${guestsCanPresent === null ? 'disabled' : ''}
                  title="${guestPresentTitle}">
            ${guestPresentLabel}
          </button>
          ${manageUrl ? `
          <a class="btn-manage" href="${escAttr(manageUrl)}" target="_blank" rel="noopener"
             onclick="event.stopPropagation()" title="Open in Pexip Web App as operator">
            Manage ↗
          </a>` : ''}
          <button class="btn-conf-end${isDisconnecting ? ' disconnecting' : ''}"
                  onclick="event.stopPropagation(); disconnectConference('${escAttr(conf.name)}')"
                  ${isDisconnecting ? 'disabled' : ''}
                  title="Disconnect all participants">
            ${isDisconnecting ? 'Ending…' : 'End'}
          </button>
          <button class="btn-banner${bannerOpen ? ' banner-active' : ''}"
                  onclick="event.stopPropagation(); toggleBanner('${escAttr(confId)}')"
                  title="${bannerOpen ? 'Close banner panel' : 'Set message banner / timer'}">
            📢 Banner
          </button>
          ${!isGateway ? `
          <button class="btn-preview${previewActive ? ' preview-active' : ''}"
                  onclick="event.stopPropagation(); togglePreview('${escAttr(conf.name)}')"
                  title="${previewActive ? 'Stop preview' : 'Start live preview'}">
            ${previewActive ? '◉ Live' : '◎ Preview'}
          </button>` : ''}
        </div>
        <div class="conf-meta">
          <span>${confParts.length} participant${confParts.length !== 1 ? 's' : ''}</span>
          ${hosts  > 0 ? `<span>${hosts} host${hosts  > 1 ? 's' : ''}</span>`  : ''}
          ${guests > 0 ? `<span>${guests} guest${guests > 1 ? 's' : ''}</span>` : ''}
          <span>Started ${formatDuration(conf.start_time)}</span>
        </div>
      </div>
      ${showExpanded ? renderExpandedContent(conf, confParts) : ''}
    </div>`;
}

function renderExpandedContent(conf, confParts) {
  const confId     = conf.name;
  const active     = preview.isActive(confId);
  const { text, cls } = preview.getStatus(confId);
  const awaitingPin = preview.isAwaitingPin(confId);
  const safeId     = escAttr(confId);
  const ctrlStatus = preview.getControlStatus(confId);

  const videoPanel = active ? `
    <div class="conf-preview-panel">
      <video class="conf-preview-video" data-conf-id="${safeId}"
             autoplay playsinline muted></video>
      <button class="btn-preview-mute" data-conf-id="${safeId}"
              onclick="togglePreviewMute('${safeId}')" title="Toggle audio">🔇</button>
      ${awaitingPin ? `
        <div class="conf-preview-pin-overlay">
          <div class="preview-pin-label">PIN required:</div>
          <div class="preview-pin-row">
            <input type="password" class="preview-pin-input"
                   id="pin-${safeId}" placeholder="PIN"
                   onkeydown="if(event.key==='Enter') preview.submitPin('${safeId}', this.value)">
            <button class="btn-pin-submit"
                    onclick="preview.submitPin('${safeId}', document.getElementById('pin-${safeId}').value)">
              Join
            </button>
          </div>
        </div>
      ` : `
        <div class="conf-preview-status ${cls}">${escHtml(text)}</div>
      `}
    </div>` : '';

  const ctrlBar = ctrlStatus === 'pin-required' ? `
    <div class="ctrl-pin-bar">
      <span class="ctrl-pin-label">🔑 Host PIN required to control this meeting:</span>
      <input class="ctrl-pin-input" id="ctrl-pin-${safeId}" type="password" placeholder="Host PIN"
             onkeydown="if(event.key==='Enter') handleBannerPin('${safeId}', this.value)">
      <button class="btn-banner-action"
              onclick="handleBannerPin('${safeId}', document.getElementById('ctrl-pin-${safeId}').value)">
        Connect
      </button>
    </div>` : '';

  const bannerPanel = renderBannerPanel(confId);

  return `<div class="conf-expanded-body${active ? ' has-preview' : ''}">
    ${videoPanel}
    ${ctrlBar}
    <div class="conf-main-content">
      ${renderParticipantTable(confParts)}
      ${bannerPanel}
    </div>
  </div>`;
}

function renderParticipantTable(participants) {
  if (participants.length === 0) {
    return '<div class="no-participants">No participants in this conference.</div>';
  }

  const rows = participants.map(p => `
    <tr>
      <td>
        <div class="p-name">${escHtml(p.display_name || p.participant_alias || '—')}</div>
        <div class="p-alias">${escHtml(p.source_alias || '')}</div>
      </td>
      <td><span class="role-badge role-${p.role}">${p.role === 'chair' ? 'Host' : (p.role || '—')}</span></td>
      <td>${escHtml(p.protocol || '—')}</td>
      <td>${renderQuality(p.call_quality)}</td>
      <td>
        <div class="bw-cell">
          <span title="Download">↓ ${formatBandwidth(p.rx_bandwidth)}</span>
          <span title="Upload">↑ ${formatBandwidth(p.tx_bandwidth)}</span>
        </div>
      </td>
      <td class="p-status-icons">
        ${p.is_muted      ? '<span title="Muted">🔇</span>'      : ''}
        ${p.is_presenting ? '<span title="Presenting">🖥</span>' : ''}
        ${p.is_recording  ? '<span class="recording" title="Recording">⏺</span>' : ''}
        ${p.is_on_hold    ? '<span title="On Hold">⏸</span>'    : ''}
        ${p.is_streaming  ? '<span title="Streaming">📡</span>'  : ''}
        ${p.is_transcribing ? '<span title="Transcribing">💬</span>' : ''}
      </td>
      <td class="p-node">${escHtml(p.media_node || '—')}</td>
      <td class="p-actions">
        <button class="btn-mute-p${p.is_muted ? ' muted' : ''}"
                onclick="handleMuteParticipant('${escAttr(p.id)}', ${!!p.is_muted})"
                title="${p.is_muted ? 'Unmute participant' : 'Mute participant'}">
          ${p.is_muted ? '🔊' : '🔇'}
        </button>
        <button class="btn-kick-p"
                onclick="handleDisconnectParticipant('${escAttr(p.conference)}', '${escAttr(p.id)}')"
                title="Disconnect participant">
          ✕
        </button>
      </td>
    </tr>`).join('');

  return `
    <div class="part-table-wrap">
      <table class="part-table">
        <thead>
          <tr>
            <th>Participant</th>
            <th>Role</th>
            <th>Protocol</th>
            <th>Quality</th>
            <th>Bandwidth</th>
            <th>Status</th>
            <th>Node</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderLastRefresh() {
  const el = document.getElementById('last-refresh');
  el.textContent = state.lastRefresh ? `Updated ${state.lastRefresh.toLocaleTimeString()}` : '';
}

function renderError(message) {
  const container = document.getElementById('conferences-container');
  container.innerHTML = `
    <div class="error-state">
      <div class="error-icon">⚠</div>
      <div class="error-title">Connection Error</div>
      <div class="error-detail">${escHtml(message)}</div>
      <div class="error-hint">Check your manager URL and credentials, and ensure CORS is allowed on the Pexip server.</div>
    </div>`;
}

// ── UI Helpers ─────────────────────────────────────────────

function setConnectionStatus(status, tooltip = '') {
  const el = document.getElementById('connection-status');
  const labels = { disconnected: 'Disconnected', connecting: 'Connecting…', connected: 'Connected', error: 'Error' };
  el.className = `status-badge status-${status}`;
  el.textContent = labels[status] || status;
  el.title = tooltip;
}

function toggleConference(id) {
  if (state.expandedConferences.has(id)) {
    state.expandedConferences.delete(id);
    const conf = state.conferences.find(c => c.id === id || c.name === id);
    if (conf) preview.closeControlRtc(conf.name);
  } else {
    state.expandedConferences.add(id);
    const conf = state.conferences.find(c => c.id === id || c.name === id);
    if (conf) {
      const confParts = state.participants.filter(p => p.conference === conf.name);
      const nodeHost  = resolveNodeHostname(confParts);
      const confAlias = extractConfAliasShort(confParts, conf.name);
      if (nodeHost && confAlias) preview.openControlRtc(conf.name, nodeHost, confAlias);
    }
  }
  renderConferences();
}

async function disconnectConference(confName) {
  const confParts = state.participants.filter(p => p.conference === confName);
  if (confParts.length === 0) return;

  if (!window.confirm(`Disconnect all ${confParts.length} participant${confParts.length !== 1 ? 's' : ''} from "${confName}"?`)) return;

  state.disconnectingConferences.add(confName);
  renderConferences();

  try {
    await Promise.all(confParts.map(p => api.disconnectParticipant(p.id).catch(() => {})));
  } finally {
    state.disconnectingConferences.delete(confName);
  }

  // Refresh immediately so the conference disappears
  await refresh();
}

function togglePreview(confId) {
  if (preview.isActive(confId)) {
    preview.stopPreview(confId);
    renderConferences();
    return;
  }

  const conf = state.conferences.find(c => c.name === confId);
  if (!conf) return;

  if (conf.service_type === 'gateway') {
    alert('Live preview is not available for gateway calls.');
    return;
  }

  const confParts = state.participants.filter(p => p.conference === conf.name);
  const nodeHostname = resolveNodeHostname(confParts);

  if (!nodeHostname) {
    alert('Cannot determine Pexip node address. Ensure the CORS proxy is running and at least one participant is active in the conference.');
    return;
  }

  // Use local part of destination_alias (e.g. alias from sip:alias@vc.example.com)
  // falling back to conf.name. Full SIP URIs and conf.name both trigger gateway routing.
  const confAlias = extractConfAliasShort(confParts, conf.name);

  state.expandedConferences.add(conf.id ?? conf.name);
  preview.startPreview(confId, conf, nodeHostname, confAlias);
  renderConferences();
}

function togglePreviewMute(confId) {
  const video = Array.from(document.querySelectorAll('.conf-preview-video')).find(v => v.dataset.confId === confId);
  const btn   = Array.from(document.querySelectorAll('.btn-preview-mute')).find(b => b.dataset.confId === confId);
  if (!video) return;
  video.muted = !video.muted;
  if (btn) btn.textContent = video.muted ? '🔇' : '🔊';
}

// ── Participant action handlers ─────────────────────────────

async function handleMuteParticipant(participantId, isMuted) {
  try {
    if (isMuted) {
      await api.unmuteParticipant(participantId);
    } else {
      await api.muteParticipant(participantId);
    }
    await refresh();
  } catch (err) {
    console.error('[VMS] mute participant error:', err);
  }
}

function handleDisconnectParticipant(confId, participantId) {
  const p = state.participants.find(pt => pt.id === participantId);
  const name = p?.display_name || p?.participant_alias || 'this participant';
  if (!window.confirm(`Disconnect "${name}" from the meeting?`)) return;
  preview.controlDisconnectParticipant(confId, participantId);
}

function handleSetGuestsCanPresent(confName) {
  const current = preview.getGuestsCanPresent(confName);
  if (current === null) return;
  preview.controlSetGuestsCanPresent(confName, !current);
}

async function handleMuteGuests(confName, guestsMuted) {
  try {
    if (guestsMuted) {
      await api.unmuteGuests(confName);
    } else {
      await api.muteGuests(confName);
    }
    await refresh();
  } catch (err) {
    console.error('[VMS] mute guests error:', err);
  }
}

// ── Layout handler ──────────────────────────────────────────

function handleTransformLayout(confName, layout) {
  if (!layout) return;
  preview.controlTransformLayout(confName, { layout });
}

// ── Client REST API token + layouts ────────────────────────

async function ensureClientToken(confParts, confName) {
  const alias = extractConfAliasShort(confParts, confName);
  if (state.confTokens.has(alias)) return state.confTokens.get(alias);

  const nodeHost = resolveNodeHostname(confParts);
  if (!nodeHost) return null;

  try {
    const data = await clientApi.requestToken(nodeHost, alias);
    const token = data.token || data.result?.token;
    const layouts = [];

    if (token) {
      try {
        const layoutData = await clientApi.getAvailableLayouts(nodeHost, alias, token);
        if (Array.isArray(layoutData)) layouts.push(...layoutData);
        else if (Array.isArray(layoutData?.layouts)) layouts.push(...layoutData.layouts);
      } catch (_) {}
    }

    const entry = { token, nodeHost, alias, layouts };
    state.confTokens.set(alias, entry);
    return entry;
  } catch (err) {
    console.warn('[VMS] ensureClientToken failed:', err.message);
    return null;
  }
}

// ── Banner & Timer ──────────────────────────────────────────

function toggleBanner(confId) {
  const panel = state.bannerPanels.get(confId) || { open: false, message: '', clock: null };
  panel.open = !panel.open;
  state.bannerPanels.set(confId, panel);
  // Ensure the card is expanded so renderBannerPanel is called
  state.expandedConferences.add(confId);
  renderConferences();
}

function handleSetBanner(confId) {
  const input = document.getElementById(`banner-input-${CSS.escape(confId)}`);
  const message = input?.value ?? '';
  preview.controlSetMessageText(confId, message);
  const panel = state.bannerPanels.get(confId);
  if (panel) { panel.message = message; state.bannerPanels.set(confId, panel); renderConferences(); }
}

function handleClearBanner(confId) {
  preview.controlSetMessageText(confId, '');
  const panel = state.bannerPanels.get(confId);
  if (panel) { panel.message = ''; state.bannerPanels.set(confId, panel); renderConferences(); }
}

function handleBannerPin(confId, pin) {
  preview.submitControlPin(confId, pin);
}

function handleSetClock(confId) {
  const typeEl  = document.getElementById(`timer-type-${CSS.escape(confId)}`);
  const durEl   = document.getElementById(`timer-dur-${CSS.escape(confId)}`);
  const type    = typeEl?.value || 'remaining';  // "remaining"|"elapsed"|"time"
  const minutes = parseFloat(durEl?.value || 0);
  const seconds = Math.round(minutes * 60);

  const clockValues = { type };
  if (type === 'remaining' && seconds > 0) clockValues.starting_value = seconds;

  preview.controlSetClock(confId, clockValues);

  const panel = state.bannerPanels.get(confId);
  if (panel) {
    panel.clock = { type, duration: seconds };
    state.bannerPanels.set(confId, panel);
    renderConferences();
  }
}

function handleClearClock(confId) {
  preview.controlSetClock(confId, {});
  const panel = state.bannerPanels.get(confId);
  if (panel) { panel.clock = null; state.bannerPanels.set(confId, panel); renderConferences(); }
}

function renderBannerPanel(confId) {
  const panel = state.bannerPanels.get(confId);
  if (!panel?.open) return '';

  const alias       = escAttr(extractConfAliasShort(
    state.participants.filter(p => p.conference === confId), confId
  ));
  const safeId      = escAttr(confId);
  const ctrlStatus  = preview.getControlStatus(confId);
  const isConnected = ctrlStatus === 'connected';
  const isPinNeeded = ctrlStatus === 'pin-required';
  const currentMsg  = panel.message ? `"${escHtml(panel.message)}"` : '<em>None</em>';
  const clockSummary = panel.clock?.type && panel.clock.type !== 'none'
    ? `${panel.clock.type}${panel.clock.duration ? ` — ${Math.round(panel.clock.duration / 60)} min` : ''}`
    : '<em>None</em>';

  const statusRow = !isConnected
    ? `<div class="banner-status">${isPinNeeded ? 'Waiting for host PIN…' : 'Connecting to conference…'}</div>`
    : '';

  const disabledAttr = isConnected ? '' : ' disabled';

  return `
    <div class="banner-panel">
      ${statusRow}
      <div class="banner-section">
        <div class="banner-section-title">Message Banner</div>
        <div class="banner-current">Current: ${currentMsg}</div>
        <div class="banner-controls">
          <input class="banner-input" id="banner-input-${safeId}" type="text"
                 placeholder="Enter banner message…"
                 value="${escAttr(panel.message)}"
                 onkeydown="if(event.key==='Enter') handleSetBanner('${safeId}')">
          <button class="btn-banner-action"${disabledAttr}
                  onclick="handleSetBanner('${safeId}')">Set</button>
          <button class="btn-banner-clear"${disabledAttr}
                  onclick="handleClearBanner('${safeId}')">Clear</button>
        </div>
      </div>
      <div class="timer-section">
        <div class="banner-section-title">Countdown Timer</div>
        <div class="banner-current">Current: ${clockSummary}</div>
        <div class="banner-controls">
          <select class="timer-type-select" id="timer-type-${safeId}"${disabledAttr}>
            <option value="remaining">Countdown</option>
            <option value="elapsed">Elapsed</option>
            <option value="time">Current Time</option>
          </select>
          <input class="timer-duration-input" id="timer-dur-${safeId}"
                 type="number" min="1" max="999" step="1"
                 placeholder="min" title="Duration in minutes (Countdown only)"${disabledAttr}>
          <button class="btn-banner-action"${disabledAttr}
                  onclick="handleSetClock('${safeId}')">Start</button>
          <button class="btn-banner-clear"${disabledAttr}
                  onclick="handleClearClock('${safeId}')">Clear</button>
        </div>
      </div>
    </div>`;
}

function openSettings() {
  populateSettingsForm();
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('setting-url').focus();
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

function showFormError(msg) {
  const el = document.getElementById('form-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideFormError() {
  document.getElementById('form-error').classList.add('hidden');
}

// ── Formatters ─────────────────────────────────────────────

function formatDuration(startTime) {
  if (!startTime) return '—';
  const diff = Math.floor((Date.now() - new Date(startTime)) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatBandwidth(kbps) {
  if (kbps == null || kbps === 0) return '—';
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)}M` : `${kbps}k`;
}

function formatServiceType(type) {
  return { conference: 'VMR', lecture: 'Auditorium', two_stage_dialing: 'Reception',
           test_call: 'Test Call', media_playback: 'Media', gateway: 'Gateway' }[type] || (type || 'Unknown');
}

function renderQuality(q) {
  const map = {
    '1_good':    { label: 'Good',    cls: 'q-good' },
    '2_ok':      { label: 'OK',      cls: 'q-ok' },
    '3_bad':     { label: 'Bad',     cls: 'q-bad' },
    '4_terrible':{ label: 'Terrible',cls: 'q-terrible' },
  };
  const r = map[q];
  return r
    ? `<span class="quality ${r.cls}"><span class="q-dot"></span>${r.label}</span>`
    : '<span class="quality q-unknown">—</span>';
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
}

function escAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;');
}

// ── Event Listeners ────────────────────────────────────────

document.getElementById('settings-btn').addEventListener('click', openSettings);
document.getElementById('refresh-btn').addEventListener('click', refresh);
document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
document.getElementById('modal-close-btn').addEventListener('click', closeSettings);
document.getElementById('modal-backdrop').addEventListener('click', closeSettings);
document.getElementById('conference-search').addEventListener('input', e => {
  state.searchQuery = e.target.value;
  renderConferences();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSettings();
});

// ── Init ───────────────────────────────────────────────────
loadSettings();
if (state.settings) refresh();
