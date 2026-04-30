/**
 * wishlist.js – Skupinový Wishlist s real-time synchronizací přes Firestore + interaktivní mapa.
 */
import { db } from './firebase-config.js';
import { state, showToast, showConfirm } from './app.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';

/* ── Konstanty ───────────────────────────────────────────────── */

const CATEGORIES = {
  food:       { label: 'Jídlo',     emoji: '🍜' },
  culture:    { label: 'Kultura',   emoji: '⛩️' },
  nature:     { label: 'Příroda',   emoji: '🌸' },
  shopping:   { label: 'Shopping',  emoji: '🛍️' },
  nightlife:  { label: 'Nightlife', emoji: '🍻' },
  experience: { label: 'Zážitky',   emoji: '🎢' },
  transport:  { label: 'Doprava',   emoji: '🚄' },
  stay:       { label: 'Ubytování', emoji: '🏨' },
  other:      { label: 'Ostatní',   emoji: '✨' },
};

const PRIORITIES = {
  must:  { label: 'Must-have',       emoji: '🔴', cssClass: 'priority--must' },
  nice:  { label: 'Nice-to-have',    emoji: '🟡', cssClass: 'priority--nice' },
  maybe: { label: 'Pokud zbyde čas', emoji: '🟢', cssClass: 'priority--maybe' },
};

const MAP_PRESETS = {
  japan: { lat: 37.0,    lng: 137.5,    zoom: 5  },
  tokyo: { lat: 35.6762, lng: 139.6503, zoom: 11 },
  kyoto: { lat: 35.0116, lng: 135.7681, zoom: 12 },
  osaka: { lat: 34.6937, lng: 135.5023, zoom: 12 },
};

const PRIORITY_COLORS = {
  must:  '#EF4444',
  nice:  '#F59E0B',
  maybe: '#22C55E',
};

const GEOCODE_LS_KEY  = 'wl_geocode_v1';
const NOMINATIM_DELAY = 1200; // ms mezi požadavky (usage policy)

/* ── Stav modulu ─────────────────────────────────────────────── */

let _unsubIdeas     = null;
let _unsubComments  = null;
let _editingId      = null;
let _openCommentsId = null;
let _ideasCache     = [];
let _authorsCache   = new Set();
let _citiesCache    = new Set();
let _filters        = { category: '', priority: '', author: '', city: '' };
let _sort           = 'newest';
let _container      = null;
let _onEsc          = null;

// Mapa
let _map                  = null;
let _markers              = new Map(); // ideaId → { marker: L.Marker, priority, city, number }
let _geocodeCache         = null;      // { cityLower: {lat,lng} | null }
let _lastGeocode          = 0;
let _mobileView           = 'list';   // 'list' | 'map'
let _editLocationId       = null;     // ideaId being drag-edited
let _editLocationOriginalLL = null;   // L.LatLng before edit

// Inline form location picker
let _pickerMap      = null;
let _pickerMarker   = null;
let _pickerLocation = null; // { name, lat, lng } | null

// Tile layers
let _mapTileLayer    = null;
let _pickerTileLayer = null;

// User location (jen 1 marker najednou)
let _userLocationMarker = null;
let _userLocationCircle = null;

/* ════════════════════════════════════════════════════════════
   RENDER (entry point)
   ════════════════════════════════════════════════════════════ */

export function render(container) {
  _container      = container;
  _editingId      = null;
  _openCommentsId = null;
  _filters        = { category: '', priority: '', author: '', city: '' };
  _sort           = 'newest';
  _ideasCache     = [];
  _mobileView     = 'list';

  // Pending author filter nastavený z Dashboardu (klik na člena)
  const pendingAuthor = sessionStorage.getItem('wl_pending_author');
  if (pendingAuthor) {
    _filters.author = pendingAuthor;
    sessionStorage.removeItem('wl_pending_author');
  }

  container.innerHTML = buildShell();

  /* Inline form */
  container.querySelector('#wl-btn-add')
    ?.addEventListener('click', () => openInlineForm());
  container.querySelector('#wl-modal-close')
    ?.addEventListener('click', closeInlineForm);
  container.querySelector('#wl-form-cancel')
    ?.addEventListener('click', closeInlineForm);
  container.querySelector('#wl-form')
    ?.addEventListener('submit', handleFormSubmit);

  /* Toolbar */
  setupToolbar();

  /* Mobile view toggle */
  container.querySelector('#wl-view-toggle')
    ?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-wl-view]');
      if (btn) setMobileView(btn.dataset.wlView);
    });

  /* Map presets */
  container.querySelector('#wl-map-presets')
    ?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-preset]');
      if (btn) applyMapPreset(btn.dataset.preset);
    });

  /* Comments panel */
  container.querySelector('#wl-comments-backdrop')
    ?.addEventListener('click', closeCommentsPanel);
  container.querySelector('#wl-comments-close')
    ?.addEventListener('click', closeCommentsPanel);
  container.querySelector('#wl-comment-send')
    ?.addEventListener('click', sendComment);
  container.querySelector('#wl-comment-input')
    ?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); }
    });

  /* Grid – event delegation */
  container.querySelector('#wl-grid')
    ?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) { handleCardAction(btn); return; }
      if (e.target.closest('#wl-reset-filters')) { resetFilters(); return; }
      if (e.target.closest('#wl-empty-add')) { openInlineForm(); return; }
      // Klik na kartu → fokus na mapě
      const card = e.target.closest('.idea-card[data-id]');
      if (card) focusIdeaOnMap(card.dataset.id);
    });

  /* "Zobrazit kartu" z popup mapy */
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-show-card]');
    if (!btn) return;
    const ideaId = btn.dataset.showCard;
    if (_mobileView === 'map') setMobileView('list');
    _map?.closePopup();
    scrollToCard(ideaId);
  });

  /* "Opravit lokaci" z popup mapy */
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit-location]');
    if (!btn) return;
    _map?.closePopup();
    startLocationEdit(btn.dataset.editLocation);
  });

  /* Bannery pro edit lokace */
  container.querySelector('#wl-edit-confirm')?.addEventListener('click', confirmLocationEdit);
  container.querySelector('#wl-edit-cancel')?.addEventListener('click', cancelLocationEdit);

  /* ESC */
  _onEsc = (e) => {
    if (e.key !== 'Escape') return;
    if (_editLocationId) { cancelLocationEdit(); return; }
    const form = _container?.querySelector('#wl-add-form');
    if (form && form.classList.contains('inline-form--open')) { closeInlineForm(); return; }
    const panel = _container?.querySelector('#wl-comments-panel');
    if (panel && !panel.classList.contains('hidden')) { closeCommentsPanel(); }
  };
  document.addEventListener('keydown', _onEsc);

  setupPickerListeners();
  initMap();
  subscribeIdeas();
  return cleanup;
}

function cleanup() {
  if (_editLocationId) finishLocationEdit(true);
  if (_onEsc) {
    document.removeEventListener('keydown', _onEsc);
    _onEsc = null;
  }
  _unsubIdeas?.();
  _unsubIdeas = null;
  _unsubComments?.();
  _unsubComments = null;

  if (_map) {
    _map.remove();
    _map = null;
  }
  _markers.clear();

  _container    = null;
  _ideasCache   = [];
  _authorsCache = new Set();
  _citiesCache  = new Set();
}

/* ── HTML Shell ──────────────────────────────────────────────── */

