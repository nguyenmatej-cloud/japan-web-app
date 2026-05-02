/**
 * itinerary.js – 14-denní plán cesty 7.–20. 9. 2026.
 */
import { db } from './firebase-config.js';
import { state, showToast, showConfirm } from './app.js';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDocs,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';

/* ── Konstanty ───────────────────────────────────────────────── */

const TRIP_START = new Date(2026, 8, 7);  // 7. 9. 2026
const TRIP_DAYS  = 14;

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

/* ── Stav modulu ─────────────────────────────────────────────── */

let _activities      = [];
let _ideas           = [];
let _users           = {};
let _activitiesUnsub = null;
let _selectedDay     = null;
let _container       = null;

/* ════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════ */

export function render(container) {
  _container = container;
  _renderPage();

  setTimeout(() => {
    _loadUsers().then(() => {
      _loadIdeas();
      _setupListener();
    });
  }, 100);

  return _cleanup;
}

function _renderPage() {
  if (!_container) return;

  const view = _selectedDay ? _renderDayDetail() : _renderCalendar();

  _container.innerHTML = `
    <div class="page page--enter itinerary-page">
      <div class="page-header">
        <h1 class="page-header__title">🗓️ Itinerář</h1>
        <p class="page-header__subtitle">Plán cesty 7.–20. 9. 2026 (14 dní)</p>
      </div>

      <div class="itinerary-stats" id="itinerary-stats"></div>

      ${view}
    </div>
  `;

  setTimeout(() => {
    _updateStats();
    if (_selectedDay) _attachDayHandlers();
    else _attachCalendarHandlers();
  }, 50);
}

/* ════════════════════════════════════════════════════════════
   CALENDAR VIEW
   ════════════════════════════════════════════════════════════ */

function _renderCalendar() {
  const days = Array.from({ length: TRIP_DAYS }, (_, i) => {
    const d = new Date(TRIP_START);
    d.setDate(TRIP_START.getDate() + i);
    return d;
  });

  const byDay = {};
  _activities.forEach(a => {
    if (!byDay[a.dayKey]) byDay[a.dayKey] = [];
    byDay[a.dayKey].push(a);
  });

  return `
    <div class="itinerary-calendar">
      ${days.map((date, idx) => {
        const key   = _dayKey(date);
        const acts  = byDay[key] ?? [];
        const wday  = date.toLocaleDateString('cs-CZ', { weekday: 'long' });
        const dnum  = date.getDate();
        const month = date.toLocaleDateString('cs-CZ', { month: 'short' });

        return `
          <div class="day-card" data-day-key="${key}">
            <div class="day-card__header">
              <div class="day-card__num">${dnum}.${month}</div>
              <div class="day-card__label">
                <span class="day-card__weekday">${wday}</span>
                <span class="day-card__index">Den ${idx + 1}</span>
              </div>
              <div class="day-card__count">
                ${acts.length ? `<span class="day-card__badge">${acts.length}</span>` : ''}
              </div>
            </div>

            ${acts.length
              ? `<div class="day-card__preview">
                   ${acts.slice(0, 3).map(a => `
                     <div class="day-act-preview">
                       <span class="day-act-time">${_esc(a.time ?? '--:--')}</span>
                       <span class="day-act-name">${_esc(a.title)}</span>
                     </div>`).join('')}
                   ${acts.length > 3 ? `<div class="day-act-more">+${acts.length - 3} další</div>` : ''}
                 </div>`
              : `<div class="day-card__empty"><span>+ Naplánuj aktivity</span></div>`}
          </div>`;
      }).join('')}
    </div>`;
}

function _attachCalendarHandlers() {
  _container?.querySelectorAll('.day-card').forEach(card => {
    card.addEventListener('click', () => {
      const [y, m, d] = card.dataset.dayKey.split('-').map(Number);
      _selectedDay = new Date(y, m - 1, d);
      _renderPage();
    });
  });
}

/* ════════════════════════════════════════════════════════════
   DAY DETAIL VIEW
   ════════════════════════════════════════════════════════════ */

