/**
 * chat.js – Real-time skupinový chat s reakcemi, reply, online stavem, read receipts.
 */
import { db } from './firebase-config.js';
import { state, showToast, showConfirm } from './app.js';
import {
  collection, query, orderBy, limit, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
  getDocs, setDoc, arrayUnion,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MSG_LIMIT  = 100;

let _messages         = [];
let _users            = {};
let _msgsUnsub        = null;
let _onlineUnsub      = null;
let _replyTo          = null;
let _container        = null;
let _isAtBottom       = true;
let _newMsgCount      = 0;
let _onlineUsers      = new Set();
let _onlineHeartbeat  = null;

/* ════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════ */

export function render(container) {
  _container = container;
  _messages  = [];

  container.innerHTML = `
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

        <button class="scroll-to-bottom-btn hidden" id="btn-scroll-bottom" title="Skočit na nejnovější">
          <span class="scroll-arrow">⬇</span>
          <span class="scroll-badge" id="scroll-new-count" hidden>0</span>
        </button>

        <div class="reply-preview hidden" id="reply-preview">
          <div class="reply-preview__content">
            <strong>↩️ Odpověď na:</strong>
            <span id="reply-preview-text"></span>
          </div>
          <button class="reply-preview__close" id="btn-cancel-reply" aria-label="Zrušit odpověď">×</button>
        </div>

        <div class="chat-input-area">
          <textarea id="chat-input" class="chat-input"
            placeholder="Napiš zprávu… (Enter = odeslat, Shift+Enter = nový řádek)"
            rows="1" aria-label="Zpráva" maxlength="2000"></textarea>
          <button class="chat-send-btn" id="btn-send" title="Odeslat (Enter)" aria-label="Odeslat">➤</button>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    _setupListeners();
    _loadUsers().then(() => {
      _setupRealTimeListeners();
      _setupOnlineStatus();
      _markAsRead();
      const input = _container?.querySelector('#chat-input');
      if (input && window.innerWidth > 1024) input.focus();
    });
  }, 100);

  return _cleanup;
}

/* ════════════════════════════════════════════════════════════
   USERS
   ════════════════════════════════════════════════════════════ */

async function _loadUsers() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    _users = {};
    snap.docs.forEach(d => { _users[d.id] = { uid: d.id, ...d.data() }; });
  } catch (err) {
    console.error('[chat] loadUsers:', err);
  }
}

/* ════════════════════════════════════════════════════════════
   REAL-TIME MESSAGES
   ════════════════════════════════════════════════════════════ */

function _setupRealTimeListeners() {
  _msgsUnsub?.();
  const q = query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(MSG_LIMIT));
  _msgsUnsub = onSnapshot(q, (snap) => {
    const prevLen = _messages.length;
    _messages = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();

    const isNew = _messages.length > prevLen && prevLen > 0;
    _renderMessages(isNew);

    if (isNew) {
      const last = _messages[_messages.length - 1];
      if (last.authorUid !== state.user?.uid && !_isAtBottom) {
        _newMsgCount++;
        _updateScrollButton();
      } else if (_isAtBottom) {
        _markAsRead();
      }
    }
  }, (err) => {
    console.error('[chat] snapshot:', err);
    showToast('Chyba při načítání zpráv.', 'error');
  });
}

/* ════════════════════════════════════════════════════════════
   ONLINE STATUS
   ════════════════════════════════════════════════════════════ */

function _setupOnlineStatus() {
  if (!state.user) return;
  _setOnlineStatus(true);
  _onlineHeartbeat = setInterval(() => _setOnlineStatus(true), 30_000);

  _onlineUnsub?.();
  _onlineUnsub = onSnapshot(collection(db, 'presence'), (snap) => {
    const now = Date.now();
    _onlineUsers = new Set();
    snap.docs.forEach(d => {
      const data = d.data();
      const t = data.lastActive?.toMillis ? data.lastActive.toMillis() : 0;
      if (now - t < 60_000) _onlineUsers.add(data.userId);
    });
    _renderMessages(false);
  }, () => {}); // silent — presence is optional

  window.addEventListener('beforeunload', () => _setOnlineStatus(false));
}

async function _setOnlineStatus(online) {
  if (!state.user) return;
  try {
    await setDoc(doc(db, 'presence', state.user.uid), {
      userId:     state.user.uid,
      online,
      lastActive: serverTimestamp(),
    });
  } catch { /* silent */ }
}

/* ════════════════════════════════════════════════════════════
   READ RECEIPTS
   ════════════════════════════════════════════════════════════ */

async function _markAsRead() {
  if (!state.user) return;
  try {
    await setDoc(doc(db, 'chatRead', state.user.uid), {
      userId:            state.user.uid,
      lastReadAt:        serverTimestamp(),
      lastReadMessageId: _messages[_messages.length - 1]?.id || null,
    });

    const unread = _messages.slice(-20).filter(m =>
      m.authorUid !== state.user?.uid &&
      !(m.readBy || []).includes(state.user.uid)
    );
    for (const msg of unread) {
      updateDoc(doc(db, 'messages', msg.id), { readBy: arrayUnion(state.user.uid) }).catch(() => {});
    }

    _newMsgCount = 0;
    _updateScrollButton();
    _updateUnreadBadge();
  } catch (err) {
    console.error('[chat] markAsRead:', err);
  }
}

function _updateUnreadBadge() {
  const item = document.querySelector('.sidebar__nav-item[data-route="chat"]');
  if (!item) return;

  let badge = item.querySelector('.sidebar-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'sidebar-badge';
    item.appendChild(badge);
  }
  badge.textContent = _newMsgCount;
  badge.classList.toggle('hidden', _newMsgCount === 0);
}

/* ════════════════════════════════════════════════════════════
   RENDER MESSAGES
   ════════════════════════════════════════════════════════════ */

function _renderMessages(isNew) {
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
      const grouped = prev && prev.authorUid === msg.authorUid
        && ((msg.createdAt?.toMillis?.() ?? 0) - (prev.createdAt?.toMillis?.() ?? 0)) < 60_000;
      const isLast  = idx === msgs.length - 1;
      html += _buildMessage(msg, grouped, isLast);
    });
  });

  const wasAtBottom = _isAtBottom;
  el.innerHTML = html;

  if (wasAtBottom || (isNew && _messages[_messages.length - 1]?.authorUid === state.user?.uid)) {
    el.scrollTop = el.scrollHeight;
  }

  _attachHandlers();
}

function _buildMessage(msg, grouped, isLast) {
  const author   = _users[msg.authorUid] ?? {};
  const isMine   = msg.authorUid === state.user?.uid;
  const isOnline = _onlineUsers.has(msg.authorUid);
  const time     = msg.createdAt?.toDate
    ? msg.createdAt.toDate().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
    : '';

  // Reply context
  let replyHtml = '';
  if (msg.replyTo) {
    const origin = _messages.find(m => m.id === msg.replyTo);
    if (origin) {
      const oa = _users[origin.authorUid] ?? {};
      replyHtml = `
        <div class="msg-reply" onclick="document.getElementById('msg-${origin.id}')?.scrollIntoView({behavior:'smooth',block:'center'})">
          <strong>${oa.avatar ?? '👤'} ${_esc(oa.nickname ?? 'Někdo')}</strong>
          <span>${_esc((origin.text ?? '').substring(0, 60))}${(origin.text?.length ?? 0) > 60 ? '…' : ''}</span>
        </div>`;
    }
  }

  // Reactions
  const rxMap = {};
  (msg.reactions ?? []).forEach(r => {
    if (!rxMap[r.emoji]) rxMap[r.emoji] = [];
    rxMap[r.emoji].push(r.userId);
  });
  const reactionsHtml = Object.entries(rxMap).map(([emoji, uids]) => `
    <button class="msg-reaction ${uids.includes(state.user?.uid) ? 'msg-reaction--mine' : ''}"
            data-msg-id="${msg.id}" data-emoji="${emoji}">
      ${emoji} ${uids.length}
    </button>`).join('');

  // Read receipts (own messages only, last in group)
  let readHtml = '';
  if (isMine && isLast && msg.readBy?.length > 0) {
    const readers = msg.readBy.filter(uid => uid !== state.user?.uid).map(uid => _users[uid]).filter(Boolean);
    if (readers.length) {
      readHtml = `
        <div class="msg-read-receipts">
          <span>✓ Četli:</span>
          ${readers.slice(0, 5).map(u => `<span class="msg-read-avatar" title="${_esc(u.nickname ?? '')}">${u.avatar ?? '👤'}</span>`).join('')}
          ${readers.length > 5 ? `<span class="msg-read-more">+${readers.length - 5}</span>` : ''}
        </div>`;
    }
  }

  const text = _linkify(_esc(msg.text ?? ''));

  return `
    <div class="msg-wrap msg-wrap--${isMine ? 'mine' : 'other'}${grouped ? ' msg-wrap--grouped' : ''}" id="msg-${msg.id}" data-msg-id="${msg.id}">
      ${!grouped
        ? `<div class="msg-avatar-wrap">
             <div class="msg-avatar" aria-hidden="true">${_esc(author.avatar ?? '👤')}</div>
             ${isOnline && !isMine ? '<span class="msg-online-dot" title="Online"></span>' : ''}
           </div>`
        : `<div class="msg-avatar-spacer" aria-hidden="true"></div>`}

      <div class="msg-content">
        ${!grouped ? `
          <div class="msg-meta">
            <strong>${_esc(author.nickname ?? 'Někdo')}</strong>
            <time class="msg-time">${time}</time>
          </div>` : ''}

        <div class="msg-bubble">
          ${replyHtml}
          ${text ? `<p class="msg-text">${text}</p>` : ''}

          <div class="msg-actions">
            <button class="msg-action-btn" data-action="reply" data-msg-id="${msg.id}" title="Odpovědět">↩️</button>
            <div class="msg-reactions-picker">
              <button class="msg-action-btn" title="Reakce">😊</button>
              <div class="reactions-popup">
                ${REACTIONS.map(e => `
                  <button class="reaction-pick" data-msg-id="${msg.id}" data-emoji="${e}">${e}</button>
                `).join('')}
              </div>
            </div>
            ${isMine ? `<button class="msg-action-btn" data-action="delete" data-msg-id="${msg.id}" title="Smazat">🗑️</button>` : ''}
          </div>
        </div>

        ${reactionsHtml ? `<div class="msg-reactions">${reactionsHtml}</div>` : ''}
        ${readHtml}
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   EVENT HANDLERS
   ════════════════════════════════════════════════════════════ */

function _attachHandlers() {
  const el = _container?.querySelector('#chat-messages');
  if (!el) return;

  el.querySelectorAll('[data-action="reply"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const msg = _messages.find(m => m.id === btn.dataset.msgId);
      if (!msg) return;
      _replyTo = msg;
      const preview  = _container?.querySelector('#reply-preview');
      const textSpan = _container?.querySelector('#reply-preview-text');
      if (preview && textSpan) {
        const a = _users[msg.authorUid] ?? {};
        textSpan.textContent = `${a.nickname ?? 'Někdo'}: ${(msg.text ?? '').substring(0, 50)}`;
        preview.classList.remove('hidden');
      }
      _container?.querySelector('#chat-input')?.focus();
    });
  });

  el.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm('Smazat zprávu', 'Opravdu smazat tuto zprávu?', 'Smazat');
      if (!ok) return;
      try {
        await deleteDoc(doc(db, 'messages', btn.dataset.msgId));
        showToast('Zpráva smazána.', 'success');
      } catch (err) {
        console.error('[chat] delete:', err);
        showToast('Nepodařilo se smazat zprávu.', 'error');
      }
    });
  });

  el.querySelectorAll('.msg-reaction, .reaction-pick').forEach(btn => {
    btn.addEventListener('click', () => _toggleReaction(btn.dataset.msgId, btn.dataset.emoji));
  });
}