function buildShell() {
  const categoryOptions = Object.entries(CATEGORIES)
    .map(([k, v]) => `<option value="${k}">${v.emoji} ${v.label}</option>`)
    .join('');
  const priorityOptions = Object.entries(PRIORITIES)
    .map(([k, v]) => `<option value="${k}">${v.emoji} ${v.label}</option>`)
    .join('');

  return `
    <div class="page page--wide page--enter">
      <div class="page-header wishlist-page-header">
        <div>
          <h1 class="page-header__title">⭐ Skupinový Wishlist</h1>
          <p class="page-header__subtitle">Nápady na aktivity, jídlo a místa v Japonsku</p>
        </div>
      </div>

      <!-- CTA: Přidat nápad -->
      <button class="add-cta" id="wl-btn-add">
        <span class="add-cta__plus">+</span>
        <span class="add-cta__text">Přidat nový nápad</span>
      </button>

      <!-- Inline form: přidat / upravit nápad -->
      <div class="inline-form" id="wl-add-form" hidden>
        <div class="inline-form__header">
          <h2 class="inline-form__title" id="wl-form-title">⭐ Nový nápad</h2>
          <button type="button" class="inline-form__close" id="wl-modal-close" aria-label="Zavřít">×</button>
        </div>
        <form id="wl-form" novalidate>
          <div class="inline-form__body">
            <div class="form-group">
              <label for="wl-title" class="form-label">Název <span class="required" aria-label="povinné">*</span></label>
              <input type="text" id="wl-title" class="form-input" placeholder="Např. Ramen v Ichiran" maxlength="100" required autocomplete="off" />
            </div>
            <div class="form-group">
              <label for="wl-desc" class="form-label">Popis <span class="text-muted" style="font-weight:400">(volitelné)</span></label>
              <textarea id="wl-desc" class="form-textarea" placeholder="Proč to chceš zažít? Kde přesně?" maxlength="500"></textarea>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="wl-category" class="form-label">Kategorie <span class="required" aria-label="povinné">*</span></label>
                <select id="wl-category" class="form-select" required>
                  <option value="">— Vybrat —</option>
                  ${categoryOptions}
                </select>
              </div>
              <div class="form-group">
                <label for="wl-priority" class="form-label">Priorita <span class="required" aria-label="povinné">*</span></label>
                <select id="wl-priority" class="form-select" required>
                  <option value="">— Vybrat —</option>
                  ${priorityOptions}
                </select>
              </div>
            </div>
            <!-- Location picker -->
            <div class="form-group form-group--location">
              <label class="form-label">📍 Místo <span class="text-muted" style="font-weight:400">(volitelné)</span></label>
              <div class="location-picker">
                <div class="location-picker__tabs" role="tablist" aria-label="Způsob zadání lokace">
                  <button type="button" class="location-picker__tab active" data-lp-tab="search" role="tab" aria-selected="true">🔍 Hledat</button>
                  <button type="button" class="location-picker__tab" data-lp-tab="address" role="tab" aria-selected="false">📍 Adresa</button>
                  <button type="button" class="location-picker__tab" data-lp-tab="coords" role="tab" aria-selected="false">🌐 Souřadnice</button>
                </div>
                <div class="location-picker__panels">
                  <div class="location-picker__panel active" data-lp-panel="search" role="tabpanel">
                    <div class="location-picker__search">
                      <input type="text" id="lp-search" class="form-input" placeholder="Shibuya Crossing, Tokyo Tower, Mt. Fuji…" autocomplete="off" />
                      <div class="location-picker__suggestions hidden" id="lp-suggestions"></div>
                    </div>
                    <p class="form-hint">💡 Hledá místa po celém světě (preferuje Japonsko)</p>
                  </div>
                  <div class="location-picker__panel" data-lp-panel="address" role="tabpanel" hidden>
                    <div class="location-picker__address-row">
                      <input type="text" id="lp-address" class="form-input" placeholder="1-1 Marunouchi, Chiyoda City, Tokyo 100-8111" />
                      <button type="button" class="btn btn--secondary btn--sm" id="lp-address-go">🔍 Najít</button>
                    </div>
                    <p class="form-hint">💡 Vlepi celou adresu – např. z Google Maps</p>
                  </div>
                  <div class="location-picker__panel" data-lp-panel="coords" role="tabpanel" hidden>
                    <div class="location-picker__coords">
                      <div class="form-row">
                        <div class="form-group">
                          <label class="form-label form-label--sm">Latitude</label>
                          <input type="number" id="lp-lat" class="form-input" placeholder="35.6812" step="0.000001" min="-90" max="90" />
                        </div>
                        <div class="form-group">
                          <label class="form-label form-label--sm">Longitude</label>
                          <input type="number" id="lp-lng" class="form-input" placeholder="139.7671" step="0.000001" min="-180" max="180" />
                        </div>
                      </div>
                      <div class="location-picker__coords-paste">
                        <input type="text" id="lp-paste" class="form-input" placeholder="Nebo vlepi obě: 35.6812, 139.7671" />
                        <button type="button" class="btn btn--secondary btn--sm" id="lp-paste-go">✓</button>
                      </div>
                    </div>
                    <p class="form-hint">💡 Pravý klik v Google Maps → klikni na čísla nahoře</p>
                  </div>
                </div>
                <div class="location-picker__map" id="lp-map"></div>
                <div class="location-picker__selected hidden" id="lp-selected">
                  <span aria-hidden="true">📍</span>
                  <div class="location-picker__selected-info">
                    <strong id="lp-selected-name"></strong>
                    <small id="lp-selected-coords"></small>
                  </div>
                  <button type="button" class="location-picker__clear" id="lp-clear" aria-label="Vymazat lokaci">✕</button>
                </div>
                <p class="form-hint location-picker__hint-pin">💡 <strong>Klikni přímo na mapu</strong> pro přesné umístění nebo přetáhni pin.</p>
              </div>
            </div>
            <!-- Cena + Délka -->
            <div class="form-row">
              <div class="form-group">
                <label for="wl-price" class="form-label">Cena JPY <span class="text-muted" style="font-weight:400">(volitelné)</span></label>
                <input type="number" id="wl-price" class="form-input" placeholder="1500" min="0" max="9999999" />
              </div>
              <div class="form-group">
                <label for="wl-duration" class="form-label">Délka v hodinách <span class="text-muted" style="font-weight:400">(volitelné)</span></label>
                <input type="number" id="wl-duration" class="form-input" placeholder="2" min="0.5" max="72" step="0.5" />
              </div>
            </div>
          </div>
          <div class="inline-form__footer">
            <button type="button" class="btn btn--ghost" id="wl-form-cancel">Zrušit</button>
            <button type="submit" class="btn btn--primary" id="wl-form-submit">Přidat nápad</button>
          </div>
        </form>
      </div>

      <div class="wishlist-toolbar" role="search" aria-label="Filtry a řazení">
        <div class="wishlist-filters">
          <select class="form-select wishlist-filter-select" id="wl-filter-category" aria-label="Filtr kategorie">
            <option value="">Všechny kategorie</option>
            ${categoryOptions}
          </select>
          <select class="form-select wishlist-filter-select" id="wl-filter-priority" aria-label="Filtr priority">
            <option value="">Všechny priority</option>
            ${priorityOptions}
          </select>
          <select class="form-select wishlist-filter-select" id="wl-filter-author" aria-label="Filtr autora">
            <option value="">Všichni autoři</option>
          </select>
          <select class="form-select wishlist-filter-select" id="wl-filter-city" aria-label="Filtr města">
            <option value="">Všechna města</option>
          </select>
        </div>
        <select class="form-select wishlist-sort-select" id="wl-sort" aria-label="Řazení">
          <option value="newest">🕐 Nejnovější</option>
          <option value="likes">👍 Nejvíc lajků</option>
          <option value="cosigns">✋ Nejvíc co-signů</option>
          <option value="alpha">🔤 Abecedně</option>
        </select>
      </div>

      <!-- Mobile: přepínač seznam / mapa (skryto na tablet+) -->
      <div class="wl-view-toggle" id="wl-view-toggle" role="group" aria-label="Přepnout zobrazení">
        <button class="wl-toggle-btn wl-toggle-btn--active" data-wl-view="list">📋 Seznam</button>
        <button class="wl-toggle-btn" data-wl-view="map">🗺️ Mapa</button>
      </div>

      <!-- Tělo stránky: seznam + mapa -->
      <div class="wl-body" id="wl-body">

        <!-- Levý sloupec: seznam -->
        <div class="wl-list-col" id="wl-list-col">
          <p class="wishlist-count" id="wl-count" aria-live="polite"></p>
          <div class="wishlist-grid" id="wl-grid" role="list" aria-label="Seznam nápadů">
            <div class="wl-skeletons" id="wl-loading" aria-label="Načítání…">
              <div class="skeleton skeleton--card" style="height:200px"></div>
              <div class="skeleton skeleton--card" style="height:200px"></div>
              <div class="skeleton skeleton--card" style="height:200px"></div>
            </div>
          </div>
        </div>

        <!-- Pravý sloupec: mapa -->
        <div class="wl-map-col" id="wl-map-col">
          <div class="wl-map-presets" id="wl-map-presets" role="group" aria-label="Přiblížit na oblast">
            <button class="wl-preset-btn" data-preset="japan">🌐 Japonsko</button>
            <button class="wl-preset-btn" data-preset="tokyo">🗼 Tokio</button>
            <button class="wl-preset-btn" data-preset="kyoto">⛩️ Kjóto</button>
            <button class="wl-preset-btn" data-preset="osaka">🏯 Ósaka</button>
          </div>
          <div class="wl-map-wrap">
            <div class="wl-map" id="wl-map" aria-label="Interaktivní mapa Japonska"></div>
            <div class="wl-map-empty hidden" id="wl-map-empty" aria-live="polite">
              <span aria-hidden="true">🗺️</span>
              <p>Přidej nápadům města, ať je vidíš na mapě!</p>
            </div>
            <div class="map-edit-banner hidden" id="wl-edit-banner" role="status">
              <span class="map-edit-banner__msg">✋ Přetáhni pin na správné místo</span>
              <div class="map-edit-banner__actions">
                <button class="btn btn--xs btn--primary" id="wl-edit-confirm">✓ Uložit</button>
                <button class="btn btn--xs btn--ghost" id="wl-edit-cancel">✕ Zrušit</button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- Panel komentářů -->
    <div id="wl-comments-panel" class="comments-panel hidden" role="dialog" aria-modal="true" aria-labelledby="wl-comments-title">
      <div class="comments-panel__backdrop" id="wl-comments-backdrop"></div>
      <div class="comments-panel__inner">
        <div class="comments-panel__header">
          <h3 class="comments-panel__title" id="wl-comments-title">Komentáře</h3>
          <button class="modal__close" id="wl-comments-close" aria-label="Zavřít komentáře">✕</button>
        </div>
        <div class="comments-panel__list" id="wl-comments-list" aria-live="polite"></div>
        <div class="comments-panel__form">
          <input type="text" id="wl-comment-input" class="form-input" placeholder="Napsat komentář…" maxlength="300" autocomplete="off" aria-label="Nový komentář" />
          <button class="btn btn--primary" id="wl-comment-send">Odeslat</button>
        </div>
      </div>
    </div>
  `;
}

