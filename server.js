// backend/server.js
// ─────────────────────────────────────────────────────────────────────────────
// BACKEND: Express HTTP server + WebSocket signaling + Claude Vision proxy
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
const anthropic = new Anthropic();

// ── Middleware (CORREGIDO) ────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// Servir archivos desde la raíz del proyecto
app.use(express.static(__dirname));

// Ruta principal → index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A ─ WebSocket Signaling Server
// ─────────────────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/signal' });

const peers = new Map();

wss.on('connection', (ws) => {
  console.log('[WS] Nueva conexión entrante');

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { console.error('[WS] JSON inválido recibido'); return; }

    const { type, role, payload } = msg;

    if (type === 'register') {
      peers.set(role, ws);
      ws._role = role;
      console.log(`[WS] Registrado: ${role}`);

      if (role === 'sender' && peers.has('viewer')) {
        safeSend(ws, { type: 'viewer-ready' });
      }
      if (role === 'viewer' && peers.has('sender')) {
        safeSend(peers.get('sender'), { type: 'viewer-ready' });
      }
      return;
    }

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

function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B ─ AI Frame Analysis Endpoint
// ─────────────────────────────────────────────────────────────────────────────
app.post('/analyze-frame', async (req, res) => {
  const { frame } = req.body;
  if (!frame) return res.status(400).json({ error: 'No se recibió ningún fotograma.' });

  const base64Data = frame.replace(/^data:image\/\w+;base64,/, '');

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 350,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
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