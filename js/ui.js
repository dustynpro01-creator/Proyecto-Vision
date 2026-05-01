// js/ui.js
// ─────────────────────────────────────────────────────────────────────────────
// UI MODULE — All DOM manipulation and visual feedback lives here.
//
// This module is intentionally separated from the networking and capture logic.
// It only knows about the DOM — it receives data and updates the screen.
// Other modules call its functions; it never initiates network actions itself.
// ─────────────────────────────────────────────────────────────────────────────

// ── DOM references (queried once at module load) ──────────────────────────────
export const DOM = {
  // Header
  statusBadge:      document.getElementById('statusBadge'),
  statusDot:        document.getElementById('statusDot'),
  statusText:       document.getElementById('statusText'),
  btnManual:        document.getElementById('btnManual'),

  // Sidebar controls
  btnStartShare:    document.getElementById('btnStartShare'),
  btnStopShare:     document.getElementById('btnStopShare'),
  btnConnect:       document.getElementById('btnConnect'),
  btnDisconnect:    document.getElementById('btnDisconnect'),
  toggleAI:         document.getElementById('toggleAI'),
  infoRole:         document.getElementById('infoRole'),
  infoPeers:        document.getElementById('infoPeers'),
  infoFrames:       document.getElementById('infoFrames'),

  // Video area
  tabLocal:         document.getElementById('tabLocal'),
  tabRemote:        document.getElementById('tabRemote'),
  panelLocal:       document.getElementById('panelLocal'),
  panelRemote:      document.getElementById('panelRemote'),
  localVideo:       document.getElementById('localVideo'),
  remoteVideo:      document.getElementById('remoteVideo'),
  emptyLocal:       document.getElementById('emptyLocal'),
  emptyRemote:      document.getElementById('emptyRemote'),

  // AI panel
  aiLog:            document.getElementById('aiLog'),
  btnClearLog:      document.getElementById('btnClearLog'),
  aiIntervalSelect: document.getElementById('aiIntervalSelect'),

  // Modal
  modalOverlay:     document.getElementById('modalOverlay'),
  modalClose:       document.getElementById('modalClose'),
  modalTabs:        document.querySelectorAll('.modal__tab'),
  docSections:      document.querySelectorAll('.doc-section'),

  // Toast container
  toastContainer:   document.getElementById('toastContainer'),
};

// ── Status badge states ───────────────────────────────────────────────────────
// Each state maps to a CSS class and display text.
const STATUS_STATES = {
  idle:       { cls: 'idle',      text: 'Inactivo' },
  buscando:   { cls: 'buscando',  text: 'Buscando dispositivos…' },
  conectado:  { cls: 'conectado', text: 'Conectado' },
  emitiendo:  { cls: 'emitiendo', text: 'Emitiendo' },
};

/**
 * setStatus(state)
 * Updates the header status badge.
 * @param {'idle'|'buscando'|'conectado'|'emitiendo'} state
 */
export function setStatus(state) {
  const s = STATUS_STATES[state] || STATUS_STATES.idle;

  // Remove all state classes, then add the correct one
  DOM.statusBadge.className = `status-badge ${s.cls}`;
  DOM.statusText.textContent = s.text;
}

// ── Video panel switching ─────────────────────────────────────────────────────

/**
 * switchVideoTab(tab)
 * Shows the selected video panel and marks the tab as active.
 * @param {'local'|'remote'} tab
 */
export function switchVideoTab(tab) {
  const isLocal = tab === 'local';

  DOM.tabLocal.classList.toggle('active', isLocal);
  DOM.tabRemote.classList.toggle('active', !isLocal);
  DOM.panelLocal.classList.toggle('active', isLocal);
  DOM.panelRemote.classList.toggle('active', !isLocal);
}

/**
 * showLocalStream(stream)
 * Attaches a MediaStream to the local <video> element and hides the placeholder.
 * @param {MediaStream} stream
 */
export function showLocalStream(stream) {
  DOM.localVideo.srcObject = stream;
  DOM.localVideo.style.display = 'block';
  DOM.emptyLocal.style.display = 'none';
  switchVideoTab('local');
}

/**
 * showRemoteStream(stream)
 * Attaches a remote MediaStream to the remote <video> element.
 * @param {MediaStream} stream
 */
export function showRemoteStream(stream) {
  DOM.remoteVideo.srcObject = stream;
  DOM.remoteVideo.style.display = 'block';
  DOM.emptyRemote.style.display = 'none';
  switchVideoTab('remote');
}

/**
 * clearLocalStream()
 * Removes the local video and shows the placeholder again.
 */
export function clearLocalStream() {
  DOM.localVideo.srcObject = null;
  DOM.localVideo.style.display = 'none';
  DOM.emptyLocal.style.display = 'flex';
}

/**
 * clearRemoteStream()
 * Removes the remote video and shows the placeholder again.
 */