/* ════════════════════════════════════════════════════════════
   INLINE FORM
   ════════════════════════════════════════════════════════════ */

function openInlineForm(idea = null) {
  _editingId = idea?.id ?? null;

  const titleEl  = _container.querySelector('#wl-form-title');
  const submitEl = _container.querySelector('#wl-form-submit');

  if (idea) {
    titleEl.textContent  = '✏️ Upravit nápad';
    submitEl.textContent = 'Uložit změny';
    _container.querySelector('#wl-title').value    = idea.title         ?? '';
    _container.querySelector('#wl-desc').value     = idea.description   ?? '';
    _container.querySelector('#wl-category').value = idea.category      ?? '';
    _container.querySelector('#wl-priority').value = idea.priority      ?? '';
    _container.querySelector('#wl-price').value    = idea.priceJpy      ?? '';
    _container.querySelector('#wl-duration').value = idea.durationHours ?? '';
  } else {
    titleEl.textContent  = '⭐ Nový nápad';
    submitEl.textContent = 'Přidat nápad';
    _container.querySelector('#wl-form').reset();
  }

  _container.querySelectorAll('#wl-form .error').forEach(el => el.classList.remove('error'));

  const form = _container.querySelector('#wl-add-form');
  if (!form) return;

  form.hidden = false;
  requestAnimationFrame(() => {
    form.classList.add('inline-form--open');
    setTimeout(() => {
      const rect = form.getBoundingClientRect();
      window.scrollTo({ top: rect.top + window.pageYOffset - 80, behavior: 'smooth' });
    }, 80);
    // Init picker map after element is laid out
    requestAnimationFrame(() => {
      destroyPickerMap();
      initPickerMap();
      if (idea) {
        if (idea.pinLat != null && idea.pinLng != null) {
          setPickerLocation(idea.pinLat, idea.pinLng, idea.city ?? `${idea.pinLat.toFixed(5)}, ${idea.pinLng.toFixed(5)}`);
        } else if (idea.city) {
          const si = _container?.querySelector('#lp-search');
          if (si) si.value = idea.city;
        }
      }
      // Invalidate after max-height animation completes
      setTimeout(() => _pickerMap?.invalidateSize(), 400);
    });
  });

  _container.querySelector('#wl-btn-add')?.classList.add('hidden');
}

