// Pexip Client REST API — token management, available layouts, banner message, timer

class PexipClientAPI {
  constructor() {
    this._tokens = new Map();   // alias → { token, nodeHost }
  }

  _baseUrl(nodeHost) {
    return `https://${nodeHost}/api/client/v2`;
  }

  _action(nodeHost, alias, action, body = {}) {
    const cached = this._tokens.get(alias);
    const token  = cached?.token || '';
    return fetch(
      `${this._baseUrl(nodeHost)}/conferences/${encodeURIComponent(alias)}/${action}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify(body),
      }
    ).then(r => {
      if (!r.ok) throw new Error(`${action} HTTP ${r.status}`);
      return r.json();
    });
  }

  // ── Token management ──────────────────────────────────────

  async requestToken(nodeHost, alias) {
    const res = await fetch(
      `${this._baseUrl(nodeHost)}/conferences/${encodeURIComponent(alias)}/request_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: 'VMS Monitor', call_type: 'api' }),
      }
    );
    if (!res.ok) throw new Error(`request_token HTTP ${res.status}`);
    const data = await res.json();
    const token = data.token || data.result?.token;
    if (!token) throw new Error('request_token: no token in response');
    this._tokens.set(alias, { token, nodeHost });
    return data;
  }

  async releaseToken(alias) {
    const cached = this._tokens.get(alias);
    if (!cached) return;
    this._tokens.delete(alias);
    try {
      await fetch(
        `${this._baseUrl(cached.nodeHost)}/conferences/${encodeURIComponent(alias)}/release_token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token: cached.token },
        }
      );
    } catch (_) {}
  }

  getCachedToken(alias) {
    return this._tokens.get(alias) || null;
  }

  // ── Available layouts ──────────────────────────────────────

  async getAvailableLayouts(nodeHost, alias, token) {
    const res = await fetch(
      `${this._baseUrl(nodeHost)}/conferences/${encodeURIComponent(alias)}/available_layouts`,
      { headers: { token } }
    );
    if (!res.ok) throw new Error(`available_layouts HTTP ${res.status}`);
    const data = await res.json();
    return data.result || data;
  }

  // ── Banner message ────────────────────────────────────────

  async setMessageText(nodeHost, alias, token, message) {
    return this._action(nodeHost, alias, 'set_message_text', { message });
  }

  async getMessageText(nodeHost, alias, token) {
    return this._action(nodeHost, alias, 'get_message_text', {});
  }

  // ── Timer / clock ─────────────────────────────────────────

  // type: 'countdown' | 'elapsed' | 'none'
  // duration: seconds (only used for countdown)
  async setClock(nodeHost, alias, token, type, duration) {
    const body = { type };
    if (type === 'countdown' && duration > 0) body.duration = duration;
    return this._action(nodeHost, alias, 'set_clock', body);
  }

  async getClock(nodeHost, alias, token) {
    return this._action(nodeHost, alias, 'get_clock', {});
  }
}

const clientApi = new PexipClientAPI();
