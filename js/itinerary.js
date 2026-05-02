/**
 * itinerary.js – Sakura iOS Calendar + editable cities
 */
import { db } from './firebase-config.js';
import { state, showToast, showConfirm } from './app.js';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDocs, setDoc,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';

/* ── Constants ──────────────────────────────────────────────── */

const TRIP_START = new Date(2026, 8, 7); // Mon 7.9.2026
const TRIP_DAYS  = 14;

// Default city per calendar day (dayKey → city object)
const DEFAULT_CITIES = {
  '2026-09-07': { name: 'Tokio',    emoji: '🏙️', color: '#FFD9E2', textColor: '#C2185B' },
  '2026-09-08': { name: 'Tokio',    emoji: '🏙️', color: '#FFD9E2', textColor: '#C2185B' },
  '2026-09-09': { name: 'Tokio',    emoji: '🏙️', color: '#FFD9E2', textColor: '#C2185B' },
  '2026-09-10': { name: 'Tokio',    emoji: '🏙️', color: '#FFD9E2', textColor: '#C2185B' },
  '2026-09-11': { name: 'Tokio',    emoji: '🏙️', color: '#FFD9E2', textColor: '#C2185B' },
  '2026-09-12': { name: 'Tokio',    emoji: '🏙️', color: '#FFD9E2', textColor: '#C2185B' },
  '2026-09-13': { name: 'Kjóto',   emoji: '⛩️', color: '#FFE4C4', textColor: '#D2691E' },
  '2026-09-14': { name: 'Kjóto',   emoji: '⛩️', color: '#FFE4C4', textColor: '#D2691E' },
  '2026-09-15': { name: 'Kjóto',   emoji: '⛩️', color: '#FFE4C4', textColor: '#D2691E' },
  '2026-09-16': { name: 'Kjóto',   emoji: '⛩️', color: '#FFE4C4', textColor: '#D2691E' },
  '2026-09-17': { name: 'Kjóto',   emoji: '⛩️', color: '#FFE4C4', textColor: '#D2691E' },
  '2026-09-18': { name: 'Osaka',   emoji: '🐙', color: '#E0BBE4', textColor: '#7B2CBF' },
  '2026-09-19': { name: 'Osaka',   emoji: '🐙', color: '#E0BBE4', textColor: '#7B2CBF' },
  '2026-09-20': { name: 'Osaka',   emoji: '🐙', color: '#E0BBE4', textColor: '#7B2CBF' },
};

const QUICK_CITIES = [
  { name: 'Tokio',     emoji: '🏙️', color: '#FFD9E2', textColor: '#C2185B' },
  { name: 'Kjóto',    emoji: '⛩️', color: '#FFE4C4', textColor: '#D2691E' },
  { name: 'Osaka',    emoji: '🐙', color: '#E0BBE4', textColor: '#7B2CBF' },
  { name: 'Nara',     emoji: '🦌', color: '#C7F0DB', textColor: '#2D7A4F' },
  { name: 'Hiroshima',emoji: '🕊️', color: '#B5D5FF', textColor: '#1E5BBF' },
  { name: 'Hakone',   emoji: '♨️', color: '#FFE4A0', textColor: '#B8860B' },
  { name: 'Nikkó',    emoji: '🌳', color: '#A8E6CF', textColor: '#2D7A4F' },
  { name: 'Kanazawa', emoji: '🏯', color: '#FFD3A5', textColor: '#A0522D' },
];

const CUSTOM_COLORS = [
  { color: '#FFD9E2', textColor: '#C2185B', label: 'Růžová' },
  { color: '#FFE4C4', textColor: '#D2691E', label: 'Oranžová' },
  { color: '#E0BBE4', textColor: '#7B2CBF', label: 'Levandule' },
  { color: '#C7F0DB', textColor: '#2D7A4F', label: 'Mátová' },
  { color: '#B5D5FF', textColor: '#1E5BBF', label: 'Modrá' },
  { color: '#FFE4A0', textColor: '#B8860B', label: 'Žlutá' },
  { color: '#FFB7D5', textColor: '#A0345A', label: 'Sakura' },
  { color: '#FFD3A5', textColor: '#A0522D', label: 'Broskvová' },
];