export function clearRemoteStream() {
  DOM.remoteVideo.srcObject = null;
  DOM.remoteVideo.style.display = 'none';
  DOM.emptyRemote.style.display = 'flex';
}

// ── Button enable/disable helpers ─────────────────────────────────────────────

/**
 * setButtonStates(sharing, connected)
 * Enables/disables controls based on current app state.
 * @param {boolean} sharing   - is screen currently being captured?
 * @param {boolean} connected - is a WebRTC peer connected?
 */
export function setButtonStates(sharing, connected) {
  DOM.btnStartShare.disabled  = sharing;
  DOM.btnStopShare.disabled   = !sharing;
  DOM.btnConnect.disabled     = connected;
  DOM.btnDisconnect.disabled  = !connected;
}

// ── Info card updates ─────────────────────────────────────────────────────────
export function setInfoRole(role)    { DOM.infoRole.textContent   = role; }
export function setInfoPeers(count)  { DOM.infoPeers.textContent  = count; }
export function setInfoFrames(count) { DOM.infoFrames.textContent = count; }

// ── AI Log panel ──────────────────────────────────────────────────────────────

/** Returns a formatted HH:MM:SS timestamp string. */
function timestamp() {
  return new Date().toLocaleTimeString('es-ES', { hour12: false });
}

/**
 * addSystemLog(text)
 * Adds a grey italic system message to the AI log.
 * Used for connection events, status changes, etc.
 */
export function addSystemLog(text) {
  const el = document.createElement('div');
  el.className = 'log-entry log-entry--system';
  el.innerHTML = `<div class="log-entry__time">${timestamp()}</div>
                  <div>${text}</div>`;
  appendLog(el);
}

/**
 * addErrorLog(text)
 * Adds a red error message to the AI log.
 */
export function addErrorLog(text) {
  const el = document.createElement('div');
  el.className = 'log-entry log-entry--error';
  el.innerHTML = `<div class="log-entry__time">${timestamp()}</div>
                  <div>⚠️ ${text}</div>`;
  appendLog(el);
}

/**
 * startStreamingLog()
 * Creates a new "streaming" AI entry with a blinking cursor.
 * Returns the text element so the caller can append delta text to it.
 * @returns {{ entry: HTMLElement, textEl: HTMLElement }}
 */
export function startStreamingLog() {
  const entry = document.createElement('div');
  entry.className = 'log-entry log-entry--streaming';

  const timeEl = document.createElement('div');
  timeEl.className = 'log-entry__time';
  timeEl.textContent = `${timestamp()} · Claude Vision`;

  const textEl = document.createElement('div');
  textEl.className = 'log-entry__text';

  entry.appendChild(timeEl);
  entry.appendChild(textEl);
  appendLog(entry);
  return { entry, textEl };
}

/**
 * finalizeStreamingLog(entry)
 * Removes the "streaming" style (and its blinking cursor) once done.
 */
export function finalizeStreamingLog(entry) {
  entry.classList.remove('log-entry--streaming');
  entry.classList.add('log-entry--ai');
}

/**
 * appendLog(el)
 * Appends an entry to the log and auto-scrolls to bottom.
 */
function appendLog(el) {
  DOM.aiLog.appendChild(el);
  // Auto-scroll: only scroll if user hasn't manually scrolled up
  const log = DOM.aiLog;
  const isNearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  if (isNearBottom) {
    log.scrollTop = log.scrollHeight;
  }
}

/**
 * clearLog()
 * Removes all entries from the AI log.
 */
export function clearLog() {
  DOM.aiLog.innerHTML = '';
  addSystemLog('Registro limpiado.');
}

// ── Toast notifications ───────────────────────────────────────────────────────

/**
 * showToast(message, type, duration)
 * Shows a non-blocking toast notification.
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 * @param {number} duration  milliseconds before auto-dismiss (default 3500)
 */
export function showToast(message, type = 'info', duration = 3500) {
  const icons = { info: 'ℹ️', success: '✅', error: '❌' };

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;

  DOM.toastContainer.appendChild(toast);

  // Auto-remove with a fade-out animation
  setTimeout(() => {
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// ── Modal (Manual) ────────────────────────────────────────────────────────────

/** openModal() — shows the documentation modal. */
export function openModal() {
  DOM.modalOverlay.classList.add('open');
}

/** closeModal() — hides the documentation modal. */
export function closeModal() {
  DOM.modalOverlay.classList.remove('open');
}

/**
 * initModalTabs()
 * Sets up click handlers for the documentation tab switcher inside the modal.
 */
export function initModalTabs() {
  DOM.modalTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      DOM.modalTabs.forEach((t)  => t.classList.toggle('active', t === tab));
      DOM.docSections.forEach((s) => s.classList.toggle('active', s.id === target));
    });
  });
}
