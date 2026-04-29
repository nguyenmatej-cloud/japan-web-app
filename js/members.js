/**
 * members.js – Stránka se seznamem členů skupiny.
 */
import { db } from './firebase-config.js';
import { state } from './app.js';
import {
  collection, getDocs,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';

let _container = null;

export function render(container) {
  _container = container;

  container.innerHTML = `
    <div class="page" id="members-page">
      <div class="page-header">
        <h1 class="page-header__title">
          <span aria-hidden="true">👥</span>
          Členové
        </h1>
        <p class="page-header__subtitle">
          Kdo s námi letí do Japonska
        </p>
      </div>

      <div class="card">
        <div class="card__header">
          <h2 class="card__title" id="members-title">👥 Načítám…</h2>
        </div>
        <div class="members-grid" id="members-grid">
          <div class="skeleton skeleton--card" style="height:72px"></div>
          <div class="skeleton skeleton--card" style="height:72px"></div>
          <div class="skeleton skeleton--card" style="height:72px"></div>
          <div class="skeleton skeleton--card" style="height:72px"></div>
        </div>
      </div>
    </div>
  `;

  loadMembers().catch(err => console.error('[members] load:', err));

  return () => { _container = null; };
}

/* ════════════════════════════════════════════════════════════
   DATA
   ════════════════════════════════════════════════════════════ */

async function loadMembers() {
  if (!_container) return;

  const [usersSnap, allowedSnap, ideasSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'allowed_users')),
    getDocs(collection(db, 'ideas')),
  ]);

  if (!_container) return;

  const users   = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const allowed = allowedSnap.docs.map(d => ({ email: d.id, ...d.data() }));
  const ideas   = ideasSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Role z allowed_users
  const allowedMap = {};
  allowed.forEach(a => { allowedMap[a.email?.toLowerCase().trim() ?? ''] = a; });
  users.forEach(u => {
    const entry = allowedMap[u.email?.toLowerCase().trim() ?? ''];
    u.role = entry?.role ?? null;
  });

  // Pozvaní bez profilu
  const userEmails  = new Set(users.map(u => u.email?.toLowerCase().trim()));
  const invitedOnly = allowed.filter(a => !userEmails.has(a.email?.toLowerCase().trim()));

  // Statistiky
  const statsMap = {};
  users.forEach(u => { statsMap[u.uid] = { ideaCount: 0, likeCount: 0 }; });
  ideas.forEach(idea => {
    if (statsMap[idea.authorUid]) statsMap[idea.authorUid].ideaCount++;
    (idea.likes ?? []).forEach(uid => { if (statsMap[uid]) statsMap[uid].likeCount++; });
  });

  const totalCount = users.length + invitedOnly.length;
  const titleEl = _container.querySelector('#members-title');
  if (titleEl) titleEl.textContent = `👥 Členové (${totalCount})`;

  renderMembersGrid(users, invitedOnly, statsMap);
}

/* ════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════ */

function renderMembersGrid(users, invitedOnly, statsMap) {
  const gridEl = _container?.querySelector('#members-grid');
  if (!gridEl) return;

  const sorted = [...users].sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return (a.nickname ?? '').localeCompare(b.nickname ?? '', 'cs');
  });

  gridEl.innerHTML = [
    ...sorted.map(u => buildMemberCard(u, statsMap[u.uid] ?? { ideaCount: 0, likeCount: 0 })),
    ...invitedOnly.map(a => buildInvitedCard(a)),
  ].join('');

  // Klik na člena → filtr wishlistu
  gridEl.querySelectorAll('.member-card:not(.member-card--invited)').forEach(card => {
    const nickname = card.dataset.nickname;
    if (!nickname) return;
    card.addEventListener('click', () => {
      sessionStorage.setItem('wl_pending_author', nickname);
      window.location.hash = '#wishlist';
    });
  });
}

function buildMemberCard(user, stats) {
  const isOnline   = isRecentlyActive(user.lastLogin);
  const statusStr  = isOnline ? '🟢 online' : formatLastActive(user.lastLogin);
  const isMe       = user.uid === state.user?.uid;
  const adminBadge = user.role === 'admin'
    ? `<span class="badge badge--admin">⭐ admin</span>` : '';
  const meBadge    = isMe
    ? `<span class="badge" style="background:rgba(79,70,229,.1);color:var(--color-indigo)">já</span>` : '';

  return `
    <div class="member-card" data-uid="${esc(user.uid)}" data-nickname="${esc(user.nickname ?? '')}"
         role="button" tabindex="0" aria-label="Zobrazit nápady od ${esc(user.nickname)}">
      <div class="member-card__avatar" aria-hidden="true">${esc(user.avatar ?? '😊')}</div>
      <div class="member-card__info">
        <strong class="member-card__name">${esc(user.nickname ?? '—')}</strong>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${adminBadge}${meBadge}</div>
        <div class="member-card__status">${statusStr}</div>
      </div>
      <div class="member-card__stats">
        <span title="Nápady na wishlistu">⭐ ${stats.ideaCount}</span>
        <span title="Lajky udělené nápadům">👍 ${stats.likeCount}</span>
      </div>
    </div>
  `;
}

function buildInvitedCard(allowedEntry) {
  const name = (allowedEntry.email ?? '').split('@')[0];
  return `
    <div class="member-card member-card--invited" aria-label="${esc(name)} – pozvaný člen">
      <div class="member-card__avatar" aria-hidden="true">📨</div>
      <div class="member-card__info">
        <strong class="member-card__name">${esc(name)}</strong>
        <span class="badge badge--invited">Pozván</span>
        <div class="member-card__status">Ještě se nepřihlásil/a</div>
      </div>
    </div>
  `;
}

/* ════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════ */

function isRecentlyActive(lastLogin) {
  if (!lastLogin) return false;
  const d = lastLogin.toDate ? lastLogin.toDate() : new Date(lastLogin.seconds * 1000);
  return Date.now() - d.getTime() < 5 * 60_000;
}

function formatLastActive(lastLogin) {
  if (!lastLogin) return 'Nikdy online';
  const d    = lastLogin.toDate ? lastLogin.toDate() : new Date(lastLogin.seconds * 1000);
  const diff = Date.now() - d.getTime();
  if (diff < 3_600_000)       return `před ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000)      return `před ${Math.floor(diff / 3_600_000)} h`;
  if (diff < 7 * 86_400_000)  return `před ${Math.floor(diff / 86_400_000)} dny`;
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short' });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