function _renderDayDetail() {
  const key     = _dayKey(_selectedDay);
  const acts    = _activities.filter(a => a.dayKey === key)
                   .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  const dayLabel = _selectedDay.toLocaleDateString('cs-CZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const dayIdx   = Math.floor((_selectedDay - TRIP_START) / 86_400_000) + 1;
  const hasMap   = acts.some(a => a.location?.lat != null);

  return `
    <div class="day-detail">
      <button class="day-detail__back" id="btn-back">← Zpět na kalendář</button>

      <div class="day-detail__header">
        <h2 class="day-detail__title">Den ${dayIdx}</h2>
        <p class="day-detail__date">${dayLabel}</p>
      </div>

      <div class="day-detail__actions">
        <button class="add-cta" id="btn-add-activity">
          <span class="add-cta__plus">+</span>
          <span class="add-cta__text">Přidat aktivitu</span>
        </button>
        ${hasMap ? `<button class="btn btn--ghost" id="btn-show-map">🗺️ Zobrazit na mapě</button>` : ''}
      </div>

      <div class="inline-form" id="add-form" hidden>
        <div class="inline-form__header">
          <h2 class="inline-form__title">➕ Nová aktivita</h2>
          <button class="inline-form__close" id="btn-close-form" aria-label="Zavřít">×</button>
        </div>
        <div class="inline-form__body">
          <div class="form-group">
            <label class="form-label">Z Wishlistu (volitelné)</label>
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
              <label class="form-label">Doba trvání</label>
              <select id="act-duration" class="form-input">
                ${DURATIONS.map(d => `<option value="${d.value}"${d.value === 2 ? ' selected' : ''}>${d.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Místo (volitelné)</label>
            <input id="act-place" type="text" class="form-input" placeholder="Asakusa, Tokyo" />
          </div>
          <div class="form-group">
            <label class="form-label">Popis (volitelné)</label>
            <textarea id="act-desc" class="form-input" rows="2" placeholder="Detaily…"></textarea>
          </div>
        </div>
        <div class="inline-form__footer">
          <button class="btn btn--ghost" id="btn-cancel-form">Zrušit</button>
          <button class="btn btn--primary" id="btn-save-activity">✅ Přidat aktivitu</button>
        </div>
      </div>

      <div class="activities-list">
        ${acts.length === 0
          ? `<div class="empty-state">
               <span class="empty-state__icon" aria-hidden="true">🗓️</span>
               <h2 class="empty-state__title">Žádné aktivity</h2>
               <p class="empty-state__desc">Přidej první aktivitu pro tento den.</p>
             </div>`
          : acts.map(a => _buildActivityCard(a)).join('')}
      </div>

      <div id="day-map-wrap" class="day-map-container" hidden>
        <div id="day-map" class="day-map"></div>
      </div>
    </div>`;
}

function _buildActivityCard(act) {
  const sm     = STATUS_META[act.status ?? 'planned'];
  const author = _users[act.authorUid] ?? {};
  const isMine = act.authorUid === state.user?.uid;

  return `
    <div class="activity-card activity-card--${act.status ?? 'planned'}">
      <div class="activity-card__time">${_esc(act.time ?? '--:--')}</div>

      <div class="activity-card__body">
        <div class="activity-card__title-row">
          <h3 class="activity-card__title">${_esc(act.title)}</h3>
          <button class="activity-card__status-btn" data-id="${act.id}" title="${sm.label}">${sm.icon}</button>
        </div>
        ${act.description ? `<p class="activity-card__desc">${_esc(act.description)}</p>` : ''}
        <div class="activity-card__meta">
          ${act.duration           ? `<span class="meta-chip">⏱ ${act.duration} h</span>` : ''}
          ${act.location?.address  ? `<span class="meta-chip">📍 ${_esc(act.location.address)}</span>` : ''}
          ${act.ideaId             ? `<span class="meta-chip meta-chip--idea">⭐ Z Wishlistu</span>` : ''}
          <span class="meta-chip meta-chip--muted">${author.avatar ?? '👤'} ${_esc(author.nickname ?? 'Někdo')}</span>
        </div>
      </div>

      ${isMine
        ? `<button class="activity-card__delete" data-id="${act.id}" title="Smazat" aria-label="Smazat">🗑️</button>`
        : ''}
    </div>`;
}

function _attachDayHandlers() {
  // Back to calendar
  _container?.querySelector('#btn-back')?.addEventListener('click', () => {
    _selectedDay = null;
    _renderPage();
  });

  // Open form
  _container?.querySelector('#btn-add-activity')?.addEventListener('click', () => {
    const form = _container?.querySelector('#add-form');
    if (!form) return;
    form.hidden = false;
    requestAnimationFrame(() => {
      form.classList.add('inline-form--open');
      setTimeout(() => form.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    });
    _container?.querySelector('#btn-add-activity')?.classList.add('hidden');
  });

  // Close form helper
  const _closeForm = () => {
    const form = _container?.querySelector('#add-form');
    if (!form) return;
    form.classList.remove('inline-form--open');
    setTimeout(() => { form.hidden = true; }, 300);
    _container?.querySelector('#btn-add-activity')?.classList.remove('hidden');
    ['act-title', 'act-place', 'act-desc'].forEach(id => {
      const el = _container?.querySelector(`#${id}`);
      if (el) el.value = '';
    });
    const timeEl = _container?.querySelector('#act-time');
    const durEl  = _container?.querySelector('#act-duration');
    const ideaEl = _container?.querySelector('#act-idea');
    if (timeEl) timeEl.value = '09:00';
    if (durEl)  durEl.value  = '2';
    if (ideaEl) ideaEl.value = '';
  };

  _container?.querySelector('#btn-close-form')?.addEventListener('click', _closeForm);
  _container?.querySelector('#btn-cancel-form')?.addEventListener('click', _closeForm);

  // Wishlist auto-fill
  _container?.querySelector('#act-idea')?.addEventListener('change', e => {
    const idea = _ideas.find(i => i.id === e.target.value);
    if (!idea) return;
    const titleEl = _container?.querySelector('#act-title');
    const descEl  = _container?.querySelector('#act-desc');
    const placeEl = _container?.querySelector('#act-place');
    if (titleEl) titleEl.value = idea.title       ?? '';
    if (descEl)  descEl.value  = idea.description ?? '';
    if (placeEl) placeEl.value = idea.city        ?? '';
  });

  // Save
  _container?.querySelector('#btn-save-activity')?.addEventListener('click', _addActivity);

  // Status + delete
  _container?.querySelectorAll('.activity-card__status-btn').forEach(btn => {
    btn.addEventListener('click', () => _cycleStatus(btn.dataset.id));
  });
  _container?.querySelectorAll('.activity-card__delete').forEach(btn => {
    btn.addEventListener('click', () => _deleteActivity(btn.dataset.id));
  });

  // Day map
  _container?.querySelector('#btn-show-map')?.addEventListener('click', _toggleDayMap);
}

