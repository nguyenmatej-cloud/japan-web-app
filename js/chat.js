/**
 * chat.js – Real-time skupinový chat (text only).
 */
import { db } from './firebase-config.js';
import { state, showToast, showConfirm } from './app.js';
import {
  collection, doc, addDoc, deleteDoc,
  query, orderBy, limit, onSnapshot, serverTimestamp, getDocs,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';

const MSG_LIMIT = 120;

let _messages  = [];
let _members   = {};
let _unsub     = null;
let _container = null;
let _onEsc     = null;

/* ════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════ */

export function render(container) {
  _container = container;
  _messages  = [];

  container.innerHTML = buildShell();
  setupListeners();

  _onEsc = (e) => {
    if (e.key === 'Escape') {
      const input = _container?.querySelector('#chat-input');
      if (input) input.blur();
    }
  };
  document.addEventListener('keydown', _onEsc);

  loadMembers().then(() => subscribe());
  return cleanup;
}

function cleanup() {
  if (_onEsc) { document.removeEventListener('keydown', _onEsc); _onEsc = null; }
  _unsub?.();
  _unsub     = null;
  _container = null;
  _messages  = [];
}

/* ── Shell ───────────────────────────────────────────────────── */

function buildShell() {
  return `
    <div class="page page--enter chat-page">
      <div class="page-header">
        <h1 class="page-header__title">💬 Chat</h1>
        <p class="page-header__subtitle">Skupinová konverzace</p>
      </div>

      <div class="chat-window">
        <div class="chat-messages" id="chat-messages" role="log" aria-live="polite" aria-label="Zprávy">
          <div class="wl-skeletons">
            <div class="skeleton skeleton--card" style="height:56px"></div>
            <div class="skeleton skeleton--card" style="height:56px"></div>
            <div class="skeleton skeleton--card" style="height:56px"></div>
          </div>
        </div>

        <div class="chat-input-area">
          <textarea id="chat-input" class="chat-input" placeholder="Napiš zprávu…"
                    rows="1" aria-label="Zpráva" maxlength="2000"></textarea>
          <button class="chat-send-btn" id="btn-send" title="Odeslat (Enter)" aria-label="Odeslat">➤</button>
        </div>
      </div>
    </div>
  `;
}

/* ════════════════════════════════════════════════════════════
   MEMBERS
   ════════════════════════════════════════════════════════════ */

async function loadMembers() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    _members = {};
    snap.docs.forEach(d => { _members[d.id] = { uid: d.id, ...d.data() }; });
  } catch (err) {
    console.error('[chat] loadMembers:', err);
  }
}

/* ════════════════════════════════════════════════════════════
   FIRESTORE
   ════════════════════════════════════════════════════════════ */

function subscribe() {
  _unsub?.();
  const q = query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(MSG_LIMIT));
  _unsub = onSnapshot(q, (snap) => {
    _messages = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
    renderMessages();
  }, (err) => {
    console.error('[chat] snapshot:', err);
    showToast('Chyba při načítání zpráv.', 'error');
  });
}

/* ════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════ */

function renderMessages() {
  const el = _container?.querySelector('#chat-messages');
  if (!el) return;

  if (!_messages.length) {
    el.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon" aria-hidden="true">💬</span>
        <h2 class="empty-state__title">Žádné zprávy</h2>
        <p class="empty-state__desc">Buď první a popiš co plánuješ!</p>
      </div>`;
    return;
  }

  // Group by calendar date
  const byDate = new Map();
  _messages.forEach(msg => {
    const d   = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date();
    const key = d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(msg);
  });

  let html = '';
  byDate.forEach((msgs, date) => {
    html += `<div class="chat-date-divider"><span>${date}</span></div>`;
    msgs.forEach((msg, idx) => {
      const prev    = msgs[idx - 1];
      const grouped = prev
        && prev.authorUid === msg.authorUid
        && ((msg.createdAt?.toMillis?.() ?? 0) - (prev.createdAt?.toMillis?.() ?? 0)) < 120_000;
      html += buildMessage(msg, grouped);
    });
  });

  const wasAtBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 80;
  el.innerHTML = html;
  if (wasAtBottom) el.scrollTop = el.scrollHeight;
}

function buildMessage(msg, grouped) {
  const author = _members[msg.authorUid] ?? {};
  const isMine = msg.authorUid === state.user?.uid;
  const time   = msg.createdAt?.toDate
    ? msg.createdAt.toDate().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
    : '';
  const text = linkify(esc(msg.text ?? ''));

  return `
    <div class="msg-wrap msg-wrap--${isMine ? 'mine' : 'other'}${grouped ? ' msg-wrap--grouped' : ''}" id="msg-${msg.id}" data-msg-id="${msg.id}">
      ${!grouped
        ? `<div class="msg-avatar" aria-hidden="true">${esc(author.avatar ?? '👤')}</div>`
        : `<div class="msg-avatar-spacer" aria-hidden="true"></div>`}
      <div class="msg-content">
        ${!grouped ? `
          <div class="msg-meta">
            <strong>${esc(author.nickname ?? 'Někdo')}</strong>
            <time class="msg-time">${time}</time>
          </div>` : ''}
        <div class="msg-bubble">
          <p class="msg-text">${text}</p>
          ${isMine ? `
            <button class="msg-delete-btn" data-action="delete" data-id="${msg.id}" title="Smazat zprávu" aria-label="Smazat zprávu">🗑️</button>
          ` : ''}
        </div>
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   SEND / DELETE
   ════════════════════════════════════════════════════════════ */

async function sendMessage() {
  const input = _container?.querySelector('#chat-input');
  const text  = input?.value.trim();
  if (!text || !state.user) return;

  const sendBtn = _container?.querySelector('#btn-send');
  if (sendBtn) sendBtn.disabled = true;

  try {
    await addDoc(collection(db, 'messages'), {
      text,
      authorUid:    state.user.uid,
      authorAvatar: state.profile?.avatar ?? '👤',
      createdAt:    serverTimestamp(),
    });
    if (input) { input.value = ''; input.style.height = 'auto'; }
  } catch (err) {
    console.error('[chat] sendMessage:', err);
    showToast('Zprávu se nepodařilo odeslat.', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    input?.focus();
  }
}

async function deleteMessage(msgId) {
  const ok = await showConfirm('Smazat zprávu', 'Opravdu smazat tuto zprávu?', 'Smazat');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'messages', msgId));
    showToast('Zpráva smazána.', 'success');
  } catch (err) {
    console.error('[chat] delete:', err);
    showToast('Nepodařilo se smazat zprávu.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   EVENT LISTENERS
   ════════════════════════════════════════════════════════════ */

function setupListeners() {
  const input   = _container.querySelector('#chat-input');
  const sendBtn = _container.querySelector('#btn-send');

  input?.addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  sendBtn?.addEventListener('click', sendMessage);

  // Event delegation for delete buttons rendered inside messages
  _container.querySelector('#chat-messages')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="delete"]');
    if (btn) deleteMessage(btn.dataset.id);
  });
}

/* ════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════ */

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkify(html) {
  return html.replace(/(https?:\/\/[^\s&<>"]+)/g,
    url => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="msg-link">${url}</a>`
  );
}