function closeInlineForm() {
  destroyPickerMap();

  const form = _container?.querySelector('#wl-add-form');
  if (!form) return;
  form.classList.remove('inline-form--open');
  setTimeout(() => { form.hidden = true; }, 300);

  _editingId = null;
  _container?.querySelector('#wl-btn-add')?.classList.remove('hidden');
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const titleEl    = _container.querySelector('#wl-title');
  const categoryEl = _container.querySelector('#wl-category');
  const priorityEl = _container.querySelector('#wl-priority');

  const title    = titleEl.value.trim();
  const category = categoryEl.value;
  const priority = priorityEl.value;

  let valid = true;
  [[titleEl, !title], [categoryEl, !category], [priorityEl, !priority]].forEach(([el, err]) => {
    el.classList.toggle('error', err);
    if (err) valid = false;
  });

  if (!valid) {
    showToast('Vyplň povinná pole: Název, Kategorie, Priorita.', 'warning');
    if (!title) titleEl.focus();
    return;
  }

  const submitBtn = _container.querySelector('#wl-form-submit');
  submitBtn.disabled = true;

  const priceRaw = _container.querySelector('#wl-price').value;
  const durRaw   = _container.querySelector('#wl-duration').value;

  const payload = {
    title,
    description:   _container.querySelector('#wl-desc').value.trim(),
    category,
    priority,
    city:          _pickerLocation?.name ?? '',
    pinLat:        _pickerLocation?.lat  ?? null,
    pinLng:        _pickerLocation?.lng  ?? null,
    priceJpy:      priceRaw ? Number(priceRaw) : null,
    durationHours: durRaw   ? Number(durRaw)   : null,
    updatedAt:     serverTimestamp(),
  };

  try {
    if (_editingId) {
      await updateDoc(doc(db, 'ideas', _editingId), payload);
      showToast('Nápad upraven! ✏️', 'success');
    } else {
      await addDoc(collection(db, 'ideas'), {
        ...payload,
        authorUid:      state.user.uid,
        authorNickname: state.profile.nickname,
        authorAvatar:   state.profile.avatar ?? '😊',
        likes:          [],
        cosigns:        [],
        createdAt:      serverTimestamp(),
      });
      showToast('Nápad přidán! ⭐', 'success');
    }
    closeInlineForm();
  } catch (err) {
    console.error('[wishlist] save error:', err);
    showToast('Nepodařilo se uložit. Zkontroluj připojení.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════════════
   TOOLBAR
   ════════════════════════════════════════════════════════════ */

function setupToolbar() {
  ['category', 'priority', 'author', 'city'].forEach(key => {
    _container.querySelector(`#wl-filter-${key}`)?.addEventListener('change', (e) => {
      _filters[key] = e.target.value;
      renderGrid();
    });
  });
  _container.querySelector('#wl-sort')?.addEventListener('change', (e) => {
    _sort = e.target.value;
    renderGrid();
  });
}

/* ════════════════════════════════════════════════════════════
   FIRESTORE – IDEAS
   ════════════════════════════════════════════════════════════ */

function subscribeIdeas() {
  const q = query(collection(db, 'ideas'), orderBy('createdAt', 'desc'));
  _unsubIdeas = onSnapshot(q, (snap) => {
    _ideasCache   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _authorsCache = new Set(_ideasCache.map(i => i.authorNickname).filter(Boolean));
    _citiesCache  = new Set(_ideasCache.map(i => i.city).filter(Boolean));
    updateFilterOptions();
    renderGrid();
  }, (err) => {
    console.error('[wishlist] onSnapshot error:', err);
    showToast('Chyba při načítání wishlistu.', 'error');
  });
}

function updateFilterOptions() {
  const authorSel = _container?.querySelector('#wl-filter-author');
  if (authorSel) {
    const cur = _filters.author || authorSel.value;
    authorSel.innerHTML = '<option value="">Všichni autoři</option>'
      + [..._authorsCache].sort().map(a =>
          `<option value="${esc(a)}"${a === cur ? ' selected' : ''}>${esc(a)}</option>`
        ).join('');
  }
  const citySel = _container?.querySelector('#wl-filter-city');
  if (citySel) {
    const cur = citySel.value;
    citySel.innerHTML = '<option value="">Všechna města</option>'
      + [..._citiesCache].sort().map(c =>
          `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(c)}</option>`
        ).join('');
  }
}

/* ── Render grid ─────────────────────────────────────────────── */

function renderGrid() {
  const grid  = _container?.querySelector('#wl-grid');
  const count = _container?.querySelector('#wl-count');
  if (!grid) return;

  _container.querySelector('#wl-loading')?.remove();

  let ideas = [..._ideasCache];

  if (_filters.category) ideas = ideas.filter(i => i.category       === _filters.category);
  if (_filters.priority)  ideas = ideas.filter(i => i.priority       === _filters.priority);
  if (_filters.author)    ideas = ideas.filter(i => i.authorNickname === _filters.author);
  if (_filters.city)      ideas = ideas.filter(i => i.city           === _filters.city);

  switch (_sort) {
    case 'likes':   ideas.sort((a, b) => (b.likes?.length ?? 0)   - (a.likes?.length ?? 0));   break;
    case 'cosigns': ideas.sort((a, b) => (b.cosigns?.length ?? 0) - (a.cosigns?.length ?? 0)); break;
    case 'alpha':   ideas.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', 'cs'));   break;
    default: break;
  }

  if (count) {
    count.textContent = ideas.length
      ? `${ideas.length} ${pluralIdeas(ideas.length)}`
      : '';
  }

  grid.innerHTML = ideas.length
    ? ideas.map((idea, i) => buildIdeaCard(idea, i + 1)).join('')
    : buildEmptyState();

  setupSwipeGestures(ideas);

  // Synchronizuj markery na mapě s filtrovanými nápady
  syncMarkers(ideas);
}

function setupSwipeGestures(ideas) {
  if (!_container) return;
  const cards = _container.querySelectorAll('.idea-card[data-id]');

  cards.forEach(card => {
    let startX = 0, currentX = 0, isDragging = false;

    card.addEventListener('touchstart', (e) => {
      startX     = e.touches[0].clientX;
      isDragging = true;
      card.style.transition = 'none';
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      currentX    = e.touches[0].clientX;
      const diff  = currentX - startX;
      if (Math.abs(diff) > 10) {
        card.style.transform = `translateX(${diff}px)`;
        if (diff > 0) {
          card.style.background = `linear-gradient(90deg, rgba(34,197,94,${Math.min(diff/200, 0.25)}) 0%, transparent 100%)`;
        } else {
          card.style.background = `linear-gradient(270deg, rgba(239,68,68,${Math.min(-diff/200, 0.25)}) 0%, transparent 100%)`;
        }
      }
    }, { passive: true });

    card.addEventListener('touchend', () => {
      if (!isDragging) return;
      isDragging = false;
      const diff  = currentX - startX;

      card.style.transition = 'transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), background 300ms ease';
      card.style.transform  = '';
      card.style.background = '';

      const ideaId = card.dataset.id;
      if (!ideaId) return;

      if (diff > 100) {
        toggleLike(ideaId);
      } else if (diff < -100) {
        const idea = ideas.find(i => i.id === ideaId);
        if (idea?.authorUid === state.user?.uid || state.isAdmin) {
          confirmDelete(ideaId);
        }
      }
    });
  });
}

function pluralIdeas(n) {
  if (n === 1) return 'nápad';
  if (n >= 2 && n <= 4) return 'nápady';
  return 'nápadů';
}

function resetFilters() {
  _filters = { category: '', priority: '', author: '', city: '' };
  ['category', 'priority', 'author', 'city'].forEach(k => {
    const el = _container?.querySelector(`#wl-filter-${k}`);
    if (el) el.value = '';
  });
  renderGrid();
}

/* ── Idea card ───────────────────────────────────────────────── */

function buildIdeaCard(idea, number = null) {
  const uid      = state.user?.uid ?? '';
  const cat      = CATEGORIES[idea.category] ?? { label: idea.category ?? '?', emoji: '✨' };
  const pri      = PRIORITIES[idea.priority] ?? { label: idea.priority ?? '?', emoji: '⚪', cssClass: '' };
  const liked    = idea.likes?.includes(uid);
  const cosigned = idea.cosigns?.includes(uid);
  const canEdit  = idea.authorUid === uid;
  const canDelete = idea.authorUid === uid || state.isAdmin;
  const canAddLocation = !idea.city && (idea.authorUid === uid || state.isAdmin);

  const meta = [];
  if (idea.city)             meta.push(`📍 ${esc(idea.city)}`);
  if (idea.priceJpy != null) meta.push(`💴 ${Number(idea.priceJpy).toLocaleString('cs-CZ')} JPY`);
  if (idea.durationHours != null) meta.push(`⏱️ ${idea.durationHours} h`);

  const timeStr = idea.createdAt?.toDate ? fmtTime(idea.createdAt.toDate()) : '';

  return `
    <article class="idea-card card" role="listitem" data-id="${idea.id}" style="cursor:pointer">
      ${number != null ? `<div class="wish-card__number" data-priority="${idea.priority ?? ''}" aria-label="Pořadí ${number}">${number}</div>` : ''}
      <div class="idea-card__badges">
        <span class="badge badge--indigo"><span aria-hidden="true">${cat.emoji}</span> ${esc(cat.label)}</span>
        <span class="badge ${pri.cssClass}"><span aria-hidden="true">${pri.emoji}</span> ${esc(pri.label)}</span>
      </div>
      <h3 class="idea-card__title">${esc(idea.title)}</h3>
      ${idea.description ? `<p class="idea-card__desc">${esc(idea.description)}</p>` : ''}
      ${meta.length ? `<div class="idea-card__meta">${meta.join('<span class="idea-card__meta-sep" aria-hidden="true"> · </span>')}</div>` : ''}
      ${!idea.city ? `
        <div class="wish-card__no-location" aria-label="Bez lokace">
          <span>📍 Bez lokace</span>
          ${canAddLocation ? `<button class="btn btn--xs btn--ghost" data-action="add-location" data-id="${idea.id}">Přidat na mapě</button>` : ''}
        </div>` : ''}
      <div class="idea-card__author">
        <span class="idea-card__avatar" aria-hidden="true">${esc(idea.authorAvatar ?? '😊')}</span>
        <span class="idea-card__author-name">${esc(idea.authorNickname ?? '—')}</span>
        ${timeStr ? `<span class="idea-card__time">${timeStr}</span>` : ''}
      </div>
      <div class="idea-card__actions">
        <button class="idea-action-btn${liked ? ' idea-action-btn--active' : ''}"
          data-action="like" data-id="${idea.id}"
          aria-pressed="${liked}" aria-label="${liked ? 'Odebrat lajk' : 'Lajknout'}">
          <span aria-hidden="true">👍</span>
          <span class="idea-action-btn__count">${idea.likes?.length ?? 0}</span>
        </button>
        <button class="idea-action-btn${cosigned ? ' idea-action-btn--active idea-action-btn--cosign' : ''}"
          data-action="cosign" data-id="${idea.id}"
          aria-pressed="${cosigned}" aria-label="${cosigned ? 'Odebrat \'I já chci\'' : 'I já chci'}">
          <span aria-hidden="true">✋</span>
          <span class="idea-action-btn__count">${idea.cosigns?.length ?? 0}</span>
        </button>
        <button class="idea-action-btn"
          data-action="comments" data-id="${idea.id}"
          aria-label="Komentáře">
          <span aria-hidden="true">💬</span>
        </button>
        ${canEdit || canDelete ? `<div class="idea-action-sep" aria-hidden="true"></div>` : ''}
        ${canEdit ? `
          <button class="idea-action-btn idea-action-btn--edit"
            data-action="edit" data-id="${idea.id}" aria-label="Upravit nápad">
            <span aria-hidden="true">✏️</span>
          </button>` : ''}
        ${canDelete ? `
          <button class="idea-action-btn idea-action-btn--delete"
            data-action="delete" data-id="${idea.id}" aria-label="Smazat nápad">
            <span aria-hidden="true">🗑️</span>
          </button>` : ''}
      </div>
    </article>
  `;
}

function buildEmptyState() {
  const hasFilters = Object.values(_filters).some(Boolean);
  return `
    <div class="empty-state" style="grid-column:1/-1">
      <span class="empty-state__icon" aria-hidden="true">${hasFilters ? '🔍' : '⭐'}</span>
      <h2 class="empty-state__title">${hasFilters ? 'Nic nenalezeno' : 'Wishlist je prázdný'}</h2>
      <p class="empty-state__desc">
        ${hasFilters
          ? 'Zkus upravit nebo resetovat filtry.'
          : 'Buď první, kdo přidá nápad na Wishlist!'}
      </p>
      ${hasFilters
        ? `<button class="btn btn--secondary" id="wl-reset-filters">Resetovat filtry</button>`
        : `<button class="btn btn--primary"   id="wl-empty-add">+ Přidat nápad</button>`}
    </div>`;
}

/* ── Card action dispatcher ──────────────────────────────────── */

function handleCardAction(btn) {
  const { action, id } = btn.dataset;
  if (!id) return;
  switch (action) {
    case 'like':     toggleLike(id);    break;
    case 'cosign':   toggleCosign(id);  break;
    case 'comments': openComments(id);  break;
    case 'edit': {
      const idea = _ideasCache.find(i => i.id === id);
      if (idea) openInlineForm(idea);
      break;
    }
    case 'delete': confirmDelete(id); break;
    case 'add-location': {
      const idea = _ideasCache.find(i => i.id === id);
      if (idea) {
        openInlineForm(idea);
        setTimeout(() => _container?.querySelector('#lp-search')?.focus(), 200);
      }
      break;
    }
  }
}

/* ── Like ────────────────────────────────────────────────────── */

async function toggleLike(ideaId) {
  const uid  = state.user?.uid;
  if (!uid) return;
  const idea = _ideasCache.find(i => i.id === ideaId);
  if (!idea) return;
  try {
    await updateDoc(doc(db, 'ideas', ideaId), {
      likes: idea.likes?.includes(uid) ? arrayRemove(uid) : arrayUnion(uid),
    });
  } catch (err) {
    console.error('[wishlist] toggleLike:', err);
    showToast('Nepodařilo se uložit lajk.', 'error');
  }
}

/* ── Co-sign ─────────────────────────────────────────────────── */

async function toggleCosign(ideaId) {
  const uid  = state.user?.uid;
  if (!uid) return;
  const idea = _ideasCache.find(i => i.id === ideaId);
  if (!idea) return;
  try {
    await updateDoc(doc(db, 'ideas', ideaId), {
      cosigns: idea.cosigns?.includes(uid) ? arrayRemove(uid) : arrayUnion(uid),
    });
  } catch (err) {
    console.error('[wishlist] toggleCosign:', err);
    showToast('Nepodařilo se uložit.', 'error');
  }
}

/* ── Delete ──────────────────────────────────────────────────── */

async function confirmDelete(ideaId) {
  const idea = _ideasCache.find(i => i.id === ideaId);
  if (!idea) return;
  const ok = await showConfirm(
    'Smazat nápad',
    `Opravdu smazat „${idea.title}"? Tato akce je nevratná.`,
    'Smazat'
  );
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'ideas', ideaId));
    showToast('Nápad smazán.', 'success');
  } catch (err) {
    console.error('[wishlist] delete:', err);
    showToast('Nepodařilo se smazat nápad.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   MAPA
   ════════════════════════════════════════════════════════════ */

const _getMapTileUrl = () => 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

function initMap() {
  if (!window.L) { console.warn('[wishlist] Leaflet není načten'); return; }
  const mapEl = _container?.querySelector('#wl-map');
  if (!mapEl || _map) return;

  // Odstraň případný starý debug overlay
  document.getElementById('map-debug-overlay')?.remove();

  _userLocationMarker = null;
  _userLocationCircle = null;

  _map = L.map(mapEl, {
    center: [35.6762, 139.6503],
    zoom: 11,
    zoomControl: false,
    attributionControl: true,
  });

  L.control.zoom({ position: 'topright' }).addTo(_map);

  // ESRI World Light Gray — funguje všude, latinské popisky, no CORS issues
  _mapTileLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri', maxZoom: 16, crossOrigin: true }
  ).addTo(_map);

  // Reference vrstva — anglické popisky měst
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    { attribution: '', maxZoom: 16, crossOrigin: true, pane: 'overlayPane' }
  ).addTo(_map);

  _addLocateControl(_map);
}

function _addLocateControl(map) {
  const LocateControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const wrap = L.DomUtil.create('div', 'leaflet-bar leaflet-control locate-control');
      const btn  = L.DomUtil.create('a', 'locate-btn', wrap);
      btn.href = '#';
      btn.title = 'Moje poloha';
      btn.setAttribute('aria-label', 'Moje poloha');
      btn.innerHTML = '📍';

      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        if (!navigator.geolocation) { alert('Geolocation není podporováno'); return; }

        btn.innerHTML = '⏳';
        btn.classList.add('locate-btn--loading');
        btn.style.pointerEvents = 'none';

        navigator.geolocation.getCurrentPosition(
          ({ coords: { latitude: lat, longitude: lng, accuracy } }) => {
            // Vždy smaž předchozí marker + circle → jen 1 najednou
            if (_userLocationMarker) { map.removeLayer(_userLocationMarker); _userLocationMarker = null; }
            if (_userLocationCircle) { map.removeLayer(_userLocationCircle); _userLocationCircle = null; }

            map.flyTo([lat, lng], 15, { animate: true, duration: 1.5 });

            _userLocationCircle = L.circle([lat, lng], {
              radius: accuracy,
              color: '#0A84FF',
              fillColor: '#0A84FF',
              fillOpacity: 0.08,
              weight: 1,
              opacity: 0.3,
              interactive: false,
            }).addTo(map);

            _userLocationMarker = L.marker([lat, lng], {
              icon: L.divIcon({
                className: 'user-location-pin',
                html: [
                  '<div class="user-location-pin__pulse user-location-pin__pulse--1"></div>',
                  '<div class="user-location-pin__pulse user-location-pin__pulse--2"></div>',
                  '<div class="user-location-pin__pulse user-location-pin__pulse--3"></div>',
                  '<div class="user-location-pin__core"></div>',
                ].join(''),
                iconSize: [24, 24],
                iconAnchor: [12, 12],
              }),
              zIndexOffset: 1000,
            }).addTo(map);

            const accLabel = accuracy < 50 ? 'velmi přesné' : accuracy < 200 ? 'přesné' : 'orientační';
            _userLocationMarker.bindPopup(
              `<div style="text-align:center;padding:4px">` +
              `<strong style="font-size:14px;color:#1D1D1F">📍 Tady jsi!</strong><br>` +
              `<small style="color:#6E6E73;font-size:11px">${accLabel} (±${Math.round(accuracy)}m)</small>` +
              `</div>`
            ).openPopup();

            btn.innerHTML = '📍';
            btn.classList.remove('locate-btn--loading');
            btn.classList.add('locate-btn--active');
            btn.style.pointerEvents = '';
          },
          (err) => {
            const msgs = { 1: 'Povol přístup k poloze v nastavení prohlížeče', 2: 'Poloha není dostupná', 3: 'Časový limit vypršel' };
            alert(msgs[err.code] ?? 'Nepodařilo se najít polohu');
            btn.innerHTML = '📍';
            btn.classList.remove('locate-btn--loading');
            btn.style.pointerEvents = '';
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
        );
      });
      return wrap;
    },
  });
  map.addControl(new LocateControl());
}

