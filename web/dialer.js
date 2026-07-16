// VMS — SIP Dialer panel (Cisco endpoint management + dial)

const DEVICES_KEY = 'vms_cisco_devices_v1';

const dialerState = {
  devices:     [],          // [{id, name, host, username, password}]
  sipAddress:  '',
  editingId:   null,        // device id being edited, or 'new'
  dialStatus:  {},          // {deviceId: {state:'idle'|'dialing'|'ok'|'error', message}}
  selectedIds: new Set(),   // device ids checked for bulk dial
};

// ── Persistence ────────────────────────────────────────────

async function loadDevices() {
  try {
    const proxyBase = getProxyBase();
    if (proxyBase) {
      const res = await fetch(`${proxyBase}/api/devices`);
      if (res.ok) {
        dialerState.devices = await res.json();
        renderDialer();
        return;
      }
    }
  } catch (_) {}
  // Fallback: localStorage (or migrate existing data)
  try {
    const raw = localStorage.getItem(DEVICES_KEY);
    if (raw) {
      dialerState.devices = JSON.parse(raw);
      saveDevices(); // migrate to file
    }
  } catch (_) {}
  renderDialer();
}

async function saveDevices() {
  try {
    const proxyBase = getProxyBase();
    if (proxyBase) {
      await fetch(`${proxyBase}/api/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dialerState.devices),
      });
      return;
    }
  } catch (_) {}
  // Fallback: localStorage
  localStorage.setItem(DEVICES_KEY, JSON.stringify(dialerState.devices));
}

// ── Device CRUD ────────────────────────────────────────────

function startAddDevice() {
  dialerState.editingId = 'new';
  renderDialer();
  document.getElementById('device-edit-name')?.focus();
}

function startEditDevice(id) {
  dialerState.editingId = id;
  renderDialer();
  document.getElementById('device-edit-name')?.focus();
}

function cancelEdit() {
  dialerState.editingId = null;
  renderDialer();
}

function saveDevice() {
  const name     = document.getElementById('device-edit-name').value.trim();
  const host     = document.getElementById('device-edit-host').value.trim();
  const username = document.getElementById('device-edit-username').value.trim();
  const password = document.getElementById('device-edit-password').value;

  if (!name || !host || !username || !password) {
    document.getElementById('device-edit-error').textContent = 'All fields are required.';
    document.getElementById('device-edit-error').classList.remove('hidden');
    return;
  }

  if (dialerState.editingId === 'new') {
    dialerState.devices.push({ id: String(Date.now()), name, host, username, password });
  } else {
    const idx = dialerState.devices.findIndex(d => d.id === dialerState.editingId);
    if (idx !== -1) dialerState.devices[idx] = { ...dialerState.devices[idx], name, host, username, password };
  }

  saveDevices();
  dialerState.editingId = null;
  renderDialer();
}

function deleteDevice(id) {
  if (!confirm('Remove this device?')) return;
  dialerState.devices = dialerState.devices.filter(d => d.id !== id);
  delete dialerState.dialStatus[id];
  dialerState.selectedIds.delete(id);
  saveDevices();
  dialerState.editingId = null;
  renderDialer();
}

// ── Selection ──────────────────────────────────────────────

function toggleSelectDevice(id) {
  if (dialerState.selectedIds.has(id)) {
    dialerState.selectedIds.delete(id);
  } else {
    dialerState.selectedIds.add(id);
  }
  refreshDevicesSection();
}

function toggleSelectAll() {
  const allSelected = dialerState.devices.every(d => dialerState.selectedIds.has(d.id));
  if (allSelected) {
    dialerState.selectedIds.clear();
  } else {
    dialerState.devices.forEach(d => dialerState.selectedIds.add(d.id));
  }
  refreshDevicesSection();
}

// ── Disconnect ─────────────────────────────────────────────

async function disconnectDevice(deviceId) {
  const device = dialerState.devices.find(d => d.id === deviceId);
  if (!device) return;

  const proxyBase = getProxyBase();
  if (!proxyBase) {
    setDialStatus(deviceId, 'error', 'Configure Pexip manager URL first (proxy required).');
    return;
  }

  setDialStatus(deviceId, 'disconnecting', 'Disconnecting…');

  try {
    const response = await fetch(`${proxyBase}/api/cisco/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: device.host, username: device.username, password: device.password }),
    });

    const result = await response.json();

    if (result.success) {
      setDialStatus(deviceId, 'disconnected', 'Disconnected');
      setTimeout(() => {
        if (dialerState.dialStatus[deviceId]?.state === 'disconnected') {
          setDialStatus(deviceId, 'idle', '');
        }
      }, 4000);
    } else {
      setDialStatus(deviceId, 'error', result.error || `HTTP ${result.statusCode}`);
    }
  } catch (err) {
    setDialStatus(deviceId, 'error', err.message);
  }
}