const CATEGORY_COLORS = {
  chrám:      '#E8A0BF',
  jídlo:      '#FF9966',
  nakupování: '#FFD700',
  park:       '#90EE90',
  muzeum:     '#87CEEB',
  doprava:    '#D3D3D3',
  ubytování:  '#DDA0DD',
  výlet:      '#98FB98',
};

const PETAL_CONFIGS = [
  { dur: 8,    delay: 0    },
  { dur: 10,   delay: 1.5  },
  { dur: 7,    delay: 3    },
  { dur: 9,    delay: 0.5  },
  { dur: 11,   delay: 2    },
  { dur: 8.5,  delay: 4    },
  { dur: 9.5,  delay: 1    },
  { dur: 7.5,  delay: 3.5  },
];

const DURATIONS = [
  { value: 0.5, label: '30 min' },
  { value: 1,   label: '1 h' },
  { value: 1.5, label: '1,5 h' },
  { value: 2,   label: '2 h' },
  { value: 3,   label: '3 h' },
  { value: 4,   label: '4 h' },
  { value: 6,   label: '6 h' },
  { value: 8,   label: 'Celý den' },
];

const STATUS_META = {
  planned: { label: 'Plánováno', icon: '⏳' },
  done:    { label: 'Hotovo',    icon: '✅' },
  skipped: { label: 'Přeskočeno', icon: '⏭️' },
};

/* ── Module state ───────────────────────────────────────────── */

let _activities         = [];
let _ideas              = [];
let _users              = {};
let _cities             = { ...DEFAULT_CITIES };  // per-dayKey city objects
let _activitiesUnsub    = null;
let _citiesUnsub        = null;
let _selectedDay        = null;
let _editingCityDayKey  = null;
let _escHandler         = null;
let _container          = null;

/* ── Public API ─────────────────────────────────────────────── */

export function render(container) {
  _container = container;
  _renderPage();

  setTimeout(() => {
    _loadUsers().then(() => {
      _loadIdeas();
      _setupActivitiesListener();
      _setupCitiesListener();
    });
  }, 100);

  return _cleanup;
}

/* ── Helpers ────────────────────────────────────────────────── */

function _cityForKey(dayKey) {
  return _cities[dayKey] ?? DEFAULT_CITIES[dayKey] ?? { name: '?', emoji: '📍', color: '#eee', textColor: '#333' };
}

// Groups consecutive days with the same city name into banner segments
function _getCityGroups() {
  const groups = [];
  let cur = null;

  for (let i = 0; i < TRIP_DAYS; i++) {
    const date = new Date(TRIP_START);
    date.setDate(TRIP_START.getDate() + i);
    const key  = _dayKey(date);
    const city = _cityForKey(key);

    if (!cur || cur.name !== city.name) {
      if (cur) groups.push(cur);
      cur = { ...city, startIdx: i, dayKeys: [key] };
    } else {
      cur.dayKeys.push(key);
    }
  }
  if (cur) groups.push(cur);
  return groups;
}

function _cityGroupDateRange(group) {
  const s = new Date(TRIP_START); s.setDate(s.getDate() + group.startIdx);
  const e = new Date(TRIP_START); e.setDate(e.getDate() + group.startIdx + group.dayKeys.length - 1);
  return s.getDate() === e.getDate()
    ? `${s.getDate()}.9`
    : `${s.getDate()}.–${e.getDate()}.9`;
}

function _dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function _esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── Full page render ───────────────────────────────────────── */

function _renderPage() {
  if (!_container) return;

  _container.innerHTML = `
    <div class="page page--enter itinerary-sakura">
      ${_buildPetals()}

      <div class="page-header" style="position:relative;z-index:1">
        <h1 class="page-header__title">🌸 Itinerář</h1>
        <p class="page-header__subtitle">7.–20. září 2026 · 14 dní</p>
      </div>

      <div id="itinerary-stats" class="itinerary-stats"></div>

      <div class="city-banners-row" id="city-banners-row">
        ${_buildCityBannersHTML()}
      </div>

      <div class="sakura-calendar">
        <div class="calendar-weekdays">
          ${['Po','Út','St','Čt','Pá','So','Ne'].map(d => `<span>${d}</span>`).join('')}
        </div>
        <div class="sakura-calendar__grid" id="calendar-grid">
          ${_buildGridCells()}
        </div>
      </div>

      <div class="day-detail-panel" id="day-detail-panel"></div>
    </div>`;

  setTimeout(() => {
    _updateStats();
    _attachDayCellHandlers();
    _attachCityBannerHandlers();
    if (_selectedDay !== null) _openDetailPanel(_selectedDay, false);
  }, 50);
}

/* ── Partial updates ────────────────────────────────────────── */

function _refreshCalendarGrid() {
  const gridEl = _container?.querySelector('#calendar-grid');
  if (!gridEl) { _renderPage(); return; }
  gridEl.innerHTML = _buildGridCells();
  _attachDayCellHandlers();
}

function _refreshCityBanners() {
  const rowEl = _container?.querySelector('#city-banners-row');
  if (!rowEl) return;
  rowEl.innerHTML = _buildCityBannersHTML();
  _attachCityBannerHandlers();
}

function _refreshDetailActivities() {
  if (_selectedDay === null) return;
  const panel = _container?.querySelector('#day-detail-panel');
  if (!panel?.classList.contains('day-detail-panel--open')) return;
  const listEl = panel.querySelector('#activities-list');
  if (!listEl) return;

  const date = new Date(TRIP_START);
  date.setDate(TRIP_START.getDate() + _selectedDay);
  const key  = _dayKey(date);
  const acts = _activities.filter(a => a.dayKey === key)
                 .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

  listEl.innerHTML = acts.length === 0
    ? `<div class="empty-state--sakura"><p>🌸 Žádné aktivity – přidej první!</p></div>`
    : acts.map(_buildActivitySakura).join('');

  _attachActivityHandlers(listEl);
}

/* ── Build HTML ─────────────────────────────────────────────── */

function _buildPetals() {
  return `<div class="sakura-petals-bg" aria-hidden="true">
    ${PETAL_CONFIGS.map((c, i) =>
      `<div class="sakura-petal" style="--i:${i};--dur:${c.dur}s;--delay:${c.delay}s">🌸</div>`
    ).join('')}
  </div>`;
}

function _buildCityBannersHTML() {
  return _getCityGroups().map(g => `
    <button class="city-banner" data-day-key="${g.dayKeys[0]}"
            style="--city-color:${g.color};--city-text:${g.textColor}">
      <span class="city-banner__emoji">${g.emoji}</span>
      <span class="city-banner__name">${_esc(g.name)}</span>
      <span class="city-banner__dates">${_cityGroupDateRange(g)}</span>
      <span class="city-banner__edit">✎</span>
    </button>`).join('');
}

function _buildGridCells() {
  const byDay = {};
  _activities.forEach(a => {
    if (!byDay[a.dayKey]) byDay[a.dayKey] = [];
    byDay[a.dayKey].push(a);
  });

  return Array.from({ length: TRIP_DAYS }, (_, idx) => {
    const date = new Date(TRIP_START);
    date.setDate(TRIP_START.getDate() + idx);
    const key  = _dayKey(date);
    const acts = byDay[key] ?? [];
    const city = _cityForKey(key);
    const sel  = idx === _selectedDay;

    const dots = acts.slice(0, 4).map(a => {
      const color = CATEGORY_COLORS[a.category] ?? '#C8A8C8';
      return `<span class="day-dot" style="background:${color}"></span>`;
    }).join('');

    return `
      <div class="day-cell${sel ? ' day-cell--active' : ''}"
           data-day-idx="${idx}" data-day-key="${key}"
           style="--cell-color:${city.color};--cell-text:${city.textColor}">
        <button class="day-edit-btn" data-day-key="${key}" aria-label="Změnit město">✏️</button>
        <span class="day-cell__num">${date.getDate()}</span>
        <div class="day-cell__dots">${dots}</div>
        ${acts.length ? `<span class="day-cell__badge">${acts.length}</span>` : ''}
      </div>`;
  }).join('');
}

