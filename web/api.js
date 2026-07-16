// Pexip Management API Client — Status API (read-only, polling)

class PexipAPI {
  constructor() {
    this.baseUrl = '';
    this.authHeader = '';
  }

  configure(managerUrl, username, password) {
    this.baseUrl = managerUrl.replace(/\/$/, '');
    this.authHeader = 'Basic ' + btoa(username + ':' + password);
  }

  async _get(path, params = {}) {
    const url = new URL(this.baseUrl + path);
    url.searchParams.set('limit', '500');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const msg = response.status === 401
        ? 'Authentication failed — check your username and password'
        : `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(msg);
    }

    return response.json();
  }

  getConferences()              { return this._get('/api/admin/status/v1/conference/'); }
  getParticipants()             { return this._get('/api/admin/status/v1/participant/'); }
  getNodes()                    { return this._get('/api/admin/status/v1/worker_vm/'); }
  getAlarms()                   { return this._get('/api/admin/status/v1/alarm/'); }
  getNodeStats(nodeId)          { return this._get(`/api/admin/status/v1/worker_vm/${nodeId}/statistics/`); }
  getMediaStreams(participantId) { return this._get(`/api/admin/status/v1/participant/${participantId}/media_stream/`); }

  _command(path, body) {
    return fetch(this.baseUrl + '/api/admin/command/v1/' + path, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    }).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    });
  }

  disconnectParticipant(participantId) {
    return this._command('participant/disconnect/', { participant_id: participantId });
  }

  muteParticipant(participantId) {
    return this._command('participant/mute/', { participant_id: participantId });
  }

  unmuteParticipant(participantId) {
    return this._command('participant/unmute/', { participant_id: participantId });
  }

  muteGuests(conferenceName) {
    return this._command('conference/muteguests/', { conference_name: conferenceName });
  }

  unmuteGuests(conferenceName) {
    return this._command('conference/unmuteguests/', { conference_name: conferenceName });
  }

  transformLayout(conferenceName, layout) {
    return this._command('conference/transform_layout/', { conference_name: conferenceName, layout });
  }
}

const api = new PexipAPI();