function createMarkerIcon(priority, number = null) {
  const color = PRIORITY_COLORS[priority] ?? '#4F46E5';
  return L.divIcon({
    className: 'custom-pin-wrapper',
    html: `<div class="custom-pin" style="background:${color}"><div class="custom-pin__number">${number ?? ''}</div></div>`,
    iconSize: [40, 52],
    iconAnchor: [20, 52],
    popupAnchor: [0, -46],
  });
}

function buildPopupContent(idea, number = null) {
  const cat = CATEGORIES[idea.category] ?? { emoji: '✨', label: '?' };
  const pri = PRIORITIES[idea.priority]  ?? { emoji: '⚪', label: '?' };
  const meta = [];
  if (idea.city)             meta.push(`📍 ${esc(idea.city)}`);
  if (idea.priceJpy != null) meta.push(`💴 ${Number(idea.priceJpy).toLocaleString('cs-CZ')} JPY`);
  if (idea.durationHours)    meta.push(`⏱️ ${idea.durationHours} h`);

  const uid = state.user?.uid ?? '';
  const canEditLocation = idea.authorUid === uid || state.isAdmin;
  const color = PRIORITY_COLORS[idea.priority] ?? '#4F46E5';
  const numBadge = number != null
    ? `<span class="map-popup__number" style="background:${color}">${number}</span>`
    : '';

  return `
    <div>
      <div class="map-popup__title">${numBadge}${esc(idea.title)}</div>
      <div class="map-popup__meta">
        <span>${cat.emoji} ${esc(cat.label)}</span>
        <span>${pri.emoji} ${esc(pri.label)}</span>
        ${idea.authorAvatar ? `<span>${esc(idea.authorAvatar)} ${esc(idea.authorNickname ?? '—')}</span>` : ''}
        ${meta.map(m => `<span>${m}</span>`).join('')}
      </div>
      <div class="map-popup__actions">
        <button class="map-popup__btn" data-show-card="${idea.id}">Zobrazit kartu →</button>
        ${canEditLocation ? `<button class="map-popup__btn map-popup__btn--secondary" data-edit-location="${idea.id}">📍 Opravit</button>` : ''}
      </div>
    </div>`;
}

