// Conference Live Preview — PexRTC WebRTC integration

const preview = (() => {
  // confId → { rtc, stream, mainStream, status, statusCls, awaitingPin, nodeHostname, conf }
  const previewMap = new Map();
  // confId → { rtc, status: 'connecting'|'pin-required'|'connected' }
  const controlMap = new Map();

  // ── PexRTC loading ─────────────────────────────────────────

  let pexrtcNode = null;
  let pexrtcPromise = null;

  function loadPexRTC(nodeHostname) {
    // Return cached promise if same node and already loading/loaded
    if (pexrtcPromise && pexrtcNode === nodeHostname) return pexrtcPromise;

    // Different node — remove old script so PexRTC reinitialises for new node
    const old = document.getElementById('pexrtc-script');
    if (old) old.remove();
    if (typeof PexRTC !== 'undefined') {
      // PexRTC is already global from a previous load — reuse it
      pexrtcNode = nodeHostname;
      pexrtcPromise = Promise.resolve();
      return pexrtcPromise;
    }

    pexrtcNode = nodeHostname;
    pexrtcPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.id = 'pexrtc-script';
      s.src = `https://${nodeHostname}/static/webrtc/js/pexrtc.js`;
      s.onload = resolve;
      s.onerror = () => {
        pexrtcNode = null;
        pexrtcPromise = null;
        reject(new Error(
          `Cannot load PexRTC from ${nodeHostname}. ` +
          `If this node uses a self-signed certificate, open https://${nodeHostname} in a new tab, accept the certificate warning, then retry.`
        ));
      };
      document.head.appendChild(s);
    });
    return pexrtcPromise;
  }

  // ── State helpers ──────────────────────────────────────────

  function isActive(confId)      { return previewMap.has(confId); }
  function isAwaitingPin(confId) { return previewMap.get(confId)?.awaitingPin || false; }

  function getStatus(confId) {
    const info = previewMap.get(confId);
    return info ? { text: info.status, cls: info.statusCls } : { text: '', cls: '' };
  }

  function updateStatus(confId, text, cls) {
    const info = previewMap.get(confId);
    if (!info) return;
    info.status = text;
    info.statusCls = cls;
    notifyRender();
  }

  function notifyRender() {
    if (typeof renderConferences === 'function') renderConferences();
  }

  // ── Public API ─────────────────────────────────────────────

  function startPreview(confId, conf, nodeHostname, confAlias) {
    if (previewMap.has(confId)) return;

    previewMap.set(confId, {
      rtc: null, stream: null, mainStream: null,
      status: 'Loading…', statusCls: 'ps-connecting',
      awaitingPin: false, nodeHostname, conf,
      confAlias: confAlias || conf.name,
    });

    // Caller renders immediately; subsequent status changes trigger re-renders
    loadPexRTC(nodeHostname)
      .then(() => _connect(confId))
      .catch(err => updateStatus(confId, err.message, 'ps-error'));
  }

  function _connect(confId) {
    const info = previewMap.get(confId);
    if (!info) return;

    updateStatus(confId, 'Connecting…', 'ps-connecting');
    const rtc = new PexRTC();
    info.rtc = rtc;

    rtc.onSetup = (_localStream, pinStatus) => {
      if (pinStatus === 'required') {
        info.awaitingPin = true;
        updateStatus(confId, 'PIN required', 'ps-pin');
      } else {
        rtc.connect('', undefined, undefined);
      }
    };

    rtc.onConnect = (stream) => {
      console.log('[VMS preview] onConnect', { confId, stream: !!stream,
        tracks: stream?.getTracks().map(t => `${t.kind}:${t.readyState}:muted=${t.muted}`) ?? [] });

      info.awaitingPin = false;

      if (!stream) {
        // Some PexRTC / Pexip versions call onConnect(null) in recvonly mode and
        // deliver the composite video via onPresentationConnected instead.
        // Stay in "connecting" state and let the presentation callback handle it.
        // If nothing arrives within 10 s, surface an error.
        updateStatus(confId, 'Connecting…', 'ps-connecting');
        info._streamTimeout = setTimeout(() => {
          if (!info.stream) updateStatus(confId, 'No video received — check browser console', 'ps-error');
        }, 10000);
        return;
      }

      clearTimeout(info._streamTimeout);
      info.stream = stream;
      info.mainStream = stream;
      _showStream(confId, stream);
    };

    rtc.onPresentation = (active) => {
      if (active) rtc.getPresentation();
    };

    rtc.onPresentationConnected = (stream) => {
      console.log('[VMS preview] onPresentationConnected', { confId, stream: !!stream,
        tracks: stream?.getTracks().map(t => `${t.kind}:${t.readyState}:muted=${t.muted}`) ?? [] });
      clearTimeout(info._streamTimeout);
      info.stream = stream;
      if (!info.mainStream) {
        // In recvonly mode the composite arrives here rather than onConnect —
        // treat it as the main stream so disconnect restores it correctly.
        info.mainStream = stream;
        _showStream(confId, stream);
      } else {
        attachStreams();
      }
    };

    rtc.onPresentationDisconnected = () => {
      if (info.mainStream) {
        info.stream = info.mainStream;
        attachStreams();
      }
    };

    rtc.onError = (err) => {
      updateStatus(confId,
        `Error: ${err} — if this persists, set a Preview Node hostname in Settings.`,
        'ps-error');
    };

    rtc.onDisconnect = (reason) => {
      info.rtc = null;
      const ended = !reason || reason === 'User initiated disconnect'
        || /conference ended|no participants|all guests|no more chairs/i.test(reason);
      if (ended) {
        stopPreview(confId);
      } else {
        updateStatus(confId, `Disconnected: ${reason}`, 'ps-error');
      }
    };

    console.log('[VMS preview] makeCall node=%s alias=%s', info.nodeHostname, info.confAlias);
    rtc.makeCall(info.nodeHostname, info.confAlias, 'VMS Monitor', 768, 'recvonly');
  }

  // Tear down the PexRTC script and clear the global so the next load
  // re-executes it from cache, giving clean internal state.
  function _resetPexRTC() {
    const old = document.getElementById('pexrtc-script');
    if (old) old.remove();
    if (typeof window.PexRTC !== 'undefined') window.PexRTC = undefined;
    pexrtcNode = null;
    pexrtcPromise = null;
  }

  function _showStream(confId, stream) {
    attachStreams();
    updateStatus(confId, 'Live', 'ps-live');
  }

  function stopPreview(confId) {
    const info = previewMap.get(confId);
    if (info) {
      clearTimeout(info._streamTimeout);
      if (info.rtc) try { info.rtc.disconnect(); } catch (_) {}
    }
    previewMap.delete(confId);
    // Reset PexRTC when all preview AND control connections are gone.
    if (previewMap.size === 0 && controlMap.size === 0) _resetPexRTC();
  }

  // ── Banner control connection (call_type: 'none', host role) ───

  function openControlRtc(confId, nodeHostname, confAlias) {
    if (controlMap.has(confId)) return;
    const info = { rtc: null, status: 'connecting', awaitingPin: false, guestsCanPresent: true };
    controlMap.set(confId, info);

    loadPexRTC(nodeHostname)
      .then(() => _connectControl(confId, nodeHostname, confAlias))
      .catch(() => controlMap.delete(confId));
  }

  function _connectControl(confId, nodeHostname, confAlias) {
    const info = controlMap.get(confId);
    if (!info) return;

    const rtc = new PexRTC();
    info.rtc = rtc;

    rtc.onSetup = (_stream, pinStatus) => {
      if (pinStatus === 'required' || pinStatus === 'optional') {
        info.status = 'pin-required';
        info.awaitingPin = true;
        if (typeof renderConferences === 'function') renderConferences(true);
      } else {
        rtc.connect('', null, null);
      }
    };

    rtc.onConnect = () => {
      info.status = 'connected';
      info.awaitingPin = false;
      if (typeof renderConferences === 'function') renderConferences(true);
    };

    rtc.onDisconnect = () => {
      controlMap.delete(confId);
      if (typeof renderConferences === 'function') renderConferences();
    };

    rtc.onError = () => {
      controlMap.delete(confId);
      if (typeof renderConferences === 'function') renderConferences();
    };

    rtc.onConferenceUpdate = (properties) => {
      if (typeof properties.guests_can_present === 'boolean') {
        info.guestsCanPresent = properties.guests_can_present;
        if (typeof renderConferences === 'function') renderConferences(true);
      }
    };

    rtc.makeCall(nodeHostname, confAlias, 'VMS Monitor', null, 'none');
  }

  function closeControlRtc(confId) {
    const info = controlMap.get(confId);
    if (info?.rtc) try { info.rtc.disconnect(); } catch (_) {}
    controlMap.delete(confId);
    if (previewMap.size === 0 && controlMap.size === 0) _resetPexRTC();
  }

  function submitControlPin(confId, pin) {
    const info = controlMap.get(confId);
    if (!info?.rtc) return;
    info.awaitingPin = false;
    info.status = 'connecting';
    info.rtc.connect(pin || '', null, null);
    if (typeof renderConferences === 'function') renderConferences();
  }

  function controlSetMessageText(confId, text) {
    const info = controlMap.get(confId);
    if (info?.rtc) info.rtc.setMessageText(text);
  }

  function controlSetClock(confId, clockValues) {
    const info = controlMap.get(confId);
    if (info?.rtc) info.rtc.setClock(clockValues);
  }

  function controlTransformLayout(confId, transforms) {
    const info = controlMap.get(confId);
    if (info?.rtc) info.rtc.transformLayout(transforms);
  }

  function controlDisconnectParticipant(confId, uuid) {
    const info = controlMap.get(confId);
    if (info?.rtc) info.rtc.disconnectParticipant(uuid);
  }

  function controlSetGuestsCanPresent(confId, setting) {
    const info = controlMap.get(confId);
    if (!info?.rtc) return;
    info.rtc.setGuestsCanPresent(setting);
    info.guestsCanPresent = setting;
    if (typeof renderConferences === 'function') renderConferences(true);
  }

  function getGuestsCanPresent(confId) {
    return controlMap.get(confId)?.guestsCanPresent ?? null;
  }

  function getControlStatus(confId) {
    return controlMap.get(confId)?.status || null;
  }

  function submitPin(confId, pin) {
    const info = previewMap.get(confId);
    if (!info?.rtc) return;
    info.awaitingPin = false;
    updateStatus(confId, 'Connecting…', 'ps-connecting');
    info.rtc.connect(pin || '', undefined, undefined);
  }

  function attachStreams() {
    document.querySelectorAll('.conf-preview-video[data-conf-id]').forEach(v => {
      const info = previewMap.get(v.dataset.confId);
      if (info?.stream && v.srcObject !== info.stream) {
        v.srcObject = info.stream;
        v.play().catch(err => console.warn('[VMS preview] play() failed:', err));
      }
    });
  }

  // Close PexRTC connections before the page unloads so Pexip doesn't keep
  // ghost participants, and so bfcache can't restore live preview state.
  window.addEventListener('pagehide', () => {
    for (const confId of [...previewMap.keys()]) stopPreview(confId);
    for (const confId of [...controlMap.keys()]) closeControlRtc(confId);
  });

  // If the browser restores this page from bfcache (back/forward or refresh),
  // previewMap and pexrtcNode/pexrtcPromise/PexRTC global are all restored but
  // stale. Reset everything so the next preview starts with a clean script.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      _resetPexRTC();
      for (const confId of [...previewMap.keys()]) stopPreview(confId);
      if (typeof renderConferences === 'function') renderConferences();
    }
  });

  return {
    isActive, isAwaitingPin, getStatus, startPreview, stopPreview, submitPin, attachStreams,
    openControlRtc, closeControlRtc, submitControlPin,
    controlSetMessageText, controlSetClock, controlTransformLayout,
    controlDisconnectParticipant, controlSetGuestsCanPresent, getGuestsCanPresent,
    getControlStatus,
  };
})();
