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
    <div class="page page--enter" id="dashboard-page">

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

    </div>
  `;

  const intervalId = setInterval(tickCountdowns, 1000);

  function tickCountdowns() {
    const mainEl     = document.getElementById('countdown-main');
    const planningEl = document.getElementById('countdown-planning');
    if (mainEl)     mainEl.innerHTML      = renderCountdownUnits(DEPARTURE);
    if (planningEl) planningEl.textContent = renderCountdownShort(PLANNING_DEADLINE);
  }

  loadDashboardStats().catch(err => console.error('[dashboard] loadStats:', err));

  // Real-time activity feed + stats
  setupActivityFeed();

  return () => {
    clearInterval(intervalId);
    cleanupActivityListeners();
    _container = null;
  };
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD STATS
   ════════════════════════════════════════════════════════════ */

async function loadDashboardStats() {
  if (!_container) return;

  try {
    const [usersSnap, allowedSnap, ideasSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'allowed_users')),
      getDocs(collection(db, 'ideas')),
    ]);

    if (!_container) return;

    const userEmails  = new Set(usersSnap.docs.map(d => d.data().email?.toLowerCase().trim()));
    const invitedOnly = allowedSnap.docs.filter(d => !userEmails.has(d.id.toLowerCase().trim()));
    const totalMembers = usersSnap.size + invitedOnly.length;

    const statMembersEl = _container.querySelector('#stat-members');
    if (statMembersEl) statMembersEl.textContent = totalMembers;

    const statIdeasEl = _container.querySelector('#stat-ideas');
    if (statIdeasEl) statIdeasEl.textContent = ideasSnap.size;
  } catch (err) {
    console.error('[dashboard] loadStats:', err);
  }
}

/* ════════════════════════════════════════════════════════════
   ACTIVITY FEED + REAL-TIME STATS
   ════════════════════════════════════════════════════════════ */

let _activityListeners = [];
let _activityCache = { ideas: [], todos: [], expenses: [], photos: [], messages: [] };
let _usersMap = {};

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function cleanupActivityListeners() {
  console.log(`[activity] Cleaning ${_activityListeners.length} listeners`);
  _activityListeners.forEach(unsub => { try { unsub(); } catch (_) {} });
  _activityListeners = [];
}

function setupActivityFeed() {
  console.log('[activity] Setting up real-time listeners');
  cleanupActivityListeners();
  _activityCache = { ideas: [], todos: [], expenses: [], photos: [], messages: [] };
  _usersMap = {};

  getDocs(collection(db, 'users'))
    .then(snap => {
      snap.docs.forEach(d => { _usersMap[d.id] = { id: d.id, ...d.data() }; });
      console.log(`[activity] Loaded ${Object.keys(_usersMap).length} users`);
      renderActivityFeed();
    })
    .catch(err => console.error('[activity] Users load error:', err));

  // Core kolekce – vždy existují
  ['ideas', 'todos', 'expenses'].forEach(col => setupCollectionListener(col, 10));
  // Volitelné kolekce – graceful failure pokud neexistují
  ['photos', 'messages'].forEach(col => setupCollectionListener(col, 5));

  console.log(`[activity] ${_activityListeners.length} listeners registered`);
}

function setupCollectionListener(col, maxItems) {
  try {
    const q = query(collection(db, col), orderBy('createdAt', 'desc'), limit(maxItems));
    const unsub = onSnapshot(q,
      snap => {
        if (!_container) return;
        console.log(`[activity] ${col} update: ${snap.docs.length} items`);
        _activityCache[col] = snap.docs.map(d => ({ id: d.id, type: col, ...d.data() }));
        renderActivityFeed();
        updateQuickStats();
      },
      err => {
        if (err.code === 'permission-denied' || err.code === 'failed-precondition') {
          console.warn(`[activity] ${col} not available, skipping`);
        } else {
          console.error(`[activity] ${col} listener error:`, err);
        }
      },
    );
    _activityListeners.push(unsub);
  } catch (err) {
    console.error(`[activity] Failed to setup ${col} listener:`, err);
  }
}

function renderActivityFeed() {
  if (!_container) return;
  const feedEl = _container.querySelector('#activity-feed');
  if (!feedEl) return;

  const allActivities = [
    ..._activityCache.ideas,
    ..._activityCache.todos,
    ..._activityCache.expenses,
    ..._activityCache.photos,
    ..._activityCache.messages,
  ].filter(item => item.createdAt)
   .sort((a, b) => {
     const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
     const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
     return tB - tA;
   })
   .slice(0, 20);

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
  return item.authorUid || item.paidByUid || item.createdByUid || item.userId || null;
}

function describeActivity(item) {
  switch (item.type) {
    case 'ideas':
      return { icon: '⭐', action: 'přidal/a nápad', target: item.title || 'bez názvu' };
    case 'todos':
      return {
        icon:   item.done ? '✅' : '📝',
        action: item.done ? 'splnil/a úkol' : 'přidal/a úkol',
        target: item.title || 'bez názvu',
      };
    case 'expenses':
      return {
        icon:   '💰',
        action: 'přidal/a výdaj',
        target: item.description || `${item.amountJpy ?? item.amount ?? ''} JPY`,
      };
    case 'photos':
      return { icon: '📸', action: 'nahrál/a fotku', target: item.caption || item.filename || '' };
    case 'messages':
      return {
        icon:   '💬',
        action: 'napsal/a',
        target: String(item.text || '').slice(0, 60) + (String(item.text || '').length > 60 ? '…' : ''),
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

  const myUid   = state.user?.uid;
  const myTodos = _activityCache.todos.filter(t => t.assignedToUid === myUid && !t.done);
  const todosEl = _container.querySelector('#stat-todos');
  if (todosEl) todosEl.textContent = myTodos.length;

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
