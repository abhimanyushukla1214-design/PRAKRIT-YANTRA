'use strict';

// LoopStream — 24/7 looping YouTube livestream backend.
// Zero-dependency Node HTTP server + real ffmpeg infinite-loop RTMP engine.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
const LOG_LIMIT = 500;
const RESTART_DELAY_MS = 5000;

const YOUTUBE_RTMP = 'rtmp://a.rtmp.youtube.com/live2';

const state = {
  status: 'idle', // idle | starting | live | error
  startedAt: 0,
  source: null, // { kind: 'file' | 'url', value: string }
  streamKey: null,
};

let child = null;
let stopRequested = false;
let restartTimer = null;
let logs = [];

const nowIso = () => new Date().toISOString();

function pushLog(level, msg) {
  logs.push({ t: nowIso(), level, msg });
  if (logs.length > LOG_LIMIT) logs.splice(0, logs.length - LOG_LIMIT);
}

function maskKey(k) {
  if (!k) return '—';
  const clean = String(k);
  if (clean.length <= 10) return '•'.repeat(clean.length);
  return clean.slice(0, 4) + '•'.repeat(Math.max(4, clean.length - 8)) + clean.slice(-4);
}

function ffmpegArgs(source, key) {
  const input = source.kind === 'url' ? [ '-i', source.value ] : [ '-i', source.value ];
  return [
    '-hide_banner',
    '-loglevel', 'info',
    '-re',
    '-stream_loop', '-1',
    ...input,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-b:v', '4500k',
    '-maxrate', '6000k',
    '-bufsize', '12000k',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'flv',
    `${YOUTUBE_RTMP}/${key}`,
  ];
}

function startStream(source, key) {
  stopRequested = false;
  state.status = 'starting';
  state.startedAt = Date.now();
  state.source = source;
  state.streamKey = key;
  pushLog('sys', `Loop start · source=${source.kind} ${source.value} · key=${maskKey(key)}`);

  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }

  let spawnedOk = false;
  child = spawn(FFMPEG_BIN, ffmpegArgs(source, key), { stdio: ['ignore', 'pipe', 'pipe'] });
  spawnedOk = true;

  child.stdout.on('data', (d) => handleFfmpegData(d.toString()));
  child.stderr.on('data', (d) => handleFfmpegData(d.toString()));

  function handleFfmpegData(chunk) {
    for (const line of chunk.split(/\r\n|\n|\r/)) {
      const l = line.trim();
      if (!l) continue;
      pushLog('out', l);
      if (!spawnedOk) spawnedOk = true;
      if (state.status === 'starting') state.status = 'live';
    }
  }

  child.on('error', (err) => {
    pushLog('err', `ffmpeg error: ${err.message}`);
    child = null;
    state.status = 'error';
  });

  child.on('exit', (code, signal) => {
    child = null;
    pushLog('sys', `ffmpeg exited · code=${code} signal=${signal || '-'}`);
    if (stopRequested) {
      state.status = 'idle';
      state.startedAt = 0;
      state.source = null;
      state.streamKey = null;
      return;
    }
    state.status = 'error';
    pushLog('err', `Stream engine crashed — restarting in ${RESTART_DELAY_MS / 1000}s`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (state.status === 'idle') return;
      startStream(state.source, state.streamKey);
    }, RESTART_DELAY_MS);
  });
}

function stopStream() {
  stopRequested = true;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  state.status = 'idle';
  state.startedAt = 0;
  state.source = null;
  state.streamKey = null;
  if (child) { try { child.kill('SIGTERM'); } catch (e) { /* ignore */ } }
}

function statusPayload() {
  const live = state.status === 'live' || state.status === 'starting';
  let message = 'LoopStream is idle. Configure a stream key and video source, then press Start loop.';
  if (state.status === 'starting') message = 'Starting ffmpeg loop…';
  if (state.status === 'live') message = 'Streaming loop to YouTube. Running 24/7.';
  if (state.status === 'error') message = 'Stream engine error — restarting…';
  return {
    status: state.status,
    message,
    uptimeSec: live && state.startedAt ? Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)) : 0,
    source: state.source,
    keyPreview: maskKey(state.streamKey),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new Error('Body too large')); req.destroy(); return; } data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (p === '/') p = '/index.html';
  const filePath = path.normalize(path.join(ROOT, p));
  if (!filePath.startsWith(ROOT)) { sendJson(res, 403, { error: 'Forbidden' }); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { sendJson(res, 404, { error: 'Not found', path: p }); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, app: 'LoopStream', ffmpeg: FFMPEG_BIN, time: nowIso() });
  }

  if (req.method === 'GET' && pathname === '/api/status') {
    return sendJson(res, 200, statusPayload());
  }

  if (req.method === 'GET' && pathname === '/api/logs') {
    const n = Math.min(500, Math.max(20, Number(url.searchParams.get('lines')) || 200));
    return sendJson(res, 200, { lines: logs.slice(-n) });
  }

  if (req.method === 'POST' && pathname === '/api/stream/start') {
    const body = await readBody(req);
    const key = String(body.streamKey || '').trim();
    const src = body.source;
    const source = src && typeof src.value === 'string' && src.value.trim() ? { kind: src.kind === 'url' ? 'url' : 'file', value: src.value.trim() } : null;
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(key)) return sendJson(res, 400, { error: 'Invalid stream key. Paste the full YouTube Live stream key.' });
    if (!source) return sendJson(res, 400, { error: 'Video source required (file path or media URL).' });
    startStream(source, key);
    return sendJson(res, 200, { ok: true, status: state.status });
  }

  if (req.method === 'POST' && pathname === '/api/stream/stop') {
    stopStream();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET') return serveStatic(req, res);
  if (req.method === 'POST') return sendJson(res, 404, { error: 'Not found' });
  return sendJson(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, HOST, () => {
  console.log(`LoopStream server listening on http://localhost:${PORT}`);
});
