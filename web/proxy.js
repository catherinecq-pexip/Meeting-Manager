#!/usr/bin/env node
// Pexip + Cisco CORS Proxy
// Usage: node proxy.js https://your-pexip-manager.com [port]

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { URL } = require('url');

const DEVICES_FILE = path.join(__dirname, 'devices.json');

const TARGET = process.argv[2];
const PORT   = parseInt(process.argv[3] || '8080', 10);

if (!TARGET) {
  console.error('\nUsage: node proxy.js https://your-pexip-manager.com [port]\n');
  process.exit(1);
}

const targetUrl = new URL(TARGET);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  };
}

// ── Cisco dial handler ─────────────────────────────────────

function handleCiscoDial(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let data;
    try { data = JSON.parse(body); }
    catch (_) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }));
      return;
    }

    const { host, username, password, sipAddress, callType, displayName, callRate } = data;

    if (!host || !username || !password || !sipAddress) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ success: false, error: 'host, username, password, and sipAddress are required' }));
      return;
    }

    const xml = makeCiscoDialXML({ sipAddress, callType, displayName, callRate });
    const xmlBytes = Buffer.from(xml, 'utf8');

    let normalizedHost = host.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(normalizedHost)) normalizedHost = 'https://' + normalizedHost;

    let endpointUrl;
    try { endpointUrl = new URL(normalizedHost); }
    catch (_) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ success: false, error: `Invalid endpoint URL: ${normalizedHost}` }));
      return;
    }

    const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

    const options = {
      hostname: endpointUrl.hostname,
      port:     endpointUrl.port || (endpointUrl.protocol === 'https:' ? 443 : 80),
      path:     '/putxml',
      method:   'POST',
      headers: {
        'Content-Type':   'text/xml; charset=utf-8',
        'Accept':         'text/xml',
        'Authorization':  authHeader,
        'Content-Length': xmlBytes.length,
      },
      rejectUnauthorized: false,
    };

    const protocol = endpointUrl.protocol === 'https:' ? https : http;

    const ciscoReq = protocol.request(options, ciscoRes => {
      let responseBody = '';
      ciscoRes.on('data', chunk => responseBody += chunk);
      ciscoRes.on('end', () => {
        const success = ciscoRes.statusCode >= 200 && ciscoRes.statusCode < 300;
        console.log(`[cisco] ${host} → HTTP ${ciscoRes.statusCode} (${sipAddress})`);
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify({ success, statusCode: ciscoRes.statusCode, body: responseBody }));
      });
    });

    ciscoReq.on('error', err => {
      console.error(`[cisco error] ${host}: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });

    ciscoReq.write(xmlBytes);
    ciscoReq.end();
  });
}

function makeCiscoDialXML({ sipAddress, callType = 'Video', displayName = '', callRate = '' }) {
  const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  const fields = [
    `<Number>${esc(sipAddress)}</Number>`,
    `<Protocol>Sip</Protocol>`,
    `<CallType>${esc(callType)}</CallType>`,
  ];
  if (displayName.trim()) fields.push(`<DisplayName>${esc(displayName.trim())}</DisplayName>`);
  if (callRate.trim())    fields.push(`<CallRate>${esc(callRate.trim())}</CallRate>`);

  return `<Command>\n  <Dial>\n    ${fields.join('\n    ')}\n  </Dial>\n</Command>`;
}

// ── Cisco disconnect handler ───────────────────────────────

function handleCiscoDisconnect(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let data;
    try { data = JSON.parse(body); }
    catch (_) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }));
      return;
    }

    const { host, username, password } = data;

    if (!host || !username || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ success: false, error: 'host, username, and password are required' }));
      return;
    }

    const xml = '<Command>\n  <Call>\n    <Disconnect/>\n  </Call>\n</Command>';
    const xmlBytes = Buffer.from(xml, 'utf8');

    let normalizedHost = host.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(normalizedHost)) normalizedHost = 'https://' + normalizedHost;

    let endpointUrl;
    try { endpointUrl = new URL(normalizedHost); }
    catch (_) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ success: false, error: `Invalid endpoint URL: ${normalizedHost}` }));
      return;
    }

    const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

    const options = {
      hostname: endpointUrl.hostname,
      port:     endpointUrl.port || (endpointUrl.protocol === 'https:' ? 443 : 80),
      path:     '/putxml',
      method:   'POST',
      headers: {
        'Content-Type':   'text/xml; charset=utf-8',
        'Accept':         'text/xml',
        'Authorization':  authHeader,
        'Content-Length': xmlBytes.length,
      },
      rejectUnauthorized: false,
    };

    const protocol = endpointUrl.protocol === 'https:' ? https : http;

    const ciscoReq = protocol.request(options, ciscoRes => {
      let responseBody = '';
      ciscoRes.on('data', chunk => responseBody += chunk);
      ciscoRes.on('end', () => {
        const success = ciscoRes.statusCode >= 200 && ciscoRes.statusCode < 300;
        console.log(`[cisco] ${host} → disconnect HTTP ${ciscoRes.statusCode}`);
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify({ success, statusCode: ciscoRes.statusCode, body: responseBody }));
      });
    });

    ciscoReq.on('error', err => {
      console.error(`[cisco error] ${host}: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });

    ciscoReq.write(xmlBytes);
    ciscoReq.end();
  });
}

// ── Device persistence ─────────────────────────────────────

function handleGetDevices(req, res) {
  try {
    const data = fs.existsSync(DEVICES_FILE) ? fs.readFileSync(DEVICES_FILE, 'utf8') : '[]';
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders() });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function handleSaveDevices(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      JSON.parse(body); // validate before writing
      fs.writeFileSync(DEVICES_FILE, body, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// ── Main server ────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // Cisco dial route
  if (req.method === 'POST' && req.url === '/api/cisco/dial') {
    handleCiscoDial(req, res);
    return;
  }

  // Cisco disconnect route
  if (req.method === 'POST' && req.url === '/api/cisco/disconnect') {
    handleCiscoDisconnect(req, res);
    return;
  }

  // Device list persistence
  if (req.method === 'GET'  && req.url === '/api/devices') { handleGetDevices(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/devices') { handleSaveDevices(req, res); return; }

  // Expose real Pexip target URL for PexRTC node resolution
  if (req.method === 'GET' && req.url === '/api/target') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
    res.end(JSON.stringify({ url: TARGET }));
    return;
  }

  // Pexip pass-through
  const options = {
    hostname: targetUrl.hostname,
    port:     targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path:     req.url,
    method:   req.method,
    headers:  { ...req.headers, host: targetUrl.host },
    rejectUnauthorized: false,
  };

  const protocol = targetUrl.protocol === 'https:' ? https : http;

  const proxyReq = protocol.request(options, proxyRes => {
    res.writeHead(proxyRes.statusCode, { ...proxyRes.headers, ...corsHeaders() });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    console.error('[pexip error]', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json', ...corsHeaders() });
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n✓ VMS Proxy running\n');
  console.log(`  Pexip target  →  ${TARGET}`);
  console.log(`  Listening     →  http://localhost:${PORT}`);
  console.log(`  Cisco dial    →  POST http://localhost:${PORT}/api/cisco/dial`);
  console.log('\nPress Ctrl+C to stop.\n');
});