async function _toggleReaction(msgId, emoji) {
  const msg = _messages.find(m => m.id === msgId);
  if (!msg || !state.user) return;

  const reactions  = msg.reactions ?? [];
  const myIdx      = reactions.findIndex(r => r.userId === state.user.uid && r.emoji === emoji);
  const newReactions = myIdx >= 0
    ? reactions.filter((_, i) => i !== myIdx)
    : [...reactions, { userId: state.user.uid, emoji }];

  try {
    await updateDoc(doc(db, 'messages', msgId), { reactions: newReactions });
  } catch (err) {
    console.error('[chat] reaction:', err);
  }
}

/* ════════════════════════════════════════════════════════════
   SEND / CANCEL REPLY
   ════════════════════════════════════════════════════════════ */

async function _sendMessage() {
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
      readBy:       [state.user.uid],
      createdAt:    serverTimestamp(),
    });
    if (input) { input.value = ''; input.style.height = 'auto'; }
    _cancelReply();
  } catch (err) {
    console.error('[chat] sendMessage:', err);
    showToast('Zprávu se nepodařilo odeslat.', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    input?.focus();
  }
}

function _cancelReply() {
  _replyTo = null;
  _container?.querySelector('#reply-preview')?.classList.add('hidden');
}

/* ════════════════════════════════════════════════════════════
   SCROLL
   ════════════════════════════════════════════════════════════ */

