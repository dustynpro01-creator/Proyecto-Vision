// backend/server.js

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);

// ── Gemini client ─────────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/signal' });
const peers = new Map();

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, role, payload } = msg;

    if (type === 'register') {
      peers.set(role, ws);
      ws._role = role;

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
// Gemini endpoint (REEMPLAZADO)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/analyze-frame', async (req, res) => {
  const { frame } = req.body;
  if (!frame) return res.status(400).json({ error: 'No se recibió el fotograma.' });

  const base64Data = frame.replace(/^data:image\/\w+;base64,/, '');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const imageParts = [{
      inlineData: {
        data: base64Data,
        mimeType: "image/png"
      }
    }];

    const prompt = "Eres un asistente que analiza pantallas en tiempo real. Describe brevemente (2-3 oraciones) lo que ves en esta captura. Responde en español.";

    const result = await model.generateContentStream([prompt, ...imageParts]);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

  } catch (err) {
    console.error('[Gemini Error]:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
});