function _buildDayDetail(dayIdx) {
  const date      = new Date(TRIP_START);
  date.setDate(TRIP_START.getDate() + dayIdx);
  const key       = _dayKey(date);
  const city      = _cityForKey(key);
  const acts      = _activities.filter(a => a.dayKey === key)
                     .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  const dayNum    = dayIdx + 1;
  const dateLabel = date.toLocaleDateString('cs-CZ', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return `
    <div class="day-detail-card" style="--city-color:${city.color}">
      <div class="day-detail-card__header">
        <div>
          <h2 class="day-detail-card__title">Den ${dayNum} · ${_esc(city.name)}</h2>
          <p class="day-detail-card__date">${dateLabel}</p>
        </div>
        <button class="btn-sakura-ghost" id="btn-close-detail">✕</button>
      </div>

      <button class="add-cta-sakura" id="btn-add-activity">＋ Přidat aktivitu</button>

      <div class="inline-form-sakura" id="add-form" hidden>
        <div class="form-group">
          <label class="form-label">Z Wishlistu</label>
          <select id="act-idea" class="form-input">
            <option value="">-- vlastní --</option>
            ${_ideas.map(i => `<option value="${i.id}">${_esc(i.title)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Název *</label>
          <input id="act-title" type="text" class="form-input" placeholder="Senso-ji Temple" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Čas</label>
            <input id="act-time" type="time" class="form-input" value="09:00" />
          </div>
          <div class="form-group">
            <label class="form-label">Délka</label>
            <select id="act-duration" class="form-input">
              ${DURATIONS.map(d => `<option value="${d.value}"${d.value === 2 ? ' selected' : ''}>${d.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Místo</label>
          <input id="act-place" type="text" class="form-input" placeholder="Asakusa, Tokyo" />
        </div>
        <div class="form-group">
          <label class="form-label">Popis</label>
          <textarea id="act-desc" class="form-input" rows="2" placeholder="Detaily…"></textarea>
        </div>
        <div class="inline-form-sakura__footer">
          <button class="btn btn--ghost" id="btn-cancel-form">Zrušit</button>
          <button class="btn btn--primary" id="btn-save-activity">✅ Přidat</button>
        </div>
      </div>

      <div id="activities-list">
        ${acts.length === 0
          ? `<div class="empty-state--sakura"><p>🌸 Žádné aktivity – přidej první!</p></div>`
          : acts.map(_buildActivitySakura).join('')}
      </div>
    </div>`;
}

function _buildActivitySakura(act) {
  const sm     = STATUS_META[act.status ?? 'planned'];
  const author = _users[act.authorUid] ?? {};
  const isMine = act.authorUid === state.user?.uid;
  const color  = CATEGORY_COLORS[act.category] ?? '#C8A8C8';

  return `
    <div class="activity-sakura activity-sakura--${act.status ?? 'planned'}" style="--act-color:${color}">
      <div class="activity-sakura__bubble">
        <div class="activity-sakura__time">${_esc(act.time ?? '--:--')}</div>
        <div class="activity-sakura__content">
          <div class="activity-sakura__title-row">
            <h3 class="activity-sakura__title">${_esc(act.title)}</h3>
            <button class="activity-sakura__status" data-id="${act.id}" title="${sm.label}">${sm.icon}</button>
          </div>
          ${act.description ? `<p class="activity-sakura__desc">${_esc(act.description)}</p>` : ''}
          <div class="activity-sakura__meta">
            ${act.duration ? `<span class="meta-chip">⏱ ${act.duration} h</span>` : ''}
            ${act.location?.address ? `<span class="meta-chip">📍 ${_esc(act.location.address)}</span>` : ''}
            ${act.ideaId ? `<span class="meta-chip meta-chip--idea">⭐ Wishlist</span>` : ''}
            <span class="meta-chip">${author.avatar ?? '👤'} ${_esc(author.nickname ?? 'Někdo')}</span>
          </div>
        </div>
        ${isMine ? `<button class="activity-sakura__delete" data-id="${act.id}" aria-label="Smazat">🗑️</button>` : ''}
      </div>
    </div>`;
}

/* ── Event handlers ─────────────────────────────────────────── */

function _attachDayCellHandlers() {
  _container?.querySelectorAll('.day-cell').forEach(cell => {
    cell.addEventListener('click', e => {
      if (e.target.closest('.day-edit-btn')) return; // handled separately
      const idx = parseInt(cell.dataset.dayIdx, 10);
      if (_selectedDay === idx) {
        _selectedDay = null;
        _refreshCalendarGrid();
        _closeDetailPanel();
      } else {
        _selectedDay = idx;
        _refreshCalendarGrid();
        _openDetailPanel(idx, true);
      }
    });
  });

  _container?.querySelectorAll('.day-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _openCityEditModal(btn.dataset.dayKey);
    });
  });
}

function _attachCityBannerHandlers() {
  _container?.querySelectorAll('.city-banner').forEach(btn => {
    btn.addEventListener('click', () => _openCityEditModal(btn.dataset.dayKey));
  });
}

function _attachDetailHandlers() {
  const panel = _container?.querySelector('#day-detail-panel');
  if (!panel) return;

  panel.querySelector('#btn-close-detail')?.addEventListener('click', () => {
    _selectedDay = null;
    _refreshCalendarGrid();
    _closeDetailPanel();
  });

  panel.querySelector('#btn-add-activity')?.addEventListener('click', () => {
    const form = panel.querySelector('#add-form');
    if (!form) return;
    form.hidden = false;
    panel.querySelector('#btn-add-activity')?.classList.add('hidden');
    setTimeout(() => form.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  });

  const closeForm = () => {
    const form = panel.querySelector('#add-form');
    if (!form) return;
    form.hidden = true;
    panel.querySelector('#btn-add-activity')?.classList.remove('hidden');
    ['#act-title', '#act-place', '#act-desc'].forEach(sel => {
      const el = panel.querySelector(sel); if (el) el.value = '';
    });
    const t = panel.querySelector('#act-time');
    const d = panel.querySelector('#act-duration');
    const i = panel.querySelector('#act-idea');
    if (t) t.value = '09:00';
    if (d) d.value = '2';
    if (i) i.value = '';
  };

  panel.querySelector('#btn-cancel-form')?.addEventListener('click', closeForm);

  panel.querySelector('#act-idea')?.addEventListener('change', e => {
    const idea = _ideas.find(x => x.id === e.target.value);
    if (!idea) return;
    const t = panel.querySelector('#act-title');
    const desc = panel.querySelector('#act-desc');
    const p = panel.querySelector('#act-place');
    if (t)    t.value    = idea.title       ?? '';
    if (desc) desc.value = idea.description ?? '';
    if (p)    p.value    = idea.city        ?? '';
  });

  panel.querySelector('#btn-save-activity')?.addEventListener('click', _addActivity);

  const listEl = panel.querySelector('#activities-list');
  if (listEl) _attachActivityHandlers(listEl);
}

function _attachActivityHandlers(listEl) {
  listEl.querySelectorAll('.activity-sakura__status').forEach(btn => {
    btn.addEventListener('click', () => _cycleStatus(btn.dataset.id));
  });
  listEl.querySelectorAll('.activity-sakura__delete').forEach(btn => {
    btn.addEventListener('click', () => _deleteActivity(btn.dataset.id));
  });
}

/* ── Detail panel ───────────────────────────────────────────── */

function _openDetailPanel(dayIdx, scroll) {
  const panel = _container?.querySelector('#day-detail-panel');
  if (!panel) return;
  panel.innerHTML = _buildDayDetail(dayIdx);
  panel.offsetHeight; // force reflow
  panel.classList.add('day-detail-panel--open');
  _attachDetailHandlers();
  if (scroll) setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
}

function _closeDetailPanel() {
  const panel = _container?.querySelector('#day-detail-panel');
  if (!panel) return;
  panel.classList.remove('day-detail-panel--open');
  setTimeout(() => { if (panel) panel.innerHTML = ''; }, 420);
}

/* ── City edit modal ────────────────────────────────────────── */

function _openCityEditModal(dayKey) {
  if (!dayKey) return;
  _editingCityDayKey = dayKey;

  const city = _cityForKey(dayKey);
  const [y, m, d] = dayKey.split('-').map(Number);
  const date      = new Date(y, m - 1, d);
  const dayLabel  = date.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });

  const modal = document.createElement('div');
  modal.className = 'city-edit-modal';
  modal.id        = 'city-edit-modal';
  modal.innerHTML = `
    <div class="city-edit-modal__backdrop" data-close></div>
    <div class="city-edit-modal__content">
      <button class="city-edit-modal__close" data-close>×</button>

      <div class="city-edit-modal__header">
        <h2>🌸 Změnit město</h2>
        <p class="city-edit-modal__date">${_esc(dayLabel)}</p>
        <p class="city-edit-modal__current">Aktuálně: <strong>${city.emoji} ${_esc(city.name)}</strong></p>
      </div>

      <div class="city-edit-modal__body">
        <div class="city-edit-section">
          <h3>⚡ Quick select</h3>
          <div class="quick-cities-grid">
            ${QUICK_CITIES.map(c => `
              <button class="quick-city-btn${c.name === city.name ? ' quick-city-btn--active' : ''}"
                      data-name="${_esc(c.name)}" data-emoji="${_esc(c.emoji)}"
                      data-color="${c.color}" data-text-color="${c.textColor}"
                      style="background:${c.color};color:${c.textColor}">
                <span class="quick-city-emoji">${c.emoji}</span>
                <span class="quick-city-name">${_esc(c.name)}</span>
              </button>`).join('')}
          </div>
        </div>

        <div class="city-edit-section">
          <h3>✏️ Vlastní město</h3>
          <div class="form-row">
            <div class="form-group" style="flex:0 0 80px">
              <label class="form-label">Emoji</label>
              <input id="custom-city-emoji" type="text" class="form-input city-emoji-input"
                     maxlength="2" value="${_esc(city.emoji)}" />
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label">Název</label>
              <input id="custom-city-name" type="text" class="form-input"
                     placeholder="Sapporo" value="${_esc(city.name)}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Barva</label>
            <div class="city-color-grid">
              ${CUSTOM_COLORS.map(c => `
                <button class="city-color-btn${city.color === c.color ? ' city-color-btn--active' : ''}"
                        data-color="${c.color}" data-text-color="${c.textColor}"
                        style="background:${c.color};color:${c.textColor}"
                        title="${c.label}">🌸</button>`).join('')}
            </div>
          </div>
          <button class="add-cta-sakura" id="btn-apply-custom">✨ Použít vlastní</button>
        </div>
      </div>

      <div class="city-edit-modal__footer">
        <button class="btn-sakura-ghost" id="btn-reset-cities">🔄 Vrátit default rozložení</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('city-edit-modal--open'));

  // Close handlers
  modal.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', _closeCityEditModal);
  });

  // Quick city
  modal.querySelectorAll('.quick-city-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await _applyCityToDay(dayKey, {
        name:      btn.dataset.name,
        emoji:     btn.dataset.emoji,
        color:     btn.dataset.color,
        textColor: btn.dataset.textColor,
      });
      _closeCityEditModal();
    });
  });

  // Color picker
  let selColor     = city.color;
  let selTextColor = city.textColor;
  modal.querySelectorAll('.city-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.city-color-btn').forEach(b => b.classList.remove('city-color-btn--active'));
      btn.classList.add('city-color-btn--active');
      selColor     = btn.dataset.color;
      selTextColor = btn.dataset.textColor;
    });
  });

  // Apply custom
  modal.querySelector('#btn-apply-custom')?.addEventListener('click', async () => {
    const emoji = modal.querySelector('#custom-city-emoji')?.value.trim() || '📍';
    const name  = modal.querySelector('#custom-city-name')?.value.trim();
    if (!name) { showToast('Vyplň název města.', 'warning'); return; }
    await _applyCityToDay(dayKey, { name, emoji, color: selColor, textColor: selTextColor });
    _closeCityEditModal();
  });

  // Reset
  modal.querySelector('#btn-reset-cities')?.addEventListener('click', _resetCitiesToDefault);

  // ESC
  _escHandler = e => { if (e.key === 'Escape') _closeCityEditModal(); };
  document.addEventListener('keydown', _escHandler);
}

function _closeCityEditModal() {
  const modal = document.getElementById('city-edit-modal');
  if (!modal) return;
  modal.classList.remove('city-edit-modal--open');
  setTimeout(() => modal.remove(), 250);
  if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
  _editingCityDayKey = null;
}

async function _applyCityToDay(dayKey, city) {
  try {
    await setDoc(doc(db, 'itineraryCities', dayKey), {
      dayKey,
      name:      city.name,
      emoji:     city.emoji,
      color:     city.color,
      textColor: city.textColor,
      updatedAt: serverTimestamp(),
    });
    showToast(`${city.emoji} ${city.name} nastaven${city.name.endsWith('a') ? 'a' : ''}!`, 'success');
  } catch (err) {
    console.error('[itinerary] applyCityToDay:', err);
    showToast('Nepodařilo se uložit město.', 'error');
    throw err;
  }
}

async function _resetCitiesToDefault() {
  const ok = await showConfirm(
    'Vrátit default rozložení?',
    'Tokio: 7–12.9 · Kjóto: 13–17.9 · Osaka: 18–20.9\n\nVlastní změny budou ztraceny.',
    'Vrátit'
  );
  if (!ok) return;

  try {
    const snap = await getDocs(collection(db, 'itineraryCities'));
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, 'itineraryCities', d.id))));
    showToast('🔄 Reset na default rozložení!', 'success');
    _closeCityEditModal();
  } catch (err) {
    console.error('[itinerary] resetCities:', err);
    showToast('Chyba při resetu.', 'error');
  }
}

/* ── CRUD ───────────────────────────────────────────────────── */

async function _addActivity() {
  const panel    = _container?.querySelector('#day-detail-panel');
  const title    = panel?.querySelector('#act-title')?.value.trim();
  const time     = panel?.querySelector('#act-time')?.value ?? '09:00';
  const duration = parseFloat(panel?.querySelector('#act-duration')?.value ?? '2');
  const place    = panel?.querySelector('#act-place')?.value.trim();
  const desc     = panel?.querySelector('#act-desc')?.value.trim();
  const ideaId   = panel?.querySelector('#act-idea')?.value || null;

  if (!title) { showToast('Vyplň název aktivity.', 'warning'); return; }

  const date = new Date(TRIP_START);
  date.setDate(TRIP_START.getDate() + _selectedDay);

  let location = place ? { address: place } : null;
  if (ideaId) {
    const idea = _ideas.find(i => i.id === ideaId);
    if (idea?.pinLat != null && idea?.pinLng != null) {
      location = { address: place || idea.city || '', lat: idea.pinLat, lng: idea.pinLng };
    }
  }

  const saveBtn = panel?.querySelector('#btn-save-activity');
  if (saveBtn) saveBtn.disabled = true;

  try {
    await addDoc(collection(db, 'activities'), {
      title,
      description: desc  || null,
      time,
      duration,
      dayKey:    _dayKey(date),
      location:  location ?? null,
      ideaId,
      status:    'planned',
      authorUid: state.user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    showToast('✅ Aktivita přidána!', 'success');
    panel?.querySelector('#btn-cancel-form')?.click();
  } catch (err) {
    console.error('[itinerary] addActivity:', err);
    showToast('Nepodařilo se přidat aktivitu.', 'error');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function _cycleStatus(id) {
  const act  = _activities.find(a => a.id === id);
  if (!act)  return;
  const next = { planned: 'done', done: 'skipped', skipped: 'planned' }[act.status ?? 'planned'];
  try {
    await updateDoc(doc(db, 'activities', id), { status: next, updatedAt: serverTimestamp() });
  } catch (err) { console.error('[itinerary] cycleStatus:', err); }
}

async function _deleteActivity(id) {
  const ok = await showConfirm('Smazat aktivitu', 'Opravdu chceš smazat tuto aktivitu?', 'Smazat');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'activities', id));
    showToast('Aktivita smazána.', 'success');
  } catch (err) {
    console.error('[itinerary] deleteActivity:', err);
    showToast('Nepodařilo se smazat aktivitu.', 'error');
  }
}

/* ── Stats ──────────────────────────────────────────────────── */

function _updateStats() {
  const el = _container?.querySelector('#itinerary-stats');
  if (!el) return;
  const total   = _activities.length;
  const done    = _activities.filter(a => a.status === 'done').length;
  const planned = _activities.filter(a => !a.status || a.status === 'planned').length;
  const perDay  = total > 0 ? (total / TRIP_DAYS).toFixed(1) : '0';

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stats-item"><div class="stats-value">${total}</div><div class="stats-label">aktivit</div></div>
      <div class="stats-item"><div class="stats-value">${perDay}</div><div class="stats-label">/ den</div></div>
      <div class="stats-item stats-item--good"><div class="stats-value">${done}</div><div class="stats-label">✅ hotovo</div></div>
      <div class="stats-item"><div class="stats-value">${planned}</div><div class="stats-label">⏳ plánováno</div></div>
    </div>`;
}