/* Synchronizace markerů s filtrovanými nápady */
function syncMarkers(filteredIdeas) {
  if (!_map) return;

  // Číslování: pořadí v aktuálně filtrovaném seznamu karet
  const numberMap = new Map();
  filteredIdeas.forEach((idea, i) => numberMap.set(idea.id, i + 1));

  const filteredIds = new Set(filteredIdeas.map(i => i.id));
  const allIds      = new Set(_ideasCache.map(i => i.id));

  // Odstraň markery smazaných nápadů
  _markers.forEach((ms, id) => {
    if (!allIds.has(id)) {
      _map.removeLayer(ms.marker);
      _markers.delete(id);
    }
  });

  // Zobraz/skryj existující markery + aktualizuj ikonu při změně priority nebo čísla
  _markers.forEach((ms, id) => {
    const inFilter = filteredIds.has(id);
    if (inFilter && !_map.hasLayer(ms.marker)) {
      ms.marker.addTo(_map);
    } else if (!inFilter && _map.hasLayer(ms.marker)) {
      _map.removeLayer(ms.marker);
    }
    const idea = _ideasCache.find(i => i.id === id);
    if (!idea) return;
    // Aktualizuj pozici pokud se změnila pinLat/pinLng (ale ne pokud právě editujeme)
    if (id !== _editLocationId && idea.pinLat != null && idea.pinLng != null) {
      const ll = ms.marker.getLatLng();
      if (Math.abs(ll.lat - idea.pinLat) > 0.00005 || Math.abs(ll.lng - idea.pinLng) > 0.00005) {
        ms.marker.setLatLng([idea.pinLat, idea.pinLng]);
      }
    }
    const newNumber = numberMap.get(id) ?? ms.number;
    if (idea.priority !== ms.priority || newNumber !== ms.number) {
      ms.priority = idea.priority;
      ms.number   = newNumber;
      ms.marker.setIcon(createMarkerIcon(idea.priority, newNumber));
      ms.marker.bindPopup(buildPopupContent(idea, newNumber), { maxWidth: 260 });
    }
  });

  // Přidej markery pro nové nápady (asynchronní geocoding nebo pinLat/pinLng)
  for (const [i, idea] of filteredIdeas.entries()) {
    if ((!idea.city && idea.pinLat == null) || _markers.has(idea.id)) continue;
    geocodeAndAddMarker(idea, i + 1);
  }

  checkMapEmpty(filteredIdeas);
}

async function geocodeAndAddMarker(idea, number = null) {
  let coords = null;

  // Manuálně uložené souřadnice mají přednost před geocodingem
  if (idea.pinLat != null && idea.pinLng != null) {
    coords = { lat: idea.pinLat, lng: idea.pinLng };
  } else if (idea.city) {
    ensureGeocodeCache();
    const cacheKey = idea.city.toLowerCase().trim();
    coords = _geocodeCache[cacheKey];
    if (coords === undefined) {
      coords = await geocodeCity(idea.city);
    }
  }

  // Guardy po čekání na async operaci
  if (!_map || !_container)                      return;
  if (_markers.has(idea.id))                     return; // přidáno mezitím
  if (!_ideasCache.find(i => i.id === idea.id))  return; // smazáno mezitím
  if (!coords)                                   return; // geocoding selhal

  const marker = L.marker([coords.lat, coords.lng], {
    icon: createMarkerIcon(idea.priority, number),
    title: idea.title,
  })
  .bindPopup(buildPopupContent(idea, number), { maxWidth: 260 })
  .addTo(_map);

  _markers.set(idea.id, { marker, priority: idea.priority, city: idea.city, number });

  // Skryj pokud je nyní odfiltrováno
  const isFiltered = (
    (_filters.category && idea.category       !== _filters.category) ||
    (_filters.priority  && idea.priority       !== _filters.priority) ||
    (_filters.author    && idea.authorNickname !== _filters.author)   ||
    (_filters.city      && idea.city           !== _filters.city)
  );
  if (isFiltered) _map.removeLayer(marker);

  // Aktualizuj prázdný stav
  const currentFiltered = _ideasCache.filter(i =>
    (!_filters.category || i.category       === _filters.category) &&
    (!_filters.priority  || i.priority       === _filters.priority) &&
    (!_filters.author    || i.authorNickname === _filters.author)   &&
    (!_filters.city      || i.city           === _filters.city)
  );
  checkMapEmpty(currentFiltered);
}

function checkMapEmpty(filteredIdeas) {
  const emptyEl = _container?.querySelector('#wl-map-empty');
  if (!emptyEl) return;
  const hasPinnable = filteredIdeas.some(i => i.city || i.pinLat != null);
  emptyEl.classList.toggle('hidden', hasPinnable);
}

/* ── Drag & drop úprava lokace ───────────────────────────────── */

function startLocationEdit(ideaId) {
  if (_editLocationId) cancelLocationEdit();
  const ms = _markers.get(ideaId);
  if (!ms) return;

  _editLocationId       = ideaId;
  _editLocationOriginalLL = ms.marker.getLatLng();

  ms.marker.dragging.enable();
  ms.marker.getElement()?.querySelector('.custom-pin')?.classList.add('editing');

  showEditBanner();
}

function confirmLocationEdit() {
  if (!_editLocationId) return;
  const ms      = _markers.get(_editLocationId);
  const ideaId  = _editLocationId;
  const latlng  = ms?.marker.getLatLng();

  finishLocationEdit(false);
  if (!ms || !latlng) return;

  updateDoc(doc(db, 'ideas', ideaId), { pinLat: latlng.lat, pinLng: latlng.lng })
    .then(() => showToast('Lokace uložena! 📍', 'success'))
    .catch(err => {
      console.error('[wishlist] save location:', err);
      showToast('Nepodařilo se uložit lokaci.', 'error');
    });
}

function cancelLocationEdit() {
  if (!_editLocationId) return;
  const ms = _markers.get(_editLocationId);
  if (ms && _editLocationOriginalLL) {
    ms.marker.setLatLng(_editLocationOriginalLL);
  }
  finishLocationEdit(true);
}

function finishLocationEdit(_cancelled = false) {
  if (!_editLocationId) return;
  const ms = _markers.get(_editLocationId);
  if (ms) {
    ms.marker.dragging.disable();
    ms.marker.getElement()?.querySelector('.custom-pin')?.classList.remove('editing');
  }
  _editLocationId        = null;
  _editLocationOriginalLL = null;
  hideEditBanner();
}

function showEditBanner() {
  _container?.querySelector('#wl-edit-banner')?.classList.remove('hidden');
}

function hideEditBanner() {
  _container?.querySelector('#wl-edit-banner')?.classList.add('hidden');
}

function focusIdeaOnMap(ideaId) {
  if (!_map) return;
  const ms = _markers.get(ideaId);
  if (!ms) return;

  // Na mobilu přepni na zobrazení mapy
  if (window.innerWidth < 640 && _mobileView !== 'map') {
    setMobileView('map');
  }

  _map.flyTo(ms.marker.getLatLng(), 14, { duration: 0.8 });
  setTimeout(() => ms.marker.openPopup(), 900);
}

