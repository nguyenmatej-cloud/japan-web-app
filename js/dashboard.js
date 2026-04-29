/**
 * dashboard.js – Modul Dashboard (Fáze 1 & 2).
 * Exportuje render(container) → cleanup funkci.
 */
import { db } from './firebase-config.js';
import { state } from './app.js';
import {
  collection, getDocs, query, orderBy, limit, onSnapshot,
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

      <!-- Aktivity feed -->
      <div class="card" style="margin-bottom:16px">
        <div class="card__header">
          <span class="card__title">📰 Poslední aktivita</span>
        </div>
        <div id="activity-feed" class="activity-feed">
          <div class="skeleton skeleton--card" style="height:60px;margin-bottom:8px"></div>
          <div class="skeleton skeleton--card" style="height:60px;margin-bottom:8px"></div>
          <div class="skeleton skeleton--card" style="height:60px"></div>
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

  // Real-time activity feed + stats
  const unsubFns = setupActivityFeed();

  return () => {
    clearInterval(intervalId);
    unsubFns.forEach(fn => fn?.());  // unsubscribe všechny listenery
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
   ACTIVITY FEED + REAL-TIME STATS
   ════════════════════════════════════════════════════════════ */

let _activityCache = {
  ideas:    [],
  expenses: [],
  todos:    [],
};
let _usersMap = {}; // uid → user data (pro avatary, nicknames)

function setupActivityFeed() {
  const unsubFns = [];

  // Načti users mapu (pro avatary v activity feedu)
  getDocs(collection(db, 'users')).then(snap => {
    snap.docs.forEach(d => { _usersMap[d.id] = d.data(); });
    renderActivityFeed();
  }).catch(err => console.error('[dashboard] users load:', err));

  // Real-time listeners pro 3 kolekce
  unsubFns.push(listenToCollection('ideas',    10));
  unsubFns.push(listenToCollection('expenses', 10));
  unsubFns.push(listenToCollection('todos',    10));

  return unsubFns;
}

function listenToCollection(collName, maxItems) {
  try {
    const q = query(
      collection(db, collName),
      orderBy('createdAt', 'desc'),
      limit(maxItems)
    );

    return onSnapshot(q, snap => {
      _activityCache[collName] = snap.docs.map(d => ({
        id:   d.id,
        type: collName,
        ...d.data(),
      }));

      renderActivityFeed();
      updateQuickStats();
    }, err => {
      console.error(`[dashboard] ${collName} listener error:`, err);
    });
  } catch (err) {
    console.error(`[dashboard] Failed to setup ${collName} listener:`, err);
    return null;
  }
}

function renderActivityFeed() {
  if (!_container) return;
  const feedEl = _container.querySelector('#activity-feed');
  if (!feedEl) return;

  const allActivities = [
    ..._activityCache.ideas,
    ..._activityCache.expenses,
    ..._activityCache.todos,
  ].filter(item => item.createdAt)
   .sort((a, b) => {
     const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
     const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
     return tB - tA;
   })
   .slice(0, 10);

  if (allActivities.length === 0) {
    feedEl.innerHTML = `
      <div class="empty-state" style="padding:24px 16px;text-align:center">
        <span class="empty-state__icon" aria-hidden="true" style="font-size:2rem">🌸</span>
        <h3 style="margin-top:8px;font-size:1rem">Zatím žádná aktivita</h3>
        <p style="color:var(--text-secondary);font-size:.875rem">
          Buď první! Přidej nápad, úkol nebo výdaj.
        </p>
      </div>
    `;
    return;
  }

  feedEl.innerHTML = allActivities.map(buildActivityItem).join('');
}

function buildActivityItem(item) {
  const author   = _usersMap[getAuthorUid(item)] || {};
  const avatar   = author.avatar   || item.authorAvatar   || '😊';
  const nickname = author.nickname || item.authorNickname || 'Někdo';

  const { icon, action, target } = describeActivity(item);
  const time = formatRelativeTime(item.createdAt);

  return `
    <div class="activity-item">
      <div class="activity-item__avatar" aria-hidden="true">${esc(avatar)}</div>
      <div class="activity-item__content">
        <div class="activity-item__text">
          <span class="activity-item__author">${esc(nickname)}</span>
          <span class="activity-item__action">${action}</span>
          <span class="activity-item__icon">${icon}</span>
          <span class="activity-item__target">&ldquo;${esc(target)}&rdquo;</span>
        </div>
        <div class="activity-item__time">${time}</div>
      </div>
    </div>
  `;
}

function getAuthorUid(item) {
  return item.authorUid || item.paidByUid || item.createdByUid || null;
}

function describeActivity(item) {
  switch (item.type) {
    case 'ideas':
      return { icon: '⭐', action: 'přidal/a nápad', target: item.title || 'bez názvu' };
    case 'expenses':
      return {
        icon:   '💰',
        action: 'přidal/a výdaj',
        target: item.description || `${item.amountJpy ?? item.amount ?? ''} JPY`,
      };
    case 'todos':
      return {
        icon:   item.done ? '✅' : '📝',
        action: item.done ? 'splnil/a úkol' : 'přidal/a úkol',
        target: item.title || 'bez názvu',
      };
    default:
      return { icon: '📝', action: 'aktivita', target: '—' };
  }
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const d    = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000)          return 'právě teď';
  if (diff < 3_600_000)       return `před ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000)      return `před ${Math.floor(diff / 3_600_000)} h`;
  if (diff < 7 * 86_400_000)  return `před ${Math.floor(diff / 86_400_000)} dny`;
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short' });
}

function updateQuickStats() {
  if (!_container) return;

  // Moje otevřené úkoly přiřazené mně (todos.js ukládá pole `done: boolean`)
  const myUid    = state.user?.uid;
  const myTodos  = _activityCache.todos.filter(t =>
    t.assignedToUid === myUid && !t.done
  );
  const todosEl  = _container.querySelector('#stat-todos');
  if (todosEl) todosEl.textContent = myTodos.length;

  // Celkový počet výdajů (limit 10 z listeneru – zobraz přesný počet z cache)
  const expensesEl = _container.querySelector('#stat-expenses');
  if (expensesEl) expensesEl.textContent = _activityCache.expenses.length;
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
