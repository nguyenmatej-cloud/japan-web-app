/**
 * dashboard.js – Modul Dashboard (Fáze 1 & 2).
 * Exportuje render(container) → cleanup funkci.
 */
import { db } from './firebase-config.js';
import { state } from './app.js';
import {
  collection, getDocs,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';

const DEPARTURE         = new Date('2026-09-07T00:00:00+02:00');
const PLANNING_DEADLINE = new Date('2026-07-22T00:00:00+02:00');

let _container = null;

export function render(container) {
  _container = container;

  const isPlanning = Date.now() < PLANNING_DEADLINE.getTime();
  const nickname   = state.profile?.nickname || 'kamaráde';
  const avatar     = state.profile?.avatar   || '😊';

  container.innerHTML = `
    <div class="page" id="dashboard-page">

      <!-- Hlavní nadpis -->
      <div class="page-header">
        <h1 class="page-header__title">
          <span aria-hidden="true">${avatar}</span>
          Ahoj, ${nickname}!
        </h1>
        <p class="page-header__subtitle">
          ${isPlanning
            ? 'Jste ve Fázi 1 – přidávejte nápady na wishlist!'
            : 'Fáze 2 aktivní – sledujte itinerář a výdaje.'}
        </p>
      </div>

      <!-- Hlavní countdown: odlet -->
      <div class="countdown-card" aria-label="Odpočet do odletu">
        <p class="countdown-card__label">✈️ Odlet do Japonska za</p>
        <div class="countdown-card__units" id="countdown-main" aria-live="polite">
          ${renderCountdownUnits(DEPARTURE)}
        </div>
        <p style="margin-top:16px;opacity:.85;font-size:.85rem">
          7. 9. 2026 – 20. 9. 2026 &nbsp;·&nbsp; Praha → Tokio
        </p>
      </div>

      ${isPlanning ? `
      <!-- Druhý countdown: deadline plánování (jen Fáze 1) -->
      <div class="card" style="margin-bottom:16px" aria-label="Deadline plánování">
        <div class="card__header">
          <span class="card__title">📋 Konec Fáze 1 – Plánování</span>
        </div>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <div id="countdown-planning" style="font-size:1.2rem;font-weight:700;color:var(--color-indigo)" aria-live="polite">
            ${renderCountdownShort(PLANNING_DEADLINE)}
          </div>
          <p style="color:var(--text-secondary);font-size:.875rem;margin:0">
            Po 22. 7. 2026 admin sestaví finální itinerář ze wishlistu.
          </p>
        </div>
      </div>
      ` : ''}

      <!-- Quick stats -->
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card">
          <div class="stat-card__label">Moje úkoly</div>
          <div class="stat-card__value" id="stat-todos">—</div>
          <div class="stat-card__change">čeká na splnění</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Nápady na wishlistu</div>
          <div class="stat-card__value" id="stat-ideas">—</div>
          <div class="stat-card__change">celkem v skupině</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Výdaje skupiny</div>
          <div class="stat-card__value" id="stat-expenses">—</div>
          <div class="stat-card__change">zaznamenaných</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Členů skupiny</div>
          <div class="stat-card__value" id="stat-members">—</div>
          <div class="stat-card__change">přátel z Prahy</div>
        </div>
      </div>

      <!-- Aktivity feed placeholder -->
      <div class="card">
        <div class="card__header">
          <span class="card__title">📰 Poslední aktivita</span>
        </div>
        <div class="empty-state" style="padding:32px 16px">
          <span class="empty-state__icon" aria-hidden="true">🌸</span>
          <h3 class="empty-state__title">Zatím žádná aktivita</h3>
          <p class="empty-state__desc">
            Jakmile začnete přidávat nápady, úkoly nebo výdaje, uvidíš tady přehled poslední aktivity skupiny.
          </p>
          <a href="#wishlist" class="btn btn--primary" style="margin-top:8px">
            ⭐ Přidat první nápad
          </a>
        </div>
      </div>

      <!-- Naše parta – naplní se async -->
      <div id="dashboard-members" class="members-card card" style="margin-top:var(--space-6)">
        <div class="card__header">
          <h2 class="card__title">👥 Naše parta</h2>
        </div>
        <div class="members-grid" id="members-grid">
          <div class="skeleton skeleton--card" style="height:72px"></div>
          <div class="skeleton skeleton--card" style="height:72px"></div>
          <div class="skeleton skeleton--card" style="height:72px"></div>
        </div>
      </div>

    </div>
  `;

  const intervalId = setInterval(tickCountdowns, 1000);

  function tickCountdowns() {
    const mainEl     = document.getElementById('countdown-main');
    const planningEl = document.getElementById('countdown-planning');
    if (mainEl)     mainEl.innerHTML      = renderCountdownUnits(DEPARTURE);
    if (planningEl) planningEl.textContent = renderCountdownShort(PLANNING_DEADLINE);
  }

  loadMembersSection().catch(err => console.error('[dashboard] loadMembers:', err));

  return () => {
    clearInterval(intervalId);
    _container = null;
  };
}

/* ════════════════════════════════════════════════════════════
   MEMBERS SECTION
   ════════════════════════════════════════════════════════════ */

async function loadMembersSection() {
  if (!_container) return;

  const [usersSnap, allowedSnap, ideasSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'allowed_users')),
    getDocs(collection(db, 'ideas')),
  ]);

  if (!_container) return; // uživatel navigoval pryč

  const users   = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const allowed = allowedSnap.docs.map(d => ({ email: d.id, ...d.data() }));
  const ideas   = ideasSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Mapa email → allowed_users data (pro role)
  const allowedMap = {};
  allowed.forEach(a => {
    allowedMap[a.email?.toLowerCase().trim() ?? ''] = a;
  });

  // Přiřaď roli každému aktivnímu uživateli
  users.forEach(u => {
    const entry = allowedMap[u.email?.toLowerCase().trim() ?? ''];
    u.role = entry?.role ?? null;
  });

  // Pozvaní, kteří se ještě nepřihlásili
  const userEmails   = new Set(users.map(u => u.email?.toLowerCase().trim()));
  const invitedOnly  = allowed.filter(a => !userEmails.has(a.email?.toLowerCase().trim()));

  // Statistiky per uživatel
  const statsMap = {};
  users.forEach(u => { statsMap[u.uid] = { ideaCount: 0, likeCount: 0 }; });
  ideas.forEach(idea => {
    if (statsMap[idea.authorUid]) statsMap[idea.authorUid].ideaCount++;
    (idea.likes ?? []).forEach(uid => {
      if (statsMap[uid]) statsMap[uid].likeCount++;
    });
  });

  // Aktualizuj stat-members
  const totalMembers = users.length + invitedOnly.length;
  const statMembersEl = _container.querySelector('#stat-members');
  if (statMembersEl) statMembersEl.textContent = totalMembers;

  // Aktualizuj stat-ideas
  const statIdeasEl = _container.querySelector('#stat-ideas');
  if (statIdeasEl) statIdeasEl.textContent = ideas.length;

  renderMembersGrid(users, invitedOnly, statsMap, totalMembers);
}