function scrollToCard(ideaId) {
  const card = _container?.querySelector(`.idea-card[data-id="${ideaId}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('wl-card--highlight');
  setTimeout(() => card.classList.remove('wl-card--highlight'), 1600);
}

function setMobileView(view) {
  _mobileView = view;
  const body = _container?.querySelector('#wl-body');
  body?.classList.toggle('wl-body--map-view', view === 'map');

  _container?.querySelectorAll('[data-wl-view]').forEach(btn => {
    btn.classList.toggle('wl-toggle-btn--active', btn.dataset.wlView === view);
  });

  if (view === 'map') {
    setTimeout(() => _map?.invalidateSize(), 120);
  }
}

function applyMapPreset(preset) {
  const p = MAP_PRESETS[preset];
  if (!p || !_map) return;
  _map.flyTo([p.lat, p.lng], p.zoom, { duration: 1 });
}

/* ════════════════════════════════════════════════════════════
   LOCATION PICKER (inline form mini-mapa)
   ════════════════════════════════════════════════════════════ */

function initPickerMap() {
  if (!window.L) return;
  const el = _container?.querySelector('#lp-map');
  if (!el || _pickerMap) return;

  _pickerMap = L.map(el, {
    center: [36.5, 136.0],
    zoom: 5,
    zoomControl: true,
    attributionControl: false,
  });

  _pickerTileLayer = L.tileLayer(_getMapTileUrl(), {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
    minZoom: 2,
  }).addTo(_pickerMap);

  // Klik na mapu → přidej/přesuň pin
  _pickerMap.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    const name = await lpReverseGeocode(lat, lng);
    setPickerLocation(lat, lng, name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  });
}

function destroyPickerMap() {
  if (_pickerMap) {
    _pickerMap.remove();
    _pickerMap = null;
  }
  _pickerMarker   = null;
  _pickerLocation = null;

  const c = _container;
  if (!c) return;
  c.querySelector('#lp-selected')?.classList.add('hidden');
  c.querySelector('#lp-suggestions')?.classList.add('hidden');
  // Reset tabs to "search"
  c.querySelectorAll('[data-lp-tab]').forEach((t, i) => {
    t.classList.toggle('active', i === 0);
    t.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
  });
  c.querySelectorAll('[data-lp-panel]').forEach((p, i) => {
    p.classList.toggle('active', i === 0);
    p.hidden = i !== 0;
  });
}

function setPickerLocation(lat, lng, name) {
  _pickerLocation = { lat, lng, name };

  if (_pickerMap) {
    if (_pickerMarker) {
      _pickerMarker.setLatLng([lat, lng]);
    } else {
      _pickerMarker = L.marker([lat, lng], { draggable: true }).addTo(_pickerMap);
      _pickerMarker.on('dragend', async (e) => {
        const ll = e.target.getLatLng();
        const n  = await lpReverseGeocode(ll.lat, ll.lng);
        _pickerLocation = {
          lat: ll.lat, lng: ll.lng,
          name: n || _pickerLocation?.name || `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`,
        };
        updatePickerCoordsInputs(ll.lat, ll.lng);
        updatePickerDisplay();
      });
    }
    _pickerMap.setView([lat, lng], 14);
  }

  updatePickerCoordsInputs(lat, lng);
  updatePickerDisplay();
}

function clearPickerLocation() {
  _pickerLocation = null;
  if (_pickerMarker && _pickerMap) {
    _pickerMap.removeLayer(_pickerMarker);
    _pickerMarker = null;
  }
  const c = _container;
  if (!c) return;
  c.querySelector('#lp-selected')?.classList.add('hidden');
  c.querySelector('#lp-suggestions')?.classList.add('hidden');
  ['#lp-search', '#lp-address', '#lp-paste'].forEach(sel => {
    const el = c.querySelector(sel);
    if (el) el.value = '';
  });
  ['#lp-lat', '#lp-lng'].forEach(sel => {
    const el = c.querySelector(sel);
    if (el) el.value = '';
  });
}

function updatePickerDisplay() {
  const sel = _container?.querySelector('#lp-selected');
  if (!sel) return;
  if (_pickerLocation) {
    const nameEl = _container.querySelector('#lp-selected-name');
    const crdEl  = _container.querySelector('#lp-selected-coords');
    if (nameEl) nameEl.textContent = _pickerLocation.name;
    if (crdEl)  crdEl.textContent  = `${_pickerLocation.lat.toFixed(5)}, ${_pickerLocation.lng.toFixed(5)}`;
    sel.classList.remove('hidden');
  } else {
    sel.classList.add('hidden');
  }
}

function updatePickerCoordsInputs(lat, lng) {
  const latEl = _container?.querySelector('#lp-lat');
  const lngEl = _container?.querySelector('#lp-lng');
  if (latEl) latEl.value = lat.toFixed(6);
  if (lngEl) lngEl.value = lng.toFixed(6);
}

function setupPickerListeners() {
  const c = _container;
  if (!c) return;

  // Tab switching
  c.querySelector('.location-picker__tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-lp-tab]');
    if (!tab) return;
    const method = tab.dataset.lpTab;
    c.querySelectorAll('[data-lp-tab]').forEach(t => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    c.querySelectorAll('[data-lp-panel]').forEach(p => {
      const on = p.dataset.lpPanel === method;
      p.classList.toggle('active', on);
      p.hidden = !on;
    });
    setTimeout(() => _pickerMap?.invalidateSize(), 120);
  });

  // Search: autocomplete
  let _searchTimeout;
  c.querySelector('#lp-search')?.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(_searchTimeout);
    if (q.length < 2) { c.querySelector('#lp-suggestions')?.classList.add('hidden'); return; }
    _searchTimeout = setTimeout(() => lpSearch(q), 420);
  });
  c.querySelector('#lp-search')?.addEventListener('blur', () => {
    setTimeout(() => c.querySelector('#lp-suggestions')?.classList.add('hidden'), 220);
  });

  // Suggestions click
  c.querySelector('#lp-suggestions')?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-lp-suggest]');
    if (!item) return;
    const lat  = parseFloat(item.dataset.lat);
    const lng  = parseFloat(item.dataset.lng);
    const name = item.dataset.name;
    setPickerLocation(lat, lng, name);
    const si = c.querySelector('#lp-search');
    if (si) si.value = name;
    c.querySelector('#lp-suggestions')?.classList.add('hidden');
  });

  // Address: go button
  c.querySelector('#lp-address-go')?.addEventListener('click', async () => {
    const addr = c.querySelector('#lp-address')?.value.trim();
    if (!addr) return;
    showToast('🔍 Hledám adresu…', 'info');
    const result = await lpForwardGeocode(addr);
    if (result) setPickerLocation(result.lat, result.lng, result.name);
  });
  c.querySelector('#lp-address')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); c.querySelector('#lp-address-go')?.click(); }
  });

  // Coords: paste button
  c.querySelector('#lp-paste-go')?.addEventListener('click', async () => {
    const text   = c.querySelector('#lp-paste')?.value.trim();
    const coords = lpParseCoords(text);
    if (!coords) { showToast('Neplatný formát. Použij např. „35.6812, 139.7671"', 'error'); return; }
    updatePickerCoordsInputs(coords.lat, coords.lng);
    const name = await lpReverseGeocode(coords.lat, coords.lng);
    setPickerLocation(coords.lat, coords.lng, name || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
  });

  // Coords: lat/lng input live update
  let _coordsTimeout;
  const onCoordsChange = () => {
    clearTimeout(_coordsTimeout);
    _coordsTimeout = setTimeout(async () => {
      const lat = parseFloat(c.querySelector('#lp-lat')?.value);
      const lng = parseFloat(c.querySelector('#lp-lng')?.value);
      if (isNaN(lat) || isNaN(lng)) return;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
      const name = await lpReverseGeocode(lat, lng);
      setPickerLocation(lat, lng, name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    }, 900);
  };
  c.querySelector('#lp-lat')?.addEventListener('input', onCoordsChange);
  c.querySelector('#lp-lng')?.addEventListener('input', onCoordsChange);

  // Clear
  c.querySelector('#lp-clear')?.addEventListener('click', clearPickerLocation);
}

/* ── Picker: Nominatim calls ─────────────────────────────────── */

async function lpSearch(query) {
  const elapsed = Date.now() - _lastGeocode;
  if (elapsed < NOMINATIM_DELAY) await new Promise(r => setTimeout(r, NOMINATIM_DELAY - elapsed));
  _lastGeocode = Date.now();

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&accept-language=cs,en&viewbox=122,45,154,24&bounded=0`;
    const res  = await fetch(url, { headers: { 'User-Agent': 'JapanTrip2026/1.0 (skupinovy-planovac)' } });
    const data = await res.json();
    lpShowSuggestions(data);
  } catch {
    // tiché selhání (offline apod.)
  }
}

