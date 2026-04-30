/**
 * chat.js – Real-time skupinový chat.
 */
import { db, storage } from './firebase-config.js';
import { state, showToast, showConfirm } from './app.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, limit, onSnapshot, serverTimestamp, getDocs, setDoc,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';
import {
  ref, uploadBytes, getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-storage.js';

const REACTIONS  = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MSG_LIMIT  = 100;

let _messages       = [];
let _members        = {};   // uid → member data
let _msgsUnsub      = null;
let _typingUnsub    = null;
let _replyTo        = null;
let _container      = null;
let _typingTimeout  = null;
let _onEsc          = null;

/* ════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════ */

export function render(container) {
  _container = container;
  _messages  = [];
  _replyTo   = null;

  container.innerHTML = buildShell();

  setupStaticListeners();

  _onEsc = (e) => {
    if (e.key === 'Escape') cancelReply();
  };
  document.addEventListener('keydown', _onEsc);

  loadMembers().then(() => subscribeMessages());
  subscribeTyping();

  return cleanup;
}

function cleanup() {
  if (_onEsc)         { document.removeEventListener('keydown', _onEsc); _onEsc = null; }
  if (_typingTimeout) { clearTimeout(_typingTimeout); _typingTimeout = null; }
  _msgsUnsub?.();
  _typingUnsub?.();
  _msgsUnsub   = null;
  _typingUnsub = null;
  clearTypingStatus();
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
            <div class="skeleton skeleton--card" style="height:64px"></div>
            <div class="skeleton skeleton--card" style="height:64px"></div>
            <div class="skeleton skeleton--card" style="height:64px"></div>
          </div>
        </div>

        <div class="typing-indicator hidden" id="chat-typing">
          <span class="typing-dots"><span></span><span></span><span></span></span>
          <span id="chat-typing-text"></span>
        </div>

        <div class="reply-preview hidden" id="chat-reply-preview">
          <div class="reply-preview__content">
            <strong>Odpověď na:</strong>
            <span id="chat-reply-text"></span>
          </div>
          <button class="reply-preview__close" id="btn-cancel-reply" aria-label="Zrušit odpověď">×</button>
        </div>

        <div class="chat-input-area">
          <button class="chat-attach-btn" id="btn-attach" title="Přidat obrázek" aria-label="Přidat obrázek">📷</button>
          <input type="file" id="chat-file-input" accept="image/*" hidden aria-hidden="true" />
          <textarea id="chat-input" class="chat-input" placeholder="Napiš zprávu…" rows="1"
                    aria-label="Zpráva" maxlength="2000"></textarea>
          <button class="chat-send-btn" id="btn-send" title="Odeslat" aria-label="Odeslat">➤</button>
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
   FIRESTORE LISTENERS
   ════════════════════════════════════════════════════════════ */

function subscribeMessages() {
  _msgsUnsub?.();
  const q = query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(MSG_LIMIT));
  _msgsUnsub = onSnapshot(q, (snap) => {
    _messages = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
    renderMessages();
  }, (err) => {
    console.error('[chat] messages snapshot:', err);
    showToast('Chyba při načítání zpráv.', 'error');
  });
}

function subscribeTyping() {
  _typingUnsub?.();
  _typingUnsub = onSnapshot(collection(db, 'typing'), (snap) => {
    const now     = Date.now();
    const typing  = [];
    snap.docs.forEach(d => {
      const data = d.data();
      if (data.userId === state.user?.uid) return;
      const ms = data.lastTyped?.toMillis?.() ?? 0;
      if (now - ms < 5_000) typing.push(data);
    });
    renderTypingIndicator(typing);
  }, () => {});
}

/* ════════════════════════════════════════════════════════════
   RENDER MESSAGES
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

  // Group by date
  const byDate = new Map();
  _messages.forEach(msg => {
    const d = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date();
    const key = d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(msg);
  });

  let html = '';
  byDate.forEach((msgs, date) => {
    html += `<div class="chat-date-divider"><span>${date}</span></div>`;
    msgs.forEach((msg, idx) => {
      const prev  = msgs[idx - 1];
      const grouped = prev
        && prev.authorUid === msg.authorUid
        && ((msg.createdAt?.toMillis?.() ?? 0) - (prev.createdAt?.toMillis?.() ?? 0)) < 120_000;
      html += buildMessage(msg, grouped);
    });
  });

  const wasAtBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 60;
  el.innerHTML = html;
  if (wasAtBottom) el.scrollTop = el.scrollHeight;
}

function buildMessage(msg, grouped) {
  const author = _members[msg.authorUid] ?? {};
  const isMine = msg.authorUid === state.user?.uid;
  const time   = msg.createdAt?.toDate
    ? msg.createdAt.toDate().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
    : '';

  // Reply context
  let replyHtml = '';
  if (msg.replyTo) {
    const quoted = _messages.find(m => m.id === msg.replyTo);
    if (quoted) {
      const qa = _members[quoted.authorUid] ?? {};
      const qt = (quoted.text || '[obrázek]').slice(0, 60) + (quoted.text?.length > 60 ? '…' : '');
      replyHtml = `
        <div class="msg-reply" data-action="scroll-to" data-target="${quoted.id}">
          <strong>${esc(qa.avatar ?? '👤')} ${esc(qa.nickname ?? 'Někdo')}</strong>
          <span>${esc(qt)}</span>
        </div>`;
    }
  }

  // Image
  const imageHtml = msg.imageUrl
    ? `<div class="msg-image"><img src="${esc(msg.imageUrl)}" alt="Obrázek" loading="lazy" data-action="open-image" data-url="${esc(msg.imageUrl)}" /></div>`
    : '';

  // Reactions
  const byEmoji = {};
  (msg.reactions ?? []).forEach(r => {
    if (!byEmoji[r.emoji]) byEmoji[r.emoji] = [];
    byEmoji[r.emoji].push(r.userId);
  });
  const reactionsHtml = Object.entries(byEmoji).map(([emoji, uids]) => {
    const mine = uids.includes(state.user?.uid);
    return `<button class="msg-reaction${mine ? ' msg-reaction--mine' : ''}" data-action="toggle-reaction" data-id="${msg.id}" data-emoji="${emoji}" aria-pressed="${mine}">${emoji} ${uids.length}</button>`;
  }).join('');

  const text = msg.text ? linkify(esc(msg.text)) : '';

  const reactionPicker = REACTIONS.map(e =>
    `<button class="reaction-pick" data-action="toggle-reaction" data-id="${msg.id}" data-emoji="${e}">${e}</button>`
  ).join('');

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
          ${replyHtml}
          ${imageHtml}
          ${text ? `<p class="msg-text">${text}</p>` : ''}
          <div class="msg-actions" role="toolbar" aria-label="Akce zprávy">
            <button class="msg-action-btn" data-action="reply" data-id="${msg.id}" title="Odpovědět">↩️</button>
            <div class="msg-reactions-picker">
              <button class="msg-action-btn" title="Reakce" aria-haspopup="true">😊</button>
              <div class="reactions-popup" role="menu">${reactionPicker}</div>
            </div>
            ${isMine ? `<button class="msg-action-btn" data-action="delete" data-id="${msg.id}" title="Smazat">🗑️</button>` : ''}
          </div>
        </div>
        ${reactionsHtml ? `<div class="msg-reactions">${reactionsHtml}</div>` : ''}
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   TYPING INDICATOR
   ════════════════════════════════════════════════════════════ */

function renderTypingIndicator(users) {
  const el   = _container?.querySelector('#chat-typing');
  const text = _container?.querySelector('#chat-typing-text');
  if (!el || !text) return;

  if (!users.length) { el.classList.add('hidden'); return; }
  const names = users.map(u => u.displayName || u.nickname || 'Někdo').join(', ');
  text.textContent = `${names} ${users.length === 1 ? 'píše' : 'píší'}…`;
  el.classList.remove('hidden');
}

async function setTypingStatus() {
  if (!state.user) return;
  try {
    await setDoc(doc(db, 'typing', state.user.uid), {
      userId:      state.user.uid,
      displayName: state.profile?.nickname ?? state.user.displayName ?? 'Někdo',
      lastTyped:   serverTimestamp(),
    });
  } catch { /* silent */ }
}

async function clearTypingStatus() {
  if (!state.user) return;
  try { await deleteDoc(doc(db, 'typing', state.user.uid)); } catch { /* silent */ }
}

/* ════════════════════════════════════════════════════════════
   SEND / UPLOAD
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
      replyTo:      _replyTo?.id ?? null,
      reactions:    [],
      createdAt:    serverTimestamp(),
    });
    if (input) { input.value = ''; input.style.height = 'auto'; }
    cancelReply();
    clearTypingStatus();
    if (_typingTimeout) { clearTimeout(_typingTimeout); _typingTimeout = null; }
  } catch (err) {
    console.error('[chat] sendMessage:', err);
    showToast('Zprávu se nepodařilo odeslat.', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    input?.focus();
  }
}

async function uploadImage(file) {
  if (!file || !state.user) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('Obrázek je moc velký (max 5 MB).', 'warning');
    return;
  }

  const attachBtn = _container?.querySelector('#btn-attach');
  const sendBtn   = _container?.querySelector('#btn-send');
  if (attachBtn) attachBtn.innerHTML = '⏳';
  if (sendBtn)   sendBtn.disabled   = true;

  try {
    const path       = `chat/${Date.now()}_${state.user.uid}_${file.name.slice(-30)}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    await addDoc(collection(db, 'messages'), {
      text:         '',
      imageUrl:     url,
      authorUid:    state.user.uid,
      authorAvatar: state.profile?.avatar ?? '👤',
      replyTo:      _replyTo?.id ?? null,
      reactions:    [],
      createdAt:    serverTimestamp(),
    });
    cancelReply();
    showToast('📷 Obrázek odeslán!', 'success');
  } catch (err) {
    console.error('[chat] uploadImage:', err);
    showToast(`Upload selhal: ${err.message}`, 'error');
  } finally {
    if (attachBtn) attachBtn.innerHTML = '📷';
    if (sendBtn)   sendBtn.disabled   = false;
  }
}

/* ════════════════════════════════════════════════════════════
   REACTIONS
   ════════════════════════════════════════════════════════════ */

async function toggleReaction(msgId, emoji) {
  const msg = _messages.find(m => m.id === msgId);
  if (!msg || !state.user) return;

  const uid        = state.user.uid;
  const reactions  = msg.reactions ?? [];
  const alreadyHas = reactions.some(r => r.userId === uid && r.emoji === emoji);
  const updated    = alreadyHas
    ? reactions.filter(r => !(r.userId === uid && r.emoji === emoji))
    : [...reactions, { userId: uid, emoji }];

  try {
    await updateDoc(doc(db, 'messages', msgId), { reactions: updated });
  } catch (err) {
    console.error('[chat] toggleReaction:', err);
  }
}

/* ════════════════════════════════════════════════════════════
   REPLY
   ════════════════════════════════════════════════════════════ */

function setReply(msgId) {
  const msg = _messages.find(m => m.id === msgId);
  if (!msg) return;
  _replyTo = msg;
  const preview = _container?.querySelector('#chat-reply-preview');
  const text    = _container?.querySelector('#chat-reply-text');
  if (text)    text.textContent = (msg.text || '[obrázek]').slice(0, 60);
  preview?.classList.remove('hidden');
  _container?.querySelector('#chat-input')?.focus();
}

function cancelReply() {
  _replyTo = null;
  _container?.querySelector('#chat-reply-preview')?.classList.add('hidden');
}

/* ════════════════════════════════════════════════════════════
   DELETE
   ════════════════════════════════════════════════════════════ */

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

function setupStaticListeners() {
  const input     = _container.querySelector('#chat-input');
  const sendBtn   = _container.querySelector('#btn-send');
  const attachBtn = _container.querySelector('#btn-attach');
  const fileInput = _container.querySelector('#chat-file-input');
  const cancelBtn = _container.querySelector('#btn-cancel-reply');

  input?.addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    setTypingStatus();
    if (_typingTimeout) clearTimeout(_typingTimeout);
    _typingTimeout = setTimeout(() => clearTypingStatus(), 3_000);
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  sendBtn?.addEventListener('click', sendMessage);
  attachBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) uploadImage(f);
    e.target.value = '';
  });
  cancelBtn?.addEventListener('click', cancelReply);

  // Event delegation for dynamic message content
  _container.querySelector('#chat-messages')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, emoji, target, url } = btn.dataset;

    switch (action) {
      case 'reply':            setReply(id); break;
      case 'delete':           deleteMessage(id); break;
      case 'toggle-reaction':  toggleReaction(id, emoji); break;
      case 'scroll-to': {
        const el = _container.querySelector(`#msg-${target}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
      case 'open-image':
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        break;
    }
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