function renderMembersGrid(users, invitedOnly, statsMap, totalCount) {
  const headerEl = _container?.querySelector('#dashboard-members .card__title');
  if (headerEl) headerEl.textContent = `👥 Naše parta (${totalCount})`;

  const gridEl = _container?.querySelector('#members-grid');
  if (!gridEl) return;

  // Seřaď aktivní uživatele: admin první, pak podle nickname
  const sorted = [...users].sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return (a.nickname ?? '').localeCompare(b.nickname ?? '', 'cs');
  });

  gridEl.innerHTML = [
    ...sorted.map(u => buildMemberCard(u, statsMap[u.uid] ?? { ideaCount: 0, likeCount: 0 })),
    ...invitedOnly.map(a => buildInvitedCard(a)),
  ].join('');

  // Event listeners – klik na aktivního člena → filtruj wishlist
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
  const isOnline    = isRecentlyActive(user.lastLogin);
  const statusStr   = isOnline
    ? '🟢 online'
    : formatLastActive(user.lastLogin);
  const isMe        = user.uid === state.user?.uid;
  const adminBadge  = user.role === 'admin'
    ? `<span class="badge badge--admin">⭐ admin</span>`
    : '';
  const meBadge     = isMe
    ? `<span class="badge badge--invited" style="background:rgba(79,70,229,.1);color:var(--color-indigo)">já</span>`
    : '';

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

/* ── Helpers ─────────────────────────────────────────────────── */

function isRecentlyActive(lastLogin) {
  if (!lastLogin) return false;
  const d = lastLogin.toDate ? lastLogin.toDate() : new Date(lastLogin.seconds * 1000);
  return Date.now() - d.getTime() < 5 * 60_000;
}

function formatLastActive(lastLogin) {
  if (!lastLogin) return 'Nikdy online';
  const d    = lastLogin.toDate ? lastLogin.toDate() : new Date(lastLogin.seconds * 1000);
  const diff = Date.now() - d.getTime();
  if (diff < 3_600_000)        return `před ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000)       return `před ${Math.floor(diff / 3_600_000)} h`;
  if (diff < 7 * 86_400_000)   return `před ${Math.floor(diff / 86_400_000)} dny`;
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

/* ════════════════════════════════════════════════════════════
   COUNTDOWN HELPERS
   ════════════════════════════════════════════════════════════ */

function renderCountdownUnits(targetDate) {
  const diff = Math.max(0, targetDate.getTime() - Date.now());
  if (diff === 0) return '<span style="font-size:2rem">✈️ Letíme!</span>';

  const days    = Math.floor(diff / 86_400_000);
  const hours   = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000)  / 60_000);
  const seconds = Math.floor((diff % 60_000)      / 1_000);

  return `
    ${unit(days,    'dní')}
    <span class="countdown-sep" aria-hidden="true">:</span>
    ${unit(hours,   'hod')}
    <span class="countdown-sep" aria-hidden="true">:</span>
    ${unit(minutes, 'min')}
    <span class="countdown-sep" aria-hidden="true">:</span>
    ${unit(seconds, 'sek')}
  `;
}

function unit(value, label) {
  return `
    <div class="countdown-unit">
      <span class="countdown-unit__value">${String(value).padStart(2, '0')}</span>
      <span class="countdown-unit__label">${label}</span>
    </div>
  `;
}

function renderCountdownShort(targetDate) {
  const diff = Math.max(0, targetDate.getTime() - Date.now());
  if (diff === 0) return '⏰ Deadline!';
  const days  = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  return `${days} dní a ${hours} hod`;
}