function _setupScrollHandler() {
  const msgs      = _container?.querySelector('#chat-messages');
  const scrollBtn = _container?.querySelector('#btn-scroll-bottom');
  if (!msgs || !scrollBtn) return;

  msgs.addEventListener('scroll', () => {
    _isAtBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 100;
    if (_isAtBottom) {
      scrollBtn.classList.add('hidden');
      _newMsgCount = 0;
      _updateScrollButton();
      _markAsRead();
    } else {
      scrollBtn.classList.remove('hidden');
    }
  });

  scrollBtn.addEventListener('click', () => {
    msgs.scrollTop = msgs.scrollHeight;
    _isAtBottom    = true;
    scrollBtn.classList.add('hidden');
    _newMsgCount = 0;
    _updateScrollButton();
    _markAsRead();
  });
}

function _updateScrollButton() {
  const badge = _container?.querySelector('#scroll-new-count');
  if (!badge) return;
  badge.textContent = _newMsgCount;
  badge.hidden = _newMsgCount === 0;
}

/* ════════════════════════════════════════════════════════════
   SETUP LISTENERS
   ════════════════════════════════════════════════════════════ */

function _setupListeners() {
  const input      = _container?.querySelector('#chat-input');
  const sendBtn    = _container?.querySelector('#btn-send');
  const cancelBtn  = _container?.querySelector('#btn-cancel-reply');

  input?.addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendMessage(); }
  });

  sendBtn?.addEventListener('click', _sendMessage);
  cancelBtn?.addEventListener('click', _cancelReply);

  _setupScrollHandler();
}

