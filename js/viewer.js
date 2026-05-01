// js/viewer.js
// ─────────────────────────────────────────────────────────────────────────────
// VIEWER ORCHESTRATOR — connects as "viewer" role and receives the remote stream.
//
// This is a much simpler module than app.js because the viewer only:
//   1. Connects to the signaling server as 'viewer'
//   2. Waits for the WebRTC offer from the sender
//   3. Displays the incoming video stream
// ─────────────────────────────────────────────────────────────────────────────

import * as Signal from './signaling.js';
import * as WebRTC from './webrtc.js';

// ── DOM references ────────────────────────────────────────────────────────────
const remoteVideo   = document.getElementById('remoteVideo');
const statusText    = document.getElementById('viewerStatus');
const statusBadge   = document.getElementById('viewerBadge');
const btnConnect    = document.getElementById('btnViewerConnect');
const btnDisconnect = document.getElementById('btnViewerDisconnect');

// ── Helpers ───────────────────────────────────────────────────────────────────

function setViewerStatus(state) {
  const states = {
    idle:       { cls: 'idle',      text: 'Inactivo' },
    buscando:   { cls: 'buscando',  text: 'Buscando emisor…' },
    conectado:  { cls: 'conectado', text: 'Conectado — recibiendo video' },
    error:      { cls: 'error',     text: 'Error de conexión' },
  };
  const s = states[state] || states.idle;
  statusBadge.className = `status-badge ${s.cls}`;
  statusText.textContent = s.text;
}

function log(msg) {
  const el = document.createElement('p');
  el.textContent = `[${new Date().toLocaleTimeString('es-ES')}] ${msg}`;
  document.getElementById('viewerLog').prepend(el);
}

// ── WebRTC callbacks ──────────────────────────────────────────────────────────

WebRTC.init({
  onRemoteStream: (stream) => {
    remoteVideo.srcObject = stream;
    remoteVideo.style.display = 'block';
    document.getElementById('viewerEmpty').style.display = 'none';
    setViewerStatus('conectado');
    log('Stream de video recibido. Reproduciendo.');
    btnConnect.disabled    = true;
    btnDisconnect.disabled = false;
  },
  onConnectionChange: (status) => {
    if (status === 'disconnected' || status === 'failed') {
      remoteVideo.srcObject  = null;
      remoteVideo.style.display = 'none';
      document.getElementById('viewerEmpty').style.display = 'flex';
      setViewerStatus('idle');
      log('El emisor se desconectó.');
      btnConnect.disabled    = false;
      btnDisconnect.disabled = true;
    }
  },
});

// ── Connect handler ───────────────────────────────────────────────────────────

async function handleConnect() {
  btnConnect.disabled = true;
  setViewerStatus('buscando');
  log('Conectando al servidor de señalización…');

  try {
    await Signal.connect('viewer');
    log('Conectado. Esperando oferta del emisor…');

    // Set up the WebRTC receiver side
    WebRTC.startViewerConnection();

    Signal.on('peer-disconnected', () => {
      setViewerStatus('idle');
      log('El emisor se desconectó.');
      btnConnect.disabled    = false;
      btnDisconnect.disabled = true;
    });

  } catch (err) {
    log(`Error: ${err.message}`);
    setViewerStatus('error');
    btnConnect.disabled = false;
  }
}

function handleDisconnect() {
  WebRTC.closePeerConnection();
  Signal.disconnect();
  remoteVideo.srcObject = null;
  remoteVideo.style.display = 'none';
  document.getElementById('viewerEmpty').style.display = 'flex';
  setViewerStatus('idle');
  log('Desconectado manualmente.');
  btnConnect.disabled    = false;
  btnDisconnect.disabled = true;
}

// ── Event listeners ───────────────────────────────────────────────────────────
btnConnect.addEventListener('click',    handleConnect);
btnDisconnect.addEventListener('click', handleDisconnect);

// ── Init ──────────────────────────────────────────────────────────────────────
setViewerStatus('idle');
btnDisconnect.disabled = true;
log('Página del receptor lista.');
