'use strict';

const $ = (sel) => document.querySelector(sel);
const streamKeyEl = $('#streamKey');
const sourceValueEl = $('#sourceValue');
const sourceSeg = document.querySelector('.seg');
const startBtn = $('#startBtn');
const stopBtn = $('#stopBtn');
const setupMsg = $('#setupMsg');
const statusPill = $('#statusPill');
const statusDot = $('#statusDot');
const statusText = $('#statusText');
const liveBadge = $('#liveBadge');
const liveState = $('#liveState');
const liveDot = $('#liveDot');
const liveTimer = $('#liveTimer');
const liveUptime = $('#liveUptime');
const liveSource = $('#liveSource');
const logsEl = $('#logs');

const STATUS_LABEL = { idle: 'Idle', starting: 'Starting', live: 'Live', error: 'Error' };
const state = { status: 'idle', uptimeSec: 0, source: null };

function fmtUptime(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function setStatus(status, uptimeSec, source) {
  state.status = status;
  state.uptimeSec = uptimeSec || 0;
  state.source = source || null;

  statusDot.className = 'dot' + (status === 'live' ? ' live' : '');
  statusText.textContent = STATUS_LABEL[status] || status;
  statusPill.className = 'status-pill' + (status === 'live' ? ' live-pill' : '');

  const live = status === 'live' || status === 'starting';
  liveBadge.className = 'live-badge ' + status;
  liveState.textContent = STATUS_LABEL[status];
  liveDot.className = 'dot' + (status === 'live' ? ' live' : '');

  liveTimer.textContent = fmtUptime(state.uptimeSec);
  liveUptime.textContent = live ? fmtUptime(state.uptimeSec) : '—';
  liveSource.textContent = state.source ? `${state.source.kind} · ${state.source.value}` : '—';

  startBtn.disabled = live;
  stopBtn.disabled = !live;
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function refreshStatus() {
  try {
    const data = await fetchJSON('/api/status');
    setStatus(data.status, data.uptimeSec, data.source);
  } catch (e) {
    setStatus('error', 0, null);
  }
}

async function refreshLogs() {
  try {
    const data = await fetchJSON('/api/logs?lines=200');
    logsEl.innerHTML = '';
    const html = data.lines.map((l) => `<div><span class="log-t">${l.t.slice(11, 19)}</span> <span class="log-lv">${l.level}</span> ${escapeHtml(l.msg)}</div>`).join('\n');
    logsEl.innerHTML = html;
    logsEl.scrollTop = logsEl.scrollHeight;
  } catch (e) { /* ignore */ }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function startLoop() {
  const key = streamKeyEl.value.trim();
  const source = { kind: sourceSeg.dataset.kind, value: sourceValueEl.value.trim() };
  setupMsg.textContent = 'Starting loop…';
  try {
    const data = await fetchJSON('/api/stream/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamKey: key, source }),
    });
    setupMsg.textContent = `Loop start accepted · engine status: ${data.status}`;
    await refreshStatus();
    refreshLogs();
  } catch (e) {
    setupMsg.textContent = 'Start failed: ' + e.message;
    await refreshStatus();
  }
}

async function stopLoop() {
  setupMsg.textContent = 'Stopping loop…';
  try {
    await fetchJSON('/api/stream/stop', { method: 'POST' });
    await refreshStatus();
  } catch (e) {
    setupMsg.textContent = 'Stop failed: ' + e.message;
  }
}

streamKeyEl.addEventListener('input', () => { streamKeyEl.dataset.touched = '1'; });
$('#keyToggle').addEventListener('click', () => {
  const type = streamKeyEl.type === 'password' ? 'text' : 'password';
  streamKeyEl.type = type;
  $('#keyToggle').textContent = type === 'password' ? 'Show' : 'Hide';
});
$('#keyCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(streamKeyEl.value.trim()); } catch (e) { /* clipboard may need https/localhost */ }
});
sourceSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  sourceSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
  sourceSeg.dataset.kind = btn.dataset.kind;
});
startBtn.addEventListener('click', startLoop);
stopBtn.addEventListener('click', stopLoop);

// Init
(async function init() {
  setStatus('idle', 0, null);
  await refreshStatus();
  await refreshLogs();
  setInterval(refreshStatus, 2000);
  setInterval(refreshLogs, 3000);
})();