/* ════════════════════════════════════════════════════════════
   ADD / CYCLE / DELETE
   ════════════════════════════════════════════════════════════ */

async function _addActivity() {
  const title    = _container?.querySelector('#act-title')?.value.trim();
  const time     = _container?.querySelector('#act-time')?.value ?? '09:00';
  const duration = parseFloat(_container?.querySelector('#act-duration')?.value ?? '2');
  const place    = _container?.querySelector('#act-place')?.value.trim();
  const desc     = _container?.querySelector('#act-desc')?.value.trim();
  const ideaId   = _container?.querySelector('#act-idea')?.value || null;

  if (!title) { showToast('Vyplň název aktivity.', 'warning'); return; }

  let location = place ? { address: place } : null;
  if (ideaId) {
    const idea = _ideas.find(i => i.id === ideaId);
    if (idea?.pinLat != null && idea?.pinLng != null) {
      location = { address: place || idea.city || '', lat: idea.pinLat, lng: idea.pinLng };
    }
  }

  const saveBtn = _container?.querySelector('#btn-save-activity');
  if (saveBtn) saveBtn.disabled = true;

  try {
    await addDoc(collection(db, 'activities'), {
      title,
      description: desc  || null,
      time,
      duration,
      dayKey:    _dayKey(_selectedDay),
      location:  location ?? null,
      ideaId,
      status:    'planned',
      authorUid: state.user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    showToast('✅ Aktivita přidána!', 'success');
    const form = _container?.querySelector('#add-form');
    if (form) { form.classList.remove('inline-form--open'); setTimeout(() => { form.hidden = true; }, 300); }
    _container?.querySelector('#btn-add-activity')?.classList.remove('hidden');
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

/* ════════════════════════════════════════════════════════════
   DAY MAP
   ════════════════════════════════════════════════════════════ */

function _toggleDayMap() {
  const wrap = _container?.querySelector('#day-map-wrap');
  if (!wrap) return;
  if (wrap.hidden) { wrap.hidden = false; setTimeout(_initDayMap, 100); }
  else             { wrap.hidden = true; }
}

function _initDayMap() {
  const mapEl = _container?.querySelector('#day-map');
  if (!mapEl || !window.L) return;

  const key  = _dayKey(_selectedDay);
  const acts = _activities
    .filter(a => a.dayKey === key && a.location?.lat != null && a.location?.lng != null)
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

  if (!acts.length) return;

  if (mapEl._leaflet_id) { mapEl._leaflet_id = null; mapEl.innerHTML = ''; }

  const map = L.map(mapEl).setView([acts[0].location.lat, acts[0].location.lng], 13);

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    { attribution: '&copy; Esri', maxZoom: 16, crossOrigin: true }
  ).addTo(map);
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    { attribution: '', maxZoom: 16, crossOrigin: true, pane: 'overlayPane' }
  ).addTo(map);

  const points = acts.map((act, idx) => {
    const ll = [act.location.lat, act.location.lng];
    L.marker(ll, {
      icon: L.divIcon({
        className: 'day-route-marker',
        html: `<div class="day-route-num">${idx + 1}</div>`,
        iconSize: [32, 32], iconAnchor: [16, 16],
      }),
    }).bindPopup(`<strong>${_esc(act.title)}</strong><br><small>${_esc(act.time ?? '')} · ${act.duration ?? 0} h</small>`)
      .addTo(map);
    return ll;
  });

  if (points.length > 1) {
    L.polyline(points, { color: '#0A84FF', weight: 3, opacity: 0.7, dashArray: '6,8' }).addTo(map);
  }
  map.fitBounds(points, { padding: [40, 40] });
}

/* ════════════════════════════════════════════════════════════
   STATS
   ════════════════════════════════════════════════════════════ */

function _updateStats() {
  const el = _container?.querySelector('#itinerary-stats');
  if (!el) return;
  const total   = _activities.length;
  const done    = _activities.filter(a => a.status === 'done').length;
  const planned = _activities.filter(a => !a.status || a.status === 'planned').length;
  const perDay  = total > 0 ? (total / TRIP_DAYS).toFixed(1) : '0';

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stats-item">
        <div class="stats-value">${total}</div>
        <div class="stats-label">aktivit</div>
      </div>
      <div class="stats-item">
        <div class="stats-value">${perDay}</div>
        <div class="stats-label">/ den</div>
      </div>
      <div class="stats-item stats-item--good">
        <div class="stats-value">${done}</div>
        <div class="stats-label">✅ hotovo</div>
      </div>
      <div class="stats-item">
        <div class="stats-value">${planned}</div>
        <div class="stats-label">⏳ plánováno</div>
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   DATA LOADING
   ════════════════════════════════════════════════════════════ */

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

function _setupListener() {
  _activitiesUnsub?.();
  const q = query(collection(db, 'activities'), orderBy('createdAt', 'asc'));
  _activitiesUnsub = onSnapshot(q, (snap) => {
    _activities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderPage();
  }, err => console.error('[itinerary] snapshot:', err));
}

/* ════════════════════════════════════════════════════════════
   CLEANUP
   ════════════════════════════════════════════════════════════ */

function _cleanup() {
  _activitiesUnsub?.();
  _activitiesUnsub = null;
  _container       = null;
  _selectedDay     = null;
}

/* ════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════ */

function _dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function _esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