/* ════════════════════════════════════════════════════════════
   CLEANUP
   ════════════════════════════════════════════════════════════ */

function _cleanup() {
  _msgsUnsub?.();
  _onlineUnsub?.();
  if (_onlineHeartbeat) { clearInterval(_onlineHeartbeat); _onlineHeartbeat = null; }
  _setOnlineStatus(false);
  _msgsUnsub   = null;
  _onlineUnsub = null;
  _container   = null;
  _messages    = [];
}

/* ════════════════════════════════════════════════════════════
   GLOBAL UNREAD TRACKING (volej z app.js po přihlášení)
   ════════════════════════════════════════════════════════════ */

export function trackUnreadGlobally() {
  if (_msgsUnsub) return; // Chat je otevřený — má vlastní listener

  const q = query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(20));
  _msgsUnsub = onSnapshot(q, async (snap) => {
    if (!state.user) return;
    try {
      const readSnap = await getDocs(collection(db, 'chatRead'));
      const myData   = readSnap.docs.find(d => d.id === state.user.uid)?.data();
      const lastRead = myData?.lastReadAt?.toMillis ? myData.lastReadAt.toMillis() : 0;

      let count = 0;
      snap.docs.forEach(d => {
        const msg  = d.data();
        const msgT = msg.createdAt?.toMillis ? msg.createdAt.toMillis() : 0;
        if (msg.authorUid !== state.user?.uid && msgT > lastRead) count++;
      });

      _newMsgCount = count;
      _updateUnreadBadge();
    } catch { /* silent */ }
  }, () => {});
}

/* ════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════ */

function _esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _linkify(html) {
  // YouTube embed preview
  const ytRx = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)[^\s&lt;&gt;"]*)/g;
  html = html.replace(ytRx, (match, url, vid) => `
    <a href="${url}" target="_blank" rel="noopener noreferrer" class="msg-link">${url}</a>
    <div class="msg-link-preview msg-link-preview--youtube" onclick="window.open('${url}','_blank')">
      <img src="https://img.youtube.com/vi/${vid}/mqdefault.jpg" alt="YouTube" loading="lazy"/>
      <div class="msg-link-preview__overlay">▶</div>
    </div>`);

  // Image URL preview
  const imgRx = /(https?:\/\/[^\s&lt;&gt;"]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s&lt;&gt;"]*)?)/gi;
  html = html.replace(imgRx, url => `
    <a href="${url}" target="_blank" rel="noopener noreferrer" class="msg-link">${url}</a>
    <div class="msg-link-preview" onclick="window.open('${url}','_blank')">
      <img src="${url}" alt="Obrázek" loading="lazy"/>
    </div>`);

  // Generic URLs (remaining)
  html = html.replace(/(?<!href=")(https?:\/\/[^\s&lt;&gt;"]+)/g,
    url => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="msg-link">${url}</a>`);

  return html;
}
