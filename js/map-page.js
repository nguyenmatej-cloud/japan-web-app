/**
 * map-page.js – Stránka Mapa s TOP 20 tipy, live polohy, last-known, wishlist vrstvou.
 */
import { JAPAN_LANDMARKS, CATEGORY_INFO } from './japan-landmarks.js';
import { toggleLiveLocation, isLiveActive, listenToAllLocations } from './live-location.js';
import { db } from './firebase-config.js';
import { state, showToast } from './app.js';
import {
  collection, getDocs, addDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';

/* ── Stav modulu ─────────────────────────────────────────────── */

let _map                  = null;
let _liveListenerUnsub    = null;
let _userLocationMarker   = null;
let _activeCategory       = 'all';

const _layers = {
  tips:      { enabled: true,  group: null, markers: [] },
  live:      { enabled: true,  group: null, markers: new Map() },
  lastKnown: { enabled: true,  group: null, markers: new Map() },
  wishlist:  { enabled: false, group: null, markers: [], loaded: false },
};

/* ── Render ──────────────────────────────────────────────────── */

export function render(container) {
  container.innerHTML = `
    <div class="map-page">
      <div class="map-page__header">
        <h1 class="map-page__title">🗺️ Mapa Japonska</h1>
        <p class="map-page__subtitle">20 tipů na místa, kde budeme a kde jsou ostatní</p>
      </div>

      <div class="map-page__toolbar">
        <div class="map-layers" role="group" aria-label="Vrstvy mapy">
          <button class="map-layer-btn map-layer-btn--active" data-layer="tips">
            <span class="map-layer-btn__icon">🇯🇵</span>
            <span class="map-layer-btn__text">Tipy</span>
          </button>
          <button class="map-layer-btn map-layer-btn--active" data-layer="live">
            <span class="map-layer-btn__icon">🟢</span>
            <span class="map-layer-btn__text">Live</span>
          </button>
          <button class="map-layer-btn map-layer-btn--active" data-layer="lastKnown">
            <span class="map-layer-btn__icon">⚫</span>
            <span class="map-layer-btn__text">Last seen</span>
          </button>
          <button class="map-layer-btn" data-layer="wishlist">
            <span class="map-layer-btn__icon">⭐</span>
            <span class="map-layer-btn__text">Wishlist</span>
          </button>
        </div>
        <div class="map-categories" id="mp-categories" role="group" aria-label="Filtry kategorií">
          <button class="map-cat-chip map-cat-chip--active" data-cat="all">Vše</button>
          ${Object.entries(CATEGORY_INFO).map(([key, info]) =>
            `<button class="map-cat-chip" data-cat="${key}">${info.icon} ${info.label}</button>`
          ).join('')}
        </div>
      </div>

      <div class="map-page__map-wrap">
        <div id="japan-map" class="japan-map"></div>
      </div>

      <div class="map-page__legend" id="mp-legend"></div>
    </div>
  `;

  // Malé zpoždění aby DOM existoval před Leaflet inicializací
  setTimeout(_initMap, 80);

  return _cleanup;
}

/* ── Inicializace mapy ───────────────────────────────────────── */

function _initMap() {
  const mapEl = document.getElementById('japan-map');
  if (!mapEl || !window.L) return;

  _map = L.map(mapEl, {
    center: [36.5, 137.0],
    zoom: 6,
    zoomControl: false,
  });

  L.control.zoom({ position: 'topright' }).addTo(_map);

  // ESRI – latinské popisky, bez CORS problémů, funguje na iPadu
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    { attribution: '&copy; Esri', maxZoom: 16, crossOrigin: true }
  ).addTo(_map);
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    { attribution: '', maxZoom: 16, crossOrigin: true, pane: 'overlayPane' }
  ).addTo(_map);

  // Inicializace layer groups
  _layers.tips.group      = L.layerGroup().addTo(_map);
  _layers.live.group      = L.layerGroup().addTo(_map);
  _layers.lastKnown.group = L.layerGroup().addTo(_map);
  _layers.wishlist.group  = L.layerGroup(); // nezobrazeno dokud uživatel nezapne

  _renderTips();
  _setupEventListeners();
  _addLocateControl(_map);
  _addLiveControl(_map);

  // Real-time listener pro live + last-known
  _liveListenerUnsub = listenToAllLocations(({ live, lastKnown }) => {
    _renderLiveMembers(live);
    _renderLastKnownMembers(lastKnown);
    _updateLegend();
  });

  _updateLegend();
}

/* ── Tipy ────────────────────────────────────────────────────── */

