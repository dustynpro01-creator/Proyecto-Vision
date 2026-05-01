// js/signaling.js
// ─────────────────────────────────────────────────────────────────────────────
// SIGNALING MODULE — WebSocket client for WebRTC handshake exchange.
//
// WebRTC peers need to exchange "offer", "answer", and "ICE candidate" messages
// before they can talk directly. This module connects to our Node.js WebSocket
// server and ferries those messages back and forth.
//
// It uses an event-callback model: callers register handlers via .on(type, fn)
// so this module stays decoupled from webrtc.js and ui.js.
// ─────────────────────────────────────────────────────────────────────────────

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${protocol}//${window.location.host}/signal`;

let socket = null;

// Registered callbacks: Map<type, Function>
const handlers = new Map();

/**
 * on(type, handler)
 * Register a callback for a specific message type from the server.
 * @param {string}   type    - e.g. 'offer', 'answer', 'ice', 'viewer-ready'
 * @param {Function} handler - called with the message payload
 */
export function on(type, handler) {
  handlers.set(type, handler);
}

/**
 * connect(role)
 * Opens a WebSocket connection to the signaling server and registers this
 * peer's role ('sender' or 'viewer').
 *
 * Returns a Promise that resolves when the connection is open, or rejects
 * if the connection fails within 5 seconds.
 *
 * @param {'sender'|'viewer'} role
 * @returns {Promise<void>}
 */
export function connect(role) {
  return new Promise((resolve, reject) => {
    socket = new WebSocket(WS_URL);

    const timeout = setTimeout(() => {
      reject(new Error('Tiempo de conexión agotado. Verifica que el servidor esté activo.'));
      socket.close();
    }, 5000);

    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      console.log(`[Signal] Conectado como: ${role}`);
      // Register our role with the server immediately on open
      send({ type: 'register', role });
      resolve();
    });

    socket.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); }
      catch { console.error('[Signal] Mensaje no válido:', event.data); return; }

      console.log('[Signal] ←', msg.type);

      // Dispatch to the registered handler for this message type
      const handler = handlers.get(msg.type);
      if (handler) {
        handler(msg.payload);
      } else {
        console.warn('[Signal] Sin manejador para tipo:', msg.type);
      }
    });

    socket.addEventListener('close', () => {
      console.log('[Signal] Conexión cerrada.');
      const handler = handlers.get('disconnected');
      if (handler) handler();
    });

    socket.addEventListener('error', (err) => {
      clearTimeout(timeout);
      console.error('[Signal] Error WebSocket:', err);
      reject(new Error('No se pudo conectar al servidor de señalización.'));
    });
  });
}

/**
 * send(data)
 * Sends a JSON message to the signaling server.
 * Silently drops the message if the socket is not open.
 * @param {object} data
 */
export function send(data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log('[Signal] →', data.type);
    socket.send(JSON.stringify(data));
  } else {
    console.warn('[Signal] Intento de envío sin conexión abierta.');
  }
}

/**
 * disconnect()
 * Gracefully closes the WebSocket connection.
 */
export function disconnect() {
  if (socket) {
    socket.close();
    socket = null;
  }
}

/**
 * isConnected()
 * Returns true if the WebSocket is currently open.
 * @returns {boolean}
 */
export function isConnected() {
  return socket !== null && socket.readyState === WebSocket.OPEN;
}
