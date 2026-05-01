// js/capture.js
// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE MODULE — Screen Capture API wrapper.
//
// Uses navigator.mediaDevices.getDisplayMedia() to ask the user to share
// their screen (or a window/tab). Returns a MediaStream.
//
// This module is kept intentionally thin — it just handles the browser API
// and surfaces errors in a friendly way. The caller (app.js) handles what
// to do with the stream.
// ─────────────────────────────────────────────────────────────────────────────

let activeStream = null;

/**
 * startCapture()
 * Prompts the user to pick a screen/window/tab to share.
 *
 * The browser will show its own permission dialog. If the user denies it or
 * the browser does not support it, we throw a descriptive error.
 *
 * @returns {Promise<MediaStream>}
 */
export async function startCapture() {
  // Check for API support before attempting (older browsers/iOS lack it)
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(
      'Tu navegador no soporta la captura de pantalla. ' +
      'Usa Chrome, Edge o Firefox en escritorio.'
    );
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        // Ask for the best quality the system can provide.
        // The browser/OS may not honour these — they are hints, not guarantees.
        frameRate:   { ideal: 30, max: 60 },
        width:       { ideal: 1920 },
        height:      { ideal: 1080 },
        cursor:      'always',   // include the mouse cursor in the capture
      },
      audio: false,              // we don't need audio for AI frame analysis
    });

    activeStream = stream;

    // Listen for the user ending the share via the browser's built-in button
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      activeStream = null;
      // Dispatch a custom event so app.js can react without a direct coupling
      window.dispatchEvent(new CustomEvent('capture-ended'));
    });

    return stream;

  } catch (err) {
    // NotAllowedError  → user clicked "Cancel" or denied permission
    // NotFoundError    → no screen available (rare)
    if (err.name === 'NotAllowedError') {
      throw new Error(
        'Permiso denegado. Debes autorizar la compartición de pantalla cuando el navegador lo solicite.'
      );
    }
    throw new Error(`Error al iniciar captura: ${err.message}`);
  }
}

/**
 * stopCapture()
 * Stops all tracks in the active stream (releases the screen capture).
 */
export function stopCapture() {
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }
}

/**
 * getActiveStream()
 * Returns the current MediaStream or null if not capturing.
 * @returns {MediaStream|null}
 */
export function getActiveStream() {
  return activeStream;
}

/**
 * isCapturing()
 * Returns true if a screen capture is currently active.
 * @returns {boolean}
 */
export function isCapturing() {
  return activeStream !== null && activeStream.active;
}