/* ── Data loading ───────────────────────────────────────────── */

async function _loadUsers() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    _users = {};
    snap.docs.forEach(d => { _users[d.id] = { uid: d.id, ...d.data() }; });
  } catch (err) { console.error('[itinerary] loadUsers:', err); }
}

async function _loadIdeas() {
  try {
    const snap = await getDocs(collection(db, 'ideas'));
    _ideas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) { console.error('[itinerary] loadIdeas:', err); }
}

function _setupActivitiesListener() {
  _activitiesUnsub?.();
  const q = query(collection(db, 'activities'), orderBy('createdAt', 'asc'));
  _activitiesUnsub = onSnapshot(q, snap => {
    _activities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _refreshCalendarGrid();
    _refreshDetailActivities();
    _updateStats();
  }, err => console.error('[itinerary] activities snapshot:', err));
}

function _setupCitiesListener() {
  _citiesUnsub?.();
  _citiesUnsub = onSnapshot(collection(db, 'itineraryCities'), snap => {
    // Start fresh from defaults
    _cities = { ...DEFAULT_CITIES };

    // Override with Firestore per-day data
    snap.docs.forEach(d => {
      const dayKey = d.id;
      if (DEFAULT_CITIES[dayKey]) {
        const data = d.data();
        _cities[dayKey] = {
          name:      data.name,
          emoji:     data.emoji,
          color:     data.color,
          textColor: data.textColor,
        };
      }
    });

    _refreshCityBanners();
    _refreshCalendarGrid();

    // Update open detail title
    if (_selectedDay !== null) {
      const date = new Date(TRIP_START);
      date.setDate(TRIP_START.getDate() + _selectedDay);
      const city    = _cityForKey(_dayKey(date));
      const titleEl = _container?.querySelector('.day-detail-card__title');
      if (titleEl) titleEl.textContent = `Den ${_selectedDay + 1} · ${city.name}`;
    }
  }, err => console.error('[itinerary] cities snapshot:', err));
}

/* ── Cleanup ────────────────────────────────────────────────── */

function _cleanup() {
  _activitiesUnsub?.();
  _citiesUnsub?.();
  _activitiesUnsub   = null;
  _citiesUnsub       = null;
  _container         = null;
  _selectedDay       = null;
  _closeCityEditModal();
}