function _renderTips() {
  const group = _layers.tips.group;
  group.clearLayers();
  _layers.tips.markers = [];

  const list = _activeCategory === 'all'
    ? JAPAN_LANDMARKS
    : JAPAN_LANDMARKS.filter(l => l.category === _activeCategory);

  list.forEach(lm => {
    const marker = L.marker([lm.lat, lm.lng], {
      icon: _tipIcon(lm),
      zIndexOffset: 100,
    });
    marker.bindPopup(_tipPopup(lm), { maxWidth: 300, className: 'tip-popup' });
    group.addLayer(marker);
    _layers.tips.markers.push(marker);
  });

  _updateLegend();
}

function _tipIcon(lm) {
  const cat = CATEGORY_INFO[lm.category];
  return L.divIcon({
    className: 'tip-marker',
    html: `
      <div class="tip-marker__bubble" style="--cat-color:${cat.color}">
        <span class="tip-marker__icon">${lm.icon}</span>
        <div class="tip-marker__pulse"></div>
      </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -24],
  });
}

function _tipPopup(lm) {
  const cat = CATEGORY_INFO[lm.category];
  const stars = '⭐'.repeat(Math.round(lm.rating));
  return `
    <div class="tip-popup-content" style="--cat-color:${cat.color}">
      <div class="tip-popup__header">
        <span class="tip-popup__icon">${lm.icon}</span>
        <div>
          <h3 class="tip-popup__name">${_esc(lm.name)}</h3>
          <p class="tip-popup__name-jp">${lm.nameJP}</p>
        </div>
      </div>
      <div class="tip-popup__rating">${stars} ${lm.rating}/5</div>
      <div class="tip-popup__meta">
        <span>🕐 ${_esc(lm.openHours)}</span>
        <span>💰 ${_esc(lm.price)}</span>
        <span>⏱ ${_esc(lm.duration)}</span>
        <span>🚇 ${_esc(lm.nearestStation)}</span>
      </div>
      <p class="tip-popup__desc">${_esc(lm.description)}</p>
      <div class="tip-popup__tip">💡 <strong>TIP:</strong> ${_esc(lm.tip)}</div>
      <div class="tip-popup__actions">
        <button class="tip-popup__btn tip-popup__btn--primary"
                onclick="_mapPageAddToWishlist('${lm.id}')">+ Do wishlistu</button>
        <a href="https://www.google.com/maps/?q=${lm.lat},${lm.lng}"
           target="_blank" rel="noopener"
           class="tip-popup__btn tip-popup__btn--secondary">🗺️ Google Maps</a>
      </div>
    </div>`;
}

// Globální handler pro popup tlačítko (Leaflet HTML neumí ES module refs)
window._mapPageAddToWishlist = async (landmarkId) => {
  const lm = JAPAN_LANDMARKS.find(l => l.id === landmarkId);
  if (!lm || !state.user) return;

  // Mapování kategorií na wishlist CATEGORIES klíče
  const catMap = {
    temple: 'culture', castle: 'culture', nature: 'nature',
    food: 'food', popculture: 'experience',
    garden: 'nature', culture: 'culture', viewpoint: 'culture',
  };

  try {
    await addDoc(collection(db, 'ideas'), {
      title:         lm.name,
      description:   lm.description,
      category:      catMap[lm.category] ?? 'other',
      priority:      'nice',
      pinLat:        lm.lat,
      pinLng:        lm.lng,
      city:          lm.nearestStation,
      authorUid:     state.user.uid,
      authorNickname: state.profile?.nickname || state.user.email?.split('@')[0] || 'Někdo',
      authorAvatar:  state.profile?.avatar  || '👤',
      likes:         [],
      cosigns:       [],
      createdAt:     serverTimestamp(),
    });
    showToast(`✅ ${lm.name} přidáno do Wishlistu!`, 'success');
    _map?.closePopup();
  } catch (err) {
    console.error('[map-page] addToWishlist error:', err);
    showToast('Nepodařilo se přidat do wishlistu.', 'error');
  }
};

/* ── Live members ────────────────────────────────────────────── */

function _renderLiveMembers(members) {
  const group = _layers.live.group;

  _layers.live.markers.forEach((marker, uid) => {
    if (!members.find(m => m.userId === uid)) {
      group.removeLayer(marker);
      _layers.live.markers.delete(uid);
    }
  });

  members.forEach(data => {
    let marker = _layers.live.markers.get(data.userId);
    if (!marker) {
      marker = L.marker([data.lat, data.lng], {
        icon: _memberIcon(data, true),
        zIndexOffset: 1000,
      }).bindPopup(_memberPopup(data, true));
      group.addLayer(marker);
      _layers.live.markers.set(data.userId, marker);
    } else {
      marker.setLatLng([data.lat, data.lng]);
      marker.setIcon(_memberIcon(data, true));
    }
  });
}

function _renderLastKnownMembers(members) {
  const group = _layers.lastKnown.group;

  _layers.lastKnown.markers.forEach((marker, uid) => {
    if (!members.find(m => m.userId === uid)) {
      group.removeLayer(marker);
      _layers.lastKnown.markers.delete(uid);
    }
  });

  members.forEach(data => {
    let marker = _layers.lastKnown.markers.get(data.userId);
    if (!marker) {
      marker = L.marker([data.lat, data.lng], {
        icon: _memberIcon(data, false),
        zIndexOffset: 500,
      }).bindPopup(_memberPopup(data, false));
      group.addLayer(marker);
      _layers.lastKnown.markers.set(data.userId, marker);
    } else {
      marker.setLatLng([data.lat, data.lng]);
      marker.setIcon(_memberIcon(data, false));
    }
  });
}

function _memberIcon(data, isLive) {
  return L.divIcon({
    className: `member-marker member-marker--${isLive ? 'live' : 'lastknown'}`,
    html: `
      <div class="member-marker__bubble">
        <span class="member-marker__avatar">${data.avatar}</span>
        <span class="member-marker__name">${_esc(data.displayName)}</span>
      </div>
      <div class="member-marker__pin">
        ${isLive ? '<div class="member-marker__pulse"></div>' : ''}
        <div class="member-marker__dot"></div>
      </div>`,
    iconSize:    [120, 60],
    iconAnchor:  [60, 60],
    popupAnchor: [0, -60],
  });
}

function _memberPopup(data, isLive) {
  const d        = data.lastUpdate?.toDate ? data.lastUpdate.toDate() : new Date();
  const minsAgo  = Math.floor((Date.now() - d.getTime()) / 60_000);
  const timeText = minsAgo < 1    ? 'právě teď'
                 : minsAgo < 60   ? `před ${minsAgo} min`
                 : minsAgo < 1440 ? `před ${Math.floor(minsAgo / 60)} h`
                 :                  `před ${Math.floor(minsAgo / 1440)} dny`;
  const dateStr  = d.toLocaleString('cs-CZ', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

  return `
    <div style="text-align:center;padding:8px 4px;min-width:160px">
      <div style="font-size:2.5rem;line-height:1.1">${data.avatar}</div>
      <strong style="font-size:.95rem;display:block;margin:4px 0">${_esc(data.displayName)}</strong>
      ${isLive
        ? `<div style="color:#34C759;font-weight:700;font-size:.85rem">🟢 LIVE</div>`
        : `<div style="color:#8E8E93;font-size:.85rem">⚫ Last seen</div>`}
      <div style="color:#6E6E73;font-size:.75rem;margin-top:4px">${dateStr} (${timeText})</div>
      <a href="https://www.google.com/maps/?q=${data.lat},${data.lng}"
         target="_blank" rel="noopener"
         style="display:inline-block;margin-top:10px;padding:6px 14px;background:#0A84FF;color:#fff;border-radius:8px;text-decoration:none;font-size:.8rem;font-weight:700">
        🗺️ Google Maps
      </a>
    </div>`;
}

/* ── Wishlist vrstva ─────────────────────────────────────────── */

async function _loadWishlist() {
  if (_layers.wishlist.loaded) return;

  try {
    const snap = await getDocs(collection(db, 'ideas'));
    const group = _layers.wishlist.group;
    group.clearLayers();
    _layers.wishlist.markers = [];

    snap.docs.forEach(d => {
      const idea = { id: d.id, ...d.data() };
      const lat = idea.pinLat ?? idea.location?.lat ?? null;
      const lng = idea.pinLng ?? idea.location?.lng ?? null;
      if (lat == null || lng == null) return;

      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'wishlist-marker',
          html: `<div class="wishlist-marker__pin"><span>⭐</span></div>`,
          iconSize: [32, 40],
          iconAnchor: [16, 40],
          popupAnchor: [0, -40],
        }),
        zIndexOffset: 200,
      }).bindPopup(`
        <div style="padding:4px 2px;min-width:140px">
          <strong style="font-size:.9rem">${_esc(idea.title)}</strong>
          ${idea.city ? `<div style="margin-top:4px;font-size:.8rem;color:#6E6E73">📍 ${_esc(idea.city)}</div>` : ''}
        </div>`);

      group.addLayer(marker);
      _layers.wishlist.markers.push(marker);
    });

    _layers.wishlist.loaded = true;
    _updateLegend();
  } catch (err) {
    console.error('[map-page] loadWishlist:', err);
  }
}

/* ── Ovládací prvky ──────────────────────────────────────────── */

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

      L.DomEvent.on(btn, 'click', async (e) => {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        if (!navigator.geolocation) return;

        btn.innerHTML = '⏳';
        btn.classList.add('locate-btn--loading');

        try {
          const pos = await new Promise((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, {
              enableHighAccuracy: true, timeout: 10_000,
            })
          );

          if (_userLocationMarker) map.removeLayer(_userLocationMarker);
          _userLocationMarker = L.marker([pos.coords.latitude, pos.coords.longitude], {
            icon: L.divIcon({
              className: 'user-location-pin',
              html: `
                <div class="user-location-pin__pulse user-location-pin__pulse--1"></div>
                <div class="user-location-pin__pulse user-location-pin__pulse--2"></div>
                <div class="user-location-pin__pulse user-location-pin__pulse--3"></div>
                <div class="user-location-pin__core"></div>`,
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            }),
            zIndexOffset: 2000,
          }).addTo(map);

          map.flyTo([pos.coords.latitude, pos.coords.longitude], 14, { duration: 1.5 });
          btn.innerHTML = '📍';
          btn.classList.remove('locate-btn--loading');
          btn.classList.add('locate-btn--active');
        } catch {
          btn.innerHTML = '📍';
          btn.classList.remove('locate-btn--loading');
        }
      });

      return wrap;
    },
  });
  map.addControl(new LocateControl());
}

function _addLiveControl(map) {
  const LiveControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const wrap = L.DomUtil.create('div', 'leaflet-bar leaflet-control live-control');
      const btn  = L.DomUtil.create('a', 'live-btn', wrap);
      btn.href = '#';
      btn.setAttribute('role', 'button');

      const refresh = () => {
        const active = isLiveActive();
        btn.innerHTML = active ? '🟢' : '⚫';
        btn.title = active ? 'Vypnout sdílení polohy' : 'Zapnout Live polohu';
        btn.setAttribute('aria-label', btn.title);
        btn.classList.toggle('live-btn--active', active);
      };
      refresh();

      L.DomEvent.on(btn, 'click', async (e) => {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        btn.classList.add('live-btn--loading');
        await toggleLiveLocation(map);
        btn.classList.remove('live-btn--loading');
        refresh();
      });

      setInterval(refresh, 3_000);
      return wrap;
    },
  });
  map.addControl(new LiveControl());
}

/* ── Event listenery ─────────────────────────────────────────── */

function _setupEventListeners() {
  // Layer toggles
  document.querySelectorAll('.map-layer-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name  = btn.dataset.layer;
      const layer = _layers[name];
      if (!layer || !_map) return;

      layer.enabled = !layer.enabled;
      btn.classList.toggle('map-layer-btn--active', layer.enabled);

      if (layer.enabled) {
        if (name === 'wishlist' && !layer.loaded) {
          await _loadWishlist();
        }
        layer.group.addTo(_map);
      } else {
        _map.removeLayer(layer.group);
      }

      _updateLegend();
    });
  });

  // Category chips
  document.getElementById('mp-categories')?.addEventListener('click', e => {
    const chip = e.target.closest('.map-cat-chip');
    if (!chip) return;
    document.querySelectorAll('.map-cat-chip').forEach(c => c.classList.remove('map-cat-chip--active'));
    chip.classList.add('map-cat-chip--active');
    _activeCategory = chip.dataset.cat;
    _renderTips();
  });
}

/* ── Legenda ─────────────────────────────────────────────────── */

function _updateLegend() {
  const el = document.getElementById('mp-legend');
  if (!el) return;

  const tipsCount = _layers.tips.markers.length;
  const liveCount = _layers.live.markers.size;
  const lastCount = _layers.lastKnown.markers.size;
  const wlCount   = _layers.wishlist.loaded ? _layers.wishlist.markers.length : null;

  const items = [];
  if (_layers.tips.enabled)      items.push(`<span class="map-legend__item">🇯🇵 ${tipsCount} tipů</span>`);
  if (_layers.live.enabled && liveCount > 0)
    items.push(`<span class="map-legend__item map-legend__item--live">🟢 ${liveCount} live</span>`);
  if (_layers.lastKnown.enabled && lastCount > 0)
    items.push(`<span class="map-legend__item">⚫ ${lastCount} last seen</span>`);
  if (_layers.wishlist.enabled && wlCount != null)
    items.push(`<span class="map-legend__item">⭐ ${wlCount} wishlist</span>`);

  el.innerHTML = items.join('');
}

/* ── Cleanup ─────────────────────────────────────────────────── */

function _cleanup() {
  if (_liveListenerUnsub) { _liveListenerUnsub(); _liveListenerUnsub = null; }
  if (_map) { _map.remove(); _map = null; }
  delete window._mapPageAddToWishlist;

  // Reset layer state pro příští návštěvu stránky
  Object.values(_layers).forEach(l => {
    l.group = null;
    if (Array.isArray(l.markers)) l.markers = [];
    else l.markers = new Map();
    if ('loaded' in l) l.loaded = false;
  });
  _layers.tips.enabled      = true;
  _layers.live.enabled      = true;
  _layers.lastKnown.enabled = true;
  _layers.wishlist.enabled  = false;
}

/* ── Helper ──────────────────────────────────────────────────── */

function _esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
