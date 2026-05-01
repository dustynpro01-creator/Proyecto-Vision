// backend/server.js
// ─────────────────────────────────────────────────────────────────────────────
// BACKEND: Express HTTP server + WebSocket signaling + Claude Vision proxy
//
// Three responsibilities:
//   1. Serve the frontend static files
//   2. Handle WebRTC signaling (offer / answer / ICE candidates) over WebSockets
//   3. Accept canvas frame POSTs → send to Claude Vision → stream response back
// ─────────────────────────────────────────────────────────────────────────────

import express              from 'express';
import http                 from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import Anthropic            from '@anthropic-ai/sdk';
import path                 from 'path';
import { fileURLToPath }    from 'url';
import dotenv               from 'dotenv';

dotenv.config();

// ES-module equivalent of __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app    = express();
const server = http.createServer(app);

// ── Anthropic client ──────────────────────────────────────────────────────────
// The SDK automatically reads ANTHROPIC_API_KEY from the environment.
const anthropic = new Anthropic();

// ── Middleware ────────────────────────────────────────────────────────────────
// Increase JSON limit to 10 MB because base64 PNG frames can be large.
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A ─ WebSocket Signaling Server
//
// WebRTC peers cannot talk to each other directly until they exchange
// "offer", "answer", and "ICE candidate" messages through a shared server.
// This is called the *signaling* phase. Once complete, the video stream
// travels directly peer-to-peer (no server involvement).
//
// Message protocol (all messages are JSON):
//   { type: 'register',    role: 'sender'|'viewer' }
//   { type: 'offer',       payload: <RTCSessionDescription> }
//   { type: 'answer',      payload: <RTCSessionDescription> }
//   { type: 'ice',         payload: <RTCIceCandidate> }
//   { type: 'viewer-ready' }           ← server → sender
//   { type: 'peer-disconnected' }      ← server → remaining peer
// ─────────────────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/signal' });

// Simple room: one sender + one viewer. Key = role string, value = WebSocket.
const peers = new Map();

wss.on('connection', (ws) => {
  console.log('[WS] Nueva conexión entrante');

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { console.error('[WS] JSON inválido recibido'); return; }

    const { type, role, payload } = msg;

    // ── Register peer with a role ─────────────────────────────────────────────
    if (type === 'register') {
      peers.set(role, ws);
      ws._role = role;
      console.log(`[WS] Registrado: ${role}`);

      // Notify the sender if a viewer is already waiting (or vice-versa)
      if (role === 'sender' && peers.has('viewer')) {
        safeSend(ws, { type: 'viewer-ready' });
      }
      if (role === 'viewer' && peers.has('sender')) {
        safeSend(peers.get('sender'), { type: 'viewer-ready' });
      }
      return;
    }

    // ── Relay any other signaling message to the opposite peer ────────────────
    // The server does NOT interpret offers/answers/ICE — it just forwards them.
    const targetRole = ws._role === 'sender' ? 'viewer' : 'sender';
    if (peers.has(targetRole)) {
      safeSend(peers.get(targetRole), { type, payload });
    }
  });

  ws.on('close', () => {
    for (const [role, socket] of peers.entries()) {
      if (socket === ws) {
        peers.delete(role);
        console.log(`[WS] Desconectado: ${role}`);
        const otherRole = role === 'sender' ? 'viewer' : 'sender';
        if (peers.has(otherRole)) {
          safeSend(peers.get(otherRole), { type: 'peer-disconnected' });
        }
      }
    }
  });
});

/** Send JSON safely — avoids crashing on already-closed sockets. */
function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B ─ AI Frame Analysis Endpoint
//
// The frontend periodically captures a frame from the screen stream via
// <canvas>, converts it to a base64 PNG, and POSTs it here.
//
// We forward the image to Claude claude-sonnet-4-20250514 (vision) and stream the
// response back using Server-Sent Events (SSE) so the text appears in the
// AI panel incrementally — no waiting for the full response.
//
// Request  → POST /analyze-frame   { frame: "data:image/png;base64,..." }
// Response ← SSE stream            data: {"delta":"..."}
//                                   data: {"done":true}
// ─────────────────────────────────────────────────────────────────────────────
app.post('/analyze-frame', async (req, res) => {
  const { frame } = req.body;
  if (!frame) return res.status(400).json({ error: 'No se recibió ningún fotograma.' });

  // Strip the data URI header to get raw base64 bytes
  const base64Data = frame.replace(/^data:image\/\w+;base64,/, '');

  // SSE headers — keeps the HTTP connection open for streaming
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  try {
    const stream = anthropic.messages.stream({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 350,
      messages: [{
        role:    'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: 'image/png', data: base64Data },
          },
          {
            type: 'text',
            text: `Eres un asistente que analiza pantallas compartidas en tiempo real.
Describe brevemente (2-3 oraciones) lo que ves en esta captura de pantalla.
Enfócate en: la aplicación activa, el contenido visible y cualquier actividad notable.
Responde en español, de forma clara y directa.`,
          },
        ],
      }],
    });

    // Stream each text delta back to the browser as an SSE event
    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
    });

    stream.on('finalMessage', () => {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      console.error('[AI] Error en stream:', err.message);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    console.error('[AI] Error fatal:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✅  Servidor iniciado en  → http://localhost:${PORT}`);
  console.log(`🔌  WebSocket señalización → ws://localhost:${PORT}/signal\n`);
});