function lpShowSuggestions(results) {
  const el = _container?.querySelector('#lp-suggestions');
  if (!el) return;
  if (!results.length) { el.classList.add('hidden'); return; }

  el.innerHTML = results.map(r => {
    const name   = r.name || r.display_name.split(',')[0];
    const detail = r.display_name;
    return `<button type="button" class="location-picker__suggestion"
      data-lp-suggest data-lat="${r.lat}" data-lng="${r.lon}" data-name="${esc(name)}">
      <span class="lp-suggest__name">${esc(name)}</span>
      <span class="lp-suggest__detail">${esc(detail)}</span>
    </button>`;
  }).join('');
  el.classList.remove('hidden');
}

async function lpForwardGeocode(address) {
  const cacheKey = `geocode:addr:${address.toLowerCase()}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {}

  const elapsed = Date.now() - _lastGeocode;
  if (elapsed < NOMINATIM_DELAY) await new Promise(r => setTimeout(r, NOMINATIM_DELAY - elapsed));
  _lastGeocode = Date.now();

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&accept-language=cs,en`,
      { headers: { 'User-Agent': 'JapanTrip2026/1.0 (skupinovy-planovac)' } }
    );
    const data = await res.json();
    if (!data.length) { showToast('Adresa nenalezena. Zkus jinou variantu.', 'warning'); return null; }
    const result = {
      lat:  parseFloat(data[0].lat),
      lng:  parseFloat(data[0].lon),
      name: data[0].name || data[0].display_name.split(',')[0],
    };
    try { localStorage.setItem(cacheKey, JSON.stringify(result)); } catch {}
    return result;
  } catch {
    showToast('Chyba při hledání adresy.', 'error');
    return null;
  }
}

async function lpReverseGeocode(lat, lng) {
  const cacheKey = `geocode:rev:${lat.toFixed(3)}:${lng.toFixed(3)}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;
  } catch {}

  const elapsed = Date.now() - _lastGeocode;
  if (elapsed < NOMINATIM_DELAY) await new Promise(r => setTimeout(r, NOMINATIM_DELAY - elapsed));
  _lastGeocode = Date.now();

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=cs,en`,
      { headers: { 'User-Agent': 'JapanTrip2026/1.0 (skupinovy-planovac)' } }
    );
    const data = await res.json();
    const name = data.name
      || data.address?.tourism || data.address?.amenity
      || data.address?.city || data.address?.town || data.address?.village
      || data.display_name?.split(',')[0]
      || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    try { localStorage.setItem(cacheKey, name); } catch {}
    return name;
  } catch {
    return null;
  }
}

function lpParseCoords(input) {
  const m = (input ?? '').match(/(-?\d+\.?\d*)[,\s;]+(-?\d+\.?\d*)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng  = parseFloat(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/* ── Geocoding s cache ───────────────────────────────────────── */

function ensureGeocodeCache() {
  if (_geocodeCache) return;
  try {
    _geocodeCache = JSON.parse(localStorage.getItem(GEOCODE_LS_KEY) ?? '{}');
  } catch {
    _geocodeCache = {};
  }
}

function saveGeocodeCache() {
  try {
    localStorage.setItem(GEOCODE_LS_KEY, JSON.stringify(_geocodeCache));
  } catch (e) {
    console.warn('[wishlist] geocode cache full:', e);
  }
}

async function geocodeCity(city) {
  const cacheKey = city.toLowerCase().trim();
  ensureGeocodeCache();

  if (_geocodeCache[cacheKey] !== undefined) {
    return _geocodeCache[cacheKey];
  }

  // Throttle – respektujeme Nominatim usage policy (max 1 req/s)
  const elapsed = Date.now() - _lastGeocode;
  if (elapsed < NOMINATIM_DELAY) {
    await new Promise(r => setTimeout(r, NOMINATIM_DELAY - elapsed));
  }
  _lastGeocode = Date.now();

  try {
    const q = encodeURIComponent(`${city}, Japan`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&accept-language=cs,en`,
      { headers: { 'User-Agent': 'JapanTrip2026/1.0 (skupinovy-planovac)' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const coords = data[0]
      ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
      : null;

    _geocodeCache[cacheKey] = coords;
    saveGeocodeCache();
    return coords;
  } catch (err) {
    console.warn('[wishlist] geocode error:', city, err);
    _geocodeCache[cacheKey] = null;
    saveGeocodeCache();
    return null;
  }
}

/* ════════════════════════════════════════════════════════════
   KOMENTÁŘE
   ════════════════════════════════════════════════════════════ */

function openComments(ideaId) {
  if (_openCommentsId === ideaId) { closeCommentsPanel(); return; }

  _openCommentsId = ideaId;
  _unsubComments?.();

  const idea  = _ideasCache.find(i => i.id === ideaId);
  const panel = _container.querySelector('#wl-comments-panel');
  const title = _container.querySelector('#wl-comments-title');

  if (title && idea) title.textContent = `💬 ${idea.title}`;

  const list = _container.querySelector('#wl-comments-list');
  if (list) list.innerHTML = '<div class="skeleton skeleton--text" style="margin:var(--space-4)"></div>';

  panel?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const q = query(
    collection(db, 'ideas', ideaId, 'idea_comments'),
    orderBy('createdAt', 'asc')
  );
  _unsubComments = onSnapshot(q, (snap) => {
    renderComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error('[wishlist] comments snapshot:', err);
    showToast('Chyba při načítání komentářů.', 'error');
  });

  _container.querySelector('#wl-comment-input')?.focus();
}

function closeCommentsPanel() {
  _unsubComments?.();
  _unsubComments  = null;
  _openCommentsId = null;
  _container?.querySelector('#wl-comments-panel')?.classList.add('hidden');
  document.body.style.overflow = '';
}

function renderComments(comments) {
  const list = _container?.querySelector('#wl-comments-list');
  if (!list) return;

  if (!comments.length) {
    list.innerHTML = `
      <div class="comments-empty">
        <span aria-hidden="true" style="font-size:2rem">💬</span>
        <p>Zatím žádné komentáře. Buď první!</p>
      </div>`;
    return;
  }

  list.innerHTML = comments.map(c => {
    const isMe = c.authorUid === state.user?.uid;
    const tStr = c.createdAt?.toDate ? fmtTime(c.createdAt.toDate()) : '';
    return `
      <div class="comment-item${isMe ? ' comment-item--me' : ''}">
        <span class="comment-item__avatar" aria-hidden="true">${esc(c.authorAvatar ?? '😊')}</span>
        <div class="comment-item__bubble">
          <span class="comment-item__author">${esc(c.authorNickname ?? '—')}</span>
          <p class="comment-item__text">${esc(c.text)}</p>
          ${tStr ? `<span class="comment-item__time">${tStr}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  list.scrollTop = list.scrollHeight;
}

async function sendComment() {
  if (!_openCommentsId) return;
  const input = _container?.querySelector('#wl-comment-input');
  const text  = input?.value.trim();
  if (!text) return;

  const btn = _container?.querySelector('#wl-comment-send');
  if (btn) btn.disabled = true;

  try {
    await addDoc(collection(db, 'ideas', _openCommentsId, 'idea_comments'), {
      text,
      authorUid:      state.user.uid,
      authorNickname: state.profile.nickname,
      authorAvatar:   state.profile.avatar ?? '😊',
      createdAt:      serverTimestamp(),
    });
    if (input) input.value = '';
  } catch (err) {
    console.error('[wishlist] sendComment:', err);
    showToast('Nepodařilo se odeslat komentář.', 'error');
  } finally {
    if (btn) btn.disabled = false;
    input?.focus();
  }
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

function fmtTime(date) {
  const diff = Date.now() - date.getTime();
  if (diff < 60_000)          return 'před chvílí';
  if (diff < 3_600_000)       return `před ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000)      return `před ${Math.floor(diff / 3_600_000)} h`;
  if (diff < 7 * 86_400_000)  return `před ${Math.floor(diff / 86_400_000)} dny`;
  return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short' });
}

