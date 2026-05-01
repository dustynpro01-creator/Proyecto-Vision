// js/webrtc.js
// ─────────────────────────────────────────────────────────────────────────────
// WEBRTC MODULE — RTCPeerConnection setup, offer/answer/ICE handling.
//
// WebRTC flow recap:
//
//   SENDER side                        VIEWER side
//   ───────────────────────────────    ──────────────────────────────
//   1. createOffer()                   3. setRemoteDescription(offer)
//   2. setLocalDescription(offer)      4. createAnswer()
//      ──── offer sent via signal ───▶ 5. setLocalDescription(answer)
//                                         ◀─── answer sent via signal ───
//   6. setRemoteDescription(answer)
//      ◀── ICE candidates exchanged ──▶ (both sides)
//   7. P2P connection established ✓
//
// ICE candidates are network path proposals. Each side collects them as the
// browser discovers network interfaces, and sends them to the peer via
// the signaling server. Once both peers have a matching pair, the P2P
// video tunnel opens.
// ─────────────────────────────────────────────────────────────────────────────

import * as Signal from './signaling.js';

// STUN servers help peers discover their public IP addresses.
// Google's free STUN servers work fine for local network use.
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

let peerConnection = null;

// Callbacks registered by the app layer
let onRemoteStream   = null;
let onConnectionChange = null;

/**
 * init(options)
 * Initialise the WebRTC module by registering app-layer callbacks.
 *
 * @param {object} options
 * @param {Function} options.onRemoteStream     - called with MediaStream when remote video arrives
 * @param {Function} options.onConnectionChange - called with 'connected'|'disconnected'|'failed'
 */
export function init({ onRemoteStream: onRS, onConnectionChange: onCC }) {
  onRemoteStream    = onRS;
  onConnectionChange = onCC;
}

/**
 * createPeerConnection()
 * Builds a new RTCPeerConnection and wires up all its event listeners.
 * Called fresh for each new connection attempt (old ones are always closed first).
 * @returns {RTCPeerConnection}
 */
function createPeerConnection() {
  // Close any lingering connection before creating a new one
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  const pc = new RTCPeerConnection(ICE_SERVERS);

  // ── ICE candidate collected locally → forward to peer via signaling ──────
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      Signal.send({ type: 'ice', payload: candidate });
    }
  };

  // ── Connection state changes ──────────────────────────────────────────────
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    console.log('[WebRTC] Estado de conexión:', state);

    if (state === 'connected')                            onConnectionChange?.('connected');
    if (state === 'disconnected' || state === 'closed')  onConnectionChange?.('disconnected');
    if (state === 'failed')                               onConnectionChange?.('failed');
  };

  // ── Remote stream arrived ─────────────────────────────────────────────────
  // ontrack fires when the sender's video track is received here (viewer side).
  pc.ontrack = ({ streams }) => {
    if (streams && streams[0]) {
      console.log('[WebRTC] Pista remota recibida.');
      onRemoteStream?.(streams[0]);
    }
  };

  peerConnection = pc;
  return pc;
}

// ─────────────────────────────────────────────────────────────────────────────
// SENDER SIDE — startSenderConnection(stream)
//
// Called after the sender has a screen capture stream.
// Attaches the video track to the peer connection and creates an offer.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * startSenderConnection(stream)
 * Adds the screen capture track to WebRTC and waits for a viewer.
 * When the signaling server announces 'viewer-ready', creates and sends an offer.
 * @param {MediaStream} stream
 */
export async function startSenderConnection(stream) {
  const pc = createPeerConnection();

  // Add each track from the screen capture stream to the peer connection.
  // This is what gets transmitted to the viewer.
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  // Register signaling handlers for the sender side
  Signal.on('viewer-ready', async () => {
    console.log('[WebRTC] Visor detectado → creando oferta…');
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      Signal.send({ type: 'offer', payload: offer });
    } catch (err) {
      console.error('[WebRTC] Error al crear oferta:', err);
    }
  });

  Signal.on('answer', async (answer) => {
    console.log('[WebRTC] Respuesta recibida.');
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('[WebRTC] Error al aplicar respuesta:', err);
    }
  });

  Signal.on('ice', async (candidate) => {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('[WebRTC] Error al añadir candidato ICE:', err);
    }
  });

  Signal.on('peer-disconnected', () => onConnectionChange?.('disconnected'));
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEWER SIDE — startViewerConnection()
//
// Called on the viewer page. Waits for an offer from the sender,
// then replies with an answer.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * startViewerConnection()
 * Sets up WebRTC on the receiver side. Handles incoming offer → sends answer.
 */
export function startViewerConnection() {
  const pc = createPeerConnection();

  Signal.on('offer', async (offer) => {
    console.log('[WebRTC] Oferta recibida → creando respuesta…');
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      Signal.send({ type: 'answer', payload: answer });
    } catch (err) {
      console.error('[WebRTC] Error al crear respuesta:', err);
    }
  });

  Signal.on('ice', async (candidate) => {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('[WebRTC] Error al añadir candidato ICE:', err);
    }
  });

  Signal.on('peer-disconnected', () => onConnectionChange?.('disconnected'));
}

/**
 * closePeerConnection()
 * Tears down the WebRTC connection cleanly.
 */
export function closePeerConnection() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
    console.log('[WebRTC] Conexión cerrada.');
  }
}

/**
 * getConnectionState()
 * Returns the current RTCPeerConnection state, or 'none' if not initialised.
 * @returns {string}
 */
export function getConnectionState() {
  return peerConnection ? peerConnection.connectionState : 'none';
}
