// js/app.js
// ─────────────────────────────────────────────────────────────────────────────
// APP ORCHESTRATOR (Sender side) — ties together UI, capture, WebRTC, and AI.
//
// This file is intentionally kept "thin": it imports all other modules and
// wires their callbacks together. Business logic lives in the sub-modules;
// this file only coordinates them.
//
// Dependency graph:
//   app.js  →  ui.js        (display updates)
//           →  capture.js   (screen capture)
//           →  signaling.js (WebSocket)
//           →  webrtc.js    (RTCPeerConnection)
//           →  ai.js        (Claude Vision loop)
// ─────────────────────────────────────────────────────────────────────────────

import * as UI       from './ui.js';
import * as Capture  from './capture.js';
import * as Signal   from './signaling.js';
import * as WebRTC   from './webrtc.js';
import * as AI       from './ai.js';

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
  sharing:   false,   // is screen capture active?
  connected: false,   // is a WebRTC peer connected?
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — WebRTC callbacks (called by webrtc.js)
// ─────────────────────────────────────────────────────────────────────────────

WebRTC.init({
  // This fires when a remote stream arrives (we are the viewer here for
  // monitoring purposes — normally the viewer.html page handles remote display).
  onRemoteStream: (stream) => {
    UI.showRemoteStream(stream);
  },

  // Fires whenever the P2P connection state changes
  onConnectionChange: (status) => {
    if (status === 'connected') {
      state.connected = true;
      UI.setStatus('conectado');
      UI.setInfoPeers(1);
      UI.showToast('¡Dispositivo conectado!', 'success');
      UI.addSystemLog('Conexión P2P establecida. Emitiendo video.');

      // Start emitting status once actually streaming video
      if (state.sharing) {
        UI.setStatus('emitiendo');
      }
    }

    if (status === 'disconnected' || status === 'failed') {
      state.connected = false;
      UI.setStatus(state.sharing ? 'buscando' : 'idle');
      UI.setInfoPeers(0);
      UI.showToast('Dispositivo desconectado.', 'info');
      UI.addSystemLog('Conexión P2P cerrada.');
      UI.clearRemoteStream();

      // Stop AI analysis if it was running
      if (AI.isRunning()) AI.stopAnalysis();
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Signaling handlers (called by signaling.js dispatch)
// ─────────────────────────────────────────────────────────────────────────────

Signal.on('disconnected', () => {
  state.connected = false;
  UI.setStatus('idle');
  UI.setButtonStates(state.sharing, false);
  UI.showToast('Conexión al servidor perdida.', 'error');
  UI.addSystemLog('Se perdió la conexión al servidor de señalización.');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Screen Capture controls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * handleStartShare()
 * Starts screen capture, shows the local preview, and connects to the
 * signaling server as the "sender" role.
 */
async function handleStartShare() {
  try {
    UI.addSystemLog('Solicitando permiso de captura de pantalla…');
    const stream = await Capture.startCapture();

    state.sharing = true;
    AI.resetFrameCount();

    UI.showLocalStream(stream);
    UI.setButtonStates(true, state.connected);
    UI.setInfoRole('Emisor');
    UI.setStatus('buscando');
    UI.showToast('Captura de pantalla iniciada.', 'success');
    UI.addSystemLog('Captura activa. Conectando al servidor de señalización…');

    // Connect to the signaling server as "sender"
    await Signal.connect('sender');
    UI.addSystemLog('Conectado al servidor. Esperando receptor…');

    // Tell WebRTC to prepare the sender-side connection
    await WebRTC.startSenderConnection(stream);

  } catch (err) {
    UI.showToast(err.message, 'error');
    UI.addErrorLog(err.message);
    // Roll back state on failure
    state.sharing = false;
    Capture.stopCapture();
    UI.clearLocalStream();
    UI.setButtonStates(false, false);
    UI.setStatus('idle');
  }
}

/**
 * handleStopShare()
 * Stops screen capture, closes WebRTC connection, disconnects signaling.
 */
function handleStopShare() {
  // Stop AI loop first
  if (AI.isRunning()) AI.stopAnalysis();

  Capture.stopCapture();
  WebRTC.closePeerConnection();
  Signal.disconnect();

  state.sharing   = false;
  state.connected = false;

  UI.clearLocalStream();
  UI.clearRemoteStream();
  UI.setButtonStates(false, false);
  UI.setInfoRole('—');
  UI.setInfoPeers(0);
  UI.setStatus('idle');
  UI.showToast('Compartición de pantalla detenida.', 'info');
  UI.addSystemLog('Sesión finalizada.');
}

// Listen for the browser's "Stop sharing" button (built into the browser UI)
window.addEventListener('capture-ended', handleStopShare);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — AI Analysis toggle
// ─────────────────────────────────────────────────────────────────────────────

function handleAIToggle() {
  if (!state.sharing) {
    UI.showToast('Inicia la compartición de pantalla primero.', 'info');
    UI.DOM.toggleAI.checked = false;
    return;
  }

  if (UI.DOM.toggleAI.checked) {
    const intervalMs = parseInt(UI.DOM.aiIntervalSelect.value, 10);
    AI.startAnalysis(UI.DOM.localVideo, intervalMs);
    UI.showToast('Análisis de IA activado.', 'success');
  } else {
    AI.stopAnalysis();
    UI.showToast('Análisis de IA desactivado.', 'info');
  }
}

// Update AI interval on-the-fly if the user changes the selector
function handleIntervalChange() {
  if (AI.isRunning()) {
    AI.stopAnalysis();
    const intervalMs = parseInt(UI.DOM.aiIntervalSelect.value, 10);
    AI.startAnalysis(UI.DOM.localVideo, intervalMs);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Manual / Documentation modal
// ─────────────────────────────────────────────────────────────────────────────

function handleOpenManual() { UI.openModal(); }
function handleCloseManual() { UI.closeModal(); }

// Close modal when clicking the dark overlay (outside the modal box)
UI.DOM.modalOverlay.addEventListener('click', (e) => {
  if (e.target === UI.DOM.modalOverlay) UI.closeModal();
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Video tab switching
// ─────────────────────────────────────────────────────────────────────────────

UI.DOM.tabLocal.addEventListener('click',  () => UI.switchVideoTab('local'));
UI.DOM.tabRemote.addEventListener('click', () => UI.switchVideoTab('remote'));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — Wire all event listeners
// ─────────────────────────────────────────────────────────────────────────────

UI.DOM.btnStartShare.addEventListener('click',  handleStartShare);
UI.DOM.btnStopShare.addEventListener('click',   handleStopShare);
UI.DOM.toggleAI.addEventListener('change',      handleAIToggle);
UI.DOM.aiIntervalSelect.addEventListener('change', handleIntervalChange);
UI.DOM.btnManual.addEventListener('click',      handleOpenManual);
UI.DOM.modalClose.addEventListener('click',     handleCloseManual);
UI.DOM.btnClearLog.addEventListener('click',    UI.clearLog);

// The "Conectar" / "Desconectar" buttons in the sidebar are for manually
// triggering the signaling connection (useful when sharing is already active
// and you want to reconnect without re-starting the capture).
UI.DOM.btnConnect.addEventListener('click', async () => {
  if (!state.sharing) {
    UI.showToast('Inicia la captura antes de conectar.', 'info');
    return;
  }
  try {
    await Signal.connect('sender');
    UI.setStatus('buscando');
    UI.showToast('Buscando receptor…', 'info');
    UI.addSystemLog('Reconectado al servidor de señalización.');
  } catch (err) {
    UI.showToast(err.message, 'error');
    UI.addErrorLog(err.message);
  }
});

UI.DOM.btnDisconnect.addEventListener('click', () => {
  WebRTC.closePeerConnection();
  Signal.disconnect();
  state.connected = false;
  UI.setStatus(state.sharing ? 'buscando' : 'idle');
  UI.setInfoPeers(0);
  UI.setButtonStates(state.sharing, false);
  UI.showToast('Desconectado manualmente.', 'info');
  UI.addSystemLog('Desconectado manualmente del receptor.');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — Initialise UI on page load
// ─────────────────────────────────────────────────────────────────────────────

(function init() {
  UI.initModalTabs();
  UI.setButtonStates(false, false);
  UI.setStatus('idle');
  UI.setInfoRole('—');
  UI.setInfoPeers(0);
  UI.setInfoFrames(0);
  UI.switchVideoTab('local');
  UI.addSystemLog('Aplicación iniciada. Listo para compartir pantalla.');
})();
