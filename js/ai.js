// js/ai.js
// ─────────────────────────────────────────────────────────────────────────────
// AI MODULE — Periodic frame extraction and Claude Vision pipeline.
//
// Pipeline per cycle:
//   1. Grab the current video frame via an offscreen <canvas>
//   2. Convert it to a compressed JPEG base64 string
//   3. POST it to our backend /analyze-frame endpoint
//   4. Read the Server-Sent Events (SSE) response and stream text into the AI log
//   5. Wait for the configured interval, then repeat
//
// We use SSE (not a plain fetch) so the AI response appears word-by-word
// in the UI rather than waiting for the full response to arrive.
// ─────────────────────────────────────────────────────────────────────────────

import * as UI from './ui.js';

// ── State ─────────────────────────────────────────────────────────────────────
let intervalId     = null;    // setInterval handle
let isAnalyzing    = false;   // prevents overlapping analysis cycles
let frameCount     = 0;       // total frames sent this session

// Off-screen canvas used to extract frames from the video element.
// We create it once and reuse it to avoid repeated DOM allocation.
const canvas  = document.createElement('canvas');
const ctx     = canvas.getContext('2d');

/**
 * captureFrame(videoEl, quality)
 * Draws the current video frame onto the offscreen canvas and returns
 * a base64-encoded JPEG data URI.
 *
 * We use JPEG (not PNG) because:
 *   • Smaller file size → faster network round-trip
 *   • Claude Vision handles JPEG perfectly
 *   • quality=0.6 is sharp enough for analysis, tiny for transfer
 *
 * @param {HTMLVideoElement} videoEl
 * @param {number}           quality  0.0–1.0 JPEG quality (default 0.6)
 * @returns {string|null}    base64 data URI, or null if video not ready
 */
export function captureFrame(videoEl, quality = 0.6) {
  // Don't capture if the video has no valid dimensions yet
  if (!videoEl || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
    return null;
  }

  // Resize canvas to match the current video resolution
  canvas.width  = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;

  // Draw the current video frame onto the canvas
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

  // Export as a compressed JPEG base64 string
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * analyzeFrame(frameDataUri)
 * POSTs a single frame to the backend and streams the AI response
 * into the AI log panel word-by-word via SSE.
 *
 * @param {string} frameDataUri  base64 JPEG data URI
 * @returns {Promise<void>}
 */
async function analyzeFrame(frameDataUri) {
  // Create a streaming log entry with a blinking cursor
  const { entry, textEl } = UI.startStreamingLog();

  try {
    const response = await fetch('/analyze-frame', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ frame: frameDataUri }),
    });

    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status}`);
    }

    // Read the SSE stream using the response body's ReadableStream API.
    // Each SSE event looks like:  data: {"delta":"some text"}\n\n
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on SSE event boundaries (\n\n)
      const events = buffer.split('\n\n');
      // Keep the last (potentially incomplete) chunk in the buffer
      buffer = events.pop();

      for (const event of events) {
        // Each event starts with "data: "
        const line = event.replace(/^data:\s*/, '').trim();
        if (!line) continue;

        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }

        if (parsed.delta) {
          // Append the new text delta to the streaming entry
          textEl.textContent += parsed.delta;
        }

        if (parsed.done) {
          // Stream finished — remove the blinking cursor
          UI.finalizeStreamingLog(entry);
        }

        if (parsed.error) {
          textEl.textContent = `Error: ${parsed.error}`;
          entry.classList.remove('log-entry--streaming');
          entry.classList.add('log-entry--error');
        }
      }
    }

  } catch (err) {
    // Replace the streaming entry with a proper error entry
    entry.remove();
    UI.addErrorLog(`Análisis fallido: ${err.message}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * startAnalysis(videoEl, intervalMs)
 * Begins the periodic frame-capture → AI-analysis loop.
 *
 * @param {HTMLVideoElement} videoEl      The <video> showing the local screen
 * @param {number}           intervalMs   How often to analyze (e.g. 3000 ms)
 */
export function startAnalysis(videoEl, intervalMs = 3000) {
  if (intervalId !== null) stopAnalysis();   // safety: clear any previous loop

  UI.addSystemLog(`Análisis de IA iniciado (cada ${intervalMs / 1000}s).`);

  intervalId = setInterval(async () => {
    // Skip this cycle if the previous analysis is still running
    // (avoids hammering the API if the response is slow)
    if (isAnalyzing) return;

    const frame = captureFrame(videoEl);
    if (!frame) return;   // video not ready yet

    isAnalyzing = true;
    frameCount++;
    UI.setInfoFrames(frameCount);

    try {
      await analyzeFrame(frame);
    } finally {
      isAnalyzing = false;
    }
  }, intervalMs);
}

/**
 * stopAnalysis()
 * Stops the periodic analysis loop.
 */
export function stopAnalysis() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    isAnalyzing = false;
    UI.addSystemLog('Análisis de IA detenido.');
  }
}

/**
 * resetFrameCount()
 * Resets the frames-sent counter (call this when starting a new session).
 */
export function resetFrameCount() {
  frameCount = 0;
  UI.setInfoFrames(0);
}

/**
 * isRunning()
 * Returns true if the analysis loop is currently active.
 * @returns {boolean}
 */
export function isRunning() {
  return intervalId !== null;
}