async function disconnectSelected() {
  const ids = dialerState.devices.map(d => d.id).filter(id => dialerState.selectedIds.has(id));
  if (!ids.length) return;
  await Promise.all(ids.map(id => disconnectDevice(id)));
}

async function disconnectAll() {
  if (!dialerState.devices.length) return;
  await Promise.all(dialerState.devices.map(d => disconnectDevice(d.id)));
}

// ── Dial ───────────────────────────────────────────────────

async function dialSelected() {
  const sip = dialerState.sipAddress.trim();
  if (!sip) {
    const input = document.getElementById('sip-address-input');
    if (input) {
      input.focus();
      input.classList.add('input-shake');
      setTimeout(() => input.classList.remove('input-shake'), 500);
    }
    return;
  }
  const ids = dialerState.devices
    .map(d => d.id)
    .filter(id => dialerState.selectedIds.has(id));
  if (!ids.length) return;
  await Promise.all(ids.map(id => dialDevice(id)));
}

async function dialDevice(deviceId) {
  const sip = dialerState.sipAddress.trim();
  if (!sip) {
    document.getElementById('sip-address-input').focus();
    document.getElementById('sip-address-input').classList.add('input-shake');
    setTimeout(() => document.getElementById('sip-address-input')?.classList.remove('input-shake'), 500);
    return;
  }

  const device = dialerState.devices.find(d => d.id === deviceId);
  if (!device) return;

  const proxyBase = getProxyBase();
  if (!proxyBase) {
    setDialStatus(deviceId, 'error', 'Configure Pexip manager URL first (proxy required).');
    return;
  }

  setDialStatus(deviceId, 'dialing', 'Dialing…');

  try {
    const response = await fetch(`${proxyBase}/api/cisco/dial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host:       device.host,
        username:   device.username,
        password:   device.password,
        sipAddress: sip,
        callType:   'Video',
      }),
    });

    const result = await response.json();

    if (result.success) {
      setDialStatus(deviceId, 'ok', `Connected — HTTP ${result.statusCode}`);
    } else {
      setDialStatus(deviceId, 'error', result.error || `HTTP ${result.statusCode}`);
    }
  } catch (err) {
    setDialStatus(deviceId, 'error', err.message);
  }

  // Auto-clear success after 8 seconds
  setTimeout(() => {
    if (dialerState.dialStatus[deviceId]?.state === 'ok') {
      setDialStatus(deviceId, 'idle', '');
    }
  }, 8000);
}

function setDialStatus(deviceId, state, message) {
  dialerState.dialStatus[deviceId] = { state, message };
  refreshDevicesSection();
}

function getProxyBase() {
  if (!state.settings?.url) return null;
  let url = state.settings.url.trim().replace(/\/$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
  return url || null;
}

// ── Rendering ─────────────────────────────────────────────

function renderDialer() {
  const panel = document.getElementById('dialer-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="dialer-header">
      <span class="dialer-title">SIP Dialer</span>
      <button class="btn-disconnect-all" onclick="disconnectAll()" title="Disconnect all devices">■ Disc All</button>
    </div>

    <div class="sip-input-wrap">
      <label class="sip-label">SIP Address</label>
      <input
        id="sip-address-input"
        class="sip-input"
        type="text"
        placeholder="user@conference.example.com"
        value="${escHtml(dialerState.sipAddress)}"
        oninput="dialerState.sipAddress = this.value"
        autocomplete="off"
        spellcheck="false"
      >
    </div>

    <div id="devices-section">${renderDevicesSectionHTML()}</div>
  `;
}

function refreshDevicesSection() {
  const el = document.getElementById('devices-section');
  if (el) el.innerHTML = renderDevicesSectionHTML();
}

function renderDevicesSectionHTML() {
  const total = dialerState.devices.length;
  const selectedCount = dialerState.devices.filter(d => dialerState.selectedIds.has(d.id)).length;
  const allSelected = total > 0 && selectedCount === total;

  return `
    <div class="devices-header">
      ${total > 0 ? `
        <label class="devices-select-all" title="${allSelected ? 'Deselect all' : 'Select all'}">
          <input type="checkbox" ${allSelected ? 'checked' : ''} onchange="toggleSelectAll()">
        </label>
      ` : ''}
      <span class="devices-label">Video Devices</span>
      <div class="devices-header-actions">
        ${selectedCount > 0 ? `
          <button class="btn-dial-selected" onclick="dialSelected()" title="Dial all selected devices simultaneously">Dial&nbsp;${selectedCount}</button>
          <button class="btn-disc-selected" onclick="disconnectSelected()" title="Disconnect all selected devices">■&nbsp;${selectedCount}</button>
        ` : ''}
        <button class="btn-add-device" onclick="startAddDevice()" title="Add device">+ Add</button>
      </div>
    </div>
    ${renderEditForm()}
    <div id="device-list">${renderDeviceListHTML()}</div>
  `;
}

function renderDeviceListHTML() {
  if (dialerState.devices.length === 0) {
    return `<div class="devices-empty">No devices yet.<br>Click <strong>+ Add</strong> to add a video endpoint.</div>`;
  }

  return dialerState.devices.map(device => {
    const status = dialerState.dialStatus[device.id] || { state: 'idle', message: '' };
    const isDialing       = status.state === 'dialing';
    const isDisconnecting = status.state === 'disconnecting';
    const isSelected = dialerState.selectedIds.has(device.id);

    return `
      <div class="device-row${isSelected ? ' selected' : ''}">
        <label class="device-checkbox-wrap" title="Select for bulk dial">
          <input type="checkbox" class="device-checkbox" ${isSelected ? 'checked' : ''}
            onchange="toggleSelectDevice('${escAttr(device.id)}')">
        </label>
        <div class="device-info">
          <div class="device-name">${escHtml(device.name)}</div>
          <div class="device-host">${escHtml(device.host)}</div>
          ${status.state !== 'idle'
            ? `<div class="device-status ds-${status.state}">${escHtml(status.message)}</div>`
            : ''}
        </div>
        <div class="device-actions">
          <button
            class="btn-dial ${isDialing ? 'dialing' : ''}"
            onclick="dialDevice('${escAttr(device.id)}')"
            ${isDialing ? 'disabled' : ''}
            title="Dial ${escAttr(device.name)}"
          >${isDialing ? '…' : '▶ Dial'}</button>
          <button
            class="btn-disconnect-device ${isDisconnecting ? 'disconnecting' : ''}"
            onclick="disconnectDevice('${escAttr(device.id)}')"
            ${isDisconnecting ? 'disabled' : ''}
            title="Disconnect ${escAttr(device.name)}"
          >${isDisconnecting ? '…' : '■'}</button>
          <button class="btn-edit-device" onclick="startEditDevice('${escAttr(device.id)}')" title="Edit">✎</button>
        </div>
      </div>`;
  }).join('');
}

function renderEditForm() {
  if (!dialerState.editingId) return '';

  const isNew = dialerState.editingId === 'new';
  const device = isNew ? { name: '', host: '', username: 'admin', password: '' }
    : dialerState.devices.find(d => d.id === dialerState.editingId) || {};

  return `
    <div class="device-edit-form">
      <div class="edit-form-title">${isNew ? 'Add Device' : 'Edit Device'}</div>
      <div id="device-edit-error" class="device-edit-error hidden"></div>
      <div class="edit-field">
        <label>Name</label>
        <input id="device-edit-name" type="text" placeholder="Boardroom" value="${escHtml(device.name || '')}" autocomplete="off">
      </div>
      <div class="edit-field">
        <label>Host / IP</label>
        <input id="device-edit-host" type="text" placeholder="10.0.0.50 or room.example.com" value="${escHtml(device.host || '')}" autocomplete="off" spellcheck="false">
      </div>
      <div class="edit-field">
        <label>Username</label>
        <input id="device-edit-username" type="text" placeholder="admin" value="${escHtml(device.username || 'admin')}" autocomplete="off">
      </div>
      <div class="edit-field">
        <label>Password</label>
        <input id="device-edit-password" type="password" value="${escHtml(device.password || '')}" autocomplete="off">
      </div>
      <div class="edit-actions">
        <button class="btn-save-device" onclick="saveDevice()">Save</button>
        ${!isNew ? `<button class="btn-delete-device" onclick="deleteDevice('${escAttr(device.id)}')">Remove</button>` : ''}
        <button class="btn-cancel-edit" onclick="cancelEdit()">Cancel</button>
      </div>
    </div>`;
}

// Init
loadDevices();
