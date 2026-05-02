/**
 * itinerary.js – Sakura iOS Calendar redesign
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

const CITY_DEFS = [
  { id: 'tokyo', defaultName: 'Tokio', emoji: '🗼', days: [0,1,2,3,4,5],  color: '#FFB7C5', textColor: '#8B2252' },
  { id: 'kyoto', defaultName: 'Kjóto', emoji: '⛩️',  days: [6,7,8,9,10], color: '#FFDDB8', textColor: '#7A4000' },
  { id: 'osaka', defaultName: 'Osaka', emoji: '🦀',  days: [11,12,13],    color: '#DDD0F8', textColor: '#5A2D91' },
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

let _activities      = [];
let _ideas           = [];
let _users           = {};
let _cities          = {};
let _activitiesUnsub = null;
let _citiesUnsub     = null;
let _selectedDay     = null;
let _container       = null;

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

function _cityForDay(dayIdx) {
  return CITY_DEFS.find(c => c.days.includes(dayIdx));
}

function _getCityName(cityId) {
  const def = CITY_DEFS.find(c => c.id === cityId);
  return _cities[cityId] ?? def?.defaultName ?? cityId;
}

function _cityDateRange(cityDef) {
  const s = new Date(TRIP_START); s.setDate(s.getDate() + cityDef.days[0]);
  const e = new Date(TRIP_START); e.setDate(e.getDate() + cityDef.days[cityDef.days.length - 1]);
  return `${s.getDate()}.–${e.getDate()}.9`;
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
  return CITY_DEFS.map(c => `
    <button class="city-banner" data-city="${c.id}"
            style="--city-color:${c.color};--city-text:${c.textColor}">
      <span class="city-banner__emoji">${c.emoji}</span>
      <span class="city-banner__name">${_esc(_getCityName(c.id))}</span>
      <span class="city-banner__dates">${_cityDateRange(c)}</span>
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
    const date  = new Date(TRIP_START);
    date.setDate(TRIP_START.getDate() + idx);
    const key   = _dayKey(date);
    const acts  = byDay[key] ?? [];
    const city  = _cityForDay(idx);
    const sel   = idx === _selectedDay;

    const dots  = acts.slice(0, 4).map(a => {
      const color = CATEGORY_COLORS[a.category] ?? '#C8A8C8';
      return `<span class="day-dot" style="background:${color}"></span>`;
    }).join('');

    return `
      <div class="day-cell${sel ? ' day-cell--active' : ''}" data-day-idx="${idx}"
           style="--cell-color:${city?.color ?? 'transparent'};--cell-text:${city?.textColor ?? 'inherit'}">
        <span class="day-cell__num">${date.getDate()}</span>
        <div class="day-cell__dots">${dots}</div>
        ${acts.length ? `<span class="day-cell__badge">${acts.length}</span>` : ''}
      </div>`;
  }).join('');
}

function _buildDayDetail(dayIdx) {
  const date     = new Date(TRIP_START);
  date.setDate(TRIP_START.getDate() + dayIdx);
  const key      = _dayKey(date);
  const acts     = _activities.filter(a => a.dayKey === key)
                    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  const city     = _cityForDay(dayIdx);
  const dayNum   = dayIdx + 1;
  const dateLabel = date.toLocaleDateString('cs-CZ', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return `
    <div class="day-detail-card" style="--city-color:${city?.color ?? '#FFB7C5'}">
      <div class="day-detail-card__header">
        <div>
          <h2 class="day-detail-card__title">Den ${dayNum} · ${_esc(_getCityName(city?.id ?? ''))}</h2>
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
    cell.addEventListener('click', () => {
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
}

function _attachCityBannerHandlers() {
  _container?.querySelectorAll('.city-banner').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cityId  = btn.dataset.city;
      const current = _getCityName(cityId);
      const newName = prompt(`Přejmenuj město (${current}):`, current);
      if (newName?.trim() && newName.trim() !== current) {
        await _saveCityName(cityId, newName.trim());
      }
    });
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
      const el = panel.querySelector(sel);
      if (el) el.value = '';
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
    const titleEl = panel.querySelector('#act-title');
    const descEl  = panel.querySelector('#act-desc');
    const placeEl = panel.querySelector('#act-place');
    if (titleEl) titleEl.value = idea.title       ?? '';
    if (descEl)  descEl.value  = idea.description ?? '';
    if (placeEl) placeEl.value = idea.city        ?? '';
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

/* ── Detail panel open/close ────────────────────────────────── */

function _openDetailPanel(dayIdx, scroll) {
  const panel = _container?.querySelector('#day-detail-panel');
  if (!panel) return;

  panel.innerHTML = _buildDayDetail(dayIdx);
  panel.offsetHeight; // force reflow for CSS transition
  panel.classList.add('day-detail-panel--open');
  _attachDetailHandlers();

  if (scroll) {
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
  }
}

function _closeDetailPanel() {
  const panel = _container?.querySelector('#day-detail-panel');
  if (!panel) return;
  panel.classList.remove('day-detail-panel--open');
  setTimeout(() => { if (panel) panel.innerHTML = ''; }, 420);
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

async function _saveCityName(cityId, name) {
  try {
    await setDoc(doc(db, 'itineraryCities', cityId), { name }, { merge: true });
    showToast(`Město přejmenováno na "${name}".`, 'success');
  } catch (err) {
    console.error('[itinerary] saveCityName:', err);
    showToast('Nepodařilo se uložit název.', 'error');
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
  }, err => console.error('[itinerary] snapshot:', err));
}

function _setupCitiesListener() {
  _citiesUnsub?.();
  _citiesUnsub = onSnapshot(collection(db, 'itineraryCities'), snap => {
    _cities = {};
    snap.docs.forEach(d => { _cities[d.id] = d.data().name; });
    // Update banner name text in-place
    CITY_DEFS.forEach(c => {
      const nameEl = _container?.querySelector(`.city-banner[data-city="${c.id}"] .city-banner__name`);
      if (nameEl) nameEl.textContent = _getCityName(c.id);
    });
    // Update open detail panel title
    if (_selectedDay !== null) {
      const city    = _cityForDay(_selectedDay);
      const titleEl = _container?.querySelector('.day-detail-card__title');
      if (titleEl) {
        const dayNum = _selectedDay + 1;
        titleEl.textContent = `Den ${dayNum} · ${_getCityName(city?.id ?? '')}`;
      }
    }
  }, err => console.error('[itinerary] cities snapshot:', err));
}

/* ── Cleanup ────────────────────────────────────────────────── */

function _cleanup() {
  _activitiesUnsub?.();
  _citiesUnsub?.();
  _activitiesUnsub = null;
  _citiesUnsub     = null;
  _container       = null;
  _selectedDay     = null;
}
