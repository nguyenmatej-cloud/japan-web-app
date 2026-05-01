/**
 * live-location.js – Sdílení live polohy mezi členy skupiny.
 * Mutual visibility: vidíš ostatní jen pokud máš live zapnuté.
 */
import { db } from './firebase-config.js';
import { state, showToast } from './app.js';
import {
  doc, setDoc, deleteDoc,
  collection, query, where, onSnapshot,
  serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';

/* ── Konstanty ───────────────────────────────────────────────── */

const UPDATE_INTERVAL_MS = 5_000;          // 5s — max přesnost pro Japonsko
const MIN_DISTANCE_M     = 10;             // 10m — okamžitý update při pohybu
const GPS_TIMEOUT_MS     = 15_000;         // 15s timeout pro GPS
const AUTO_OFF_MS        = 4 * 60 * 60 * 1000; // 4 hodiny

/* ── Stav modulu ─────────────────────────────────────────────── */

let _isLive          = false;
let _watchId         = null;
let _lastPosition    = null;
let _lastUpdateTime  = 0;
let _autoOffId       = null;

let _liveListenerUnsub = null;
let _liveMembers       = new Map(); // userId → Firestore data
let _liveMarkers       = new Map(); // userId → L.marker
let _activeMap         = null;      // aktuálně připojená Leaflet mapa

/* ── Public API ──────────────────────────────────────────────── */

export async function startLiveLocation(map) {
  if (_isLive) return;

  if (!navigator.geolocation) {
    showToast('Tvůj prohlížeč nepodporuje geolokaci.', 'error');
    return;
  }
  if (!state.user) {
    showToast('Musíš být přihlášen.', 'error');
    return;
  }

  try {
    const position = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout:     GPS_TIMEOUT_MS,
        maximumAge:  0,
      })
    );

    console.log(`[live] GPS přesnost: ±${Math.round(position.coords.accuracy)}m`);

    _isLive         = true;
    _lastPosition   = position;
    _lastUpdateTime = Date.now();
    _activeMap      = map;

    await _writeToFirestore(position);
    _startWatch();
    _scheduleAutoOff();
    _startListening(map);
    _showBanner();
    _setHeaderDot(true);
    _updateAccuracyDisplay(position.coords.accuracy);

    showToast('🟢 Tvá poloha je teď live (max přesnost)', 'success');

  } catch (err) {
    _isLive = false;
    const msg = err.code === 1 ? 'Povol přístup k poloze v nastavení prohlížeče.'
              : err.code === 2 ? 'Poloha není dostupná - zkontroluj GPS.'
              : err.code === 3 ? 'Vypršel čas - zkus znovu (potřebuješ otevřené nebe).'
              : 'Nepodařilo se zapnout sdílení polohy.';
    showToast(msg, 'error');
  }
}

export async function stopLiveLocation() {
  if (!_isLive) return;
  _isLive = false;

  if (_watchId !== null) {
    navigator.geolocation.clearWatch(_watchId);
    _watchId = null;
  }

  // Uložit jako last-known (enabled: false) místo mazání — 7 dní TTL
  if (state.user?.uid && _lastPosition) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    setDoc(doc(db, 'liveLocations', state.user.uid), {
      userId:      state.user.uid,
      displayName: state.profile?.nickname || state.user.displayName || state.user.email?.split('@')[0] || 'Někdo',
      avatar:      state.profile?.avatar  || '👤',
      lat:         _lastPosition.coords.latitude,
      lng:         _lastPosition.coords.longitude,
      accuracy:    _lastPosition.coords.accuracy,
      enabled:     false,
      lastUpdate:  serverTimestamp(),
      stoppedAt:   serverTimestamp(),
      expiresAt:   Timestamp.fromDate(expiresAt),
    }).catch(err => console.warn('[live] save last-known error:', err));
  }

  if (_liveListenerUnsub) { _liveListenerUnsub(); _liveListenerUnsub = null; }
  if (_autoOffId)         { clearTimeout(_autoOffId); _autoOffId = null; }

  _removeAllMarkers();
  _liveMembers.clear();
  _activeMap = null;

  _hideBanner();
  _setHeaderDot(false);

  showToast('⚫ Sdílení vypnuto. Tvá poslední poloha zůstane viditelná.', 'info');
}

export async function toggleLiveLocation(map) {
  if (_isLive) {
    await stopLiveLocation();
  } else {
    await startLiveLocation(map);
  }
}

export function isLiveActive() { return _isLive; }

/**
 * Volej z initMap() po vytvoření nové mapy — re-připojí live markery.
 */
export function attachMap(map) {
  _activeMap = map;
  if (_isLive) {
    _removeAllMarkers();
    _liveMembers.forEach((data, userId) => _addOrUpdateMarker(map, userId, data));
  }
}

/**
 * Volej z cleanup() PŘED _map.remove() — vyčistí reference na markery
 * bez pokusu o odebírání z již zničené mapy.
 */
export function detachMap() {
  _liveMarkers.clear();
  _activeMap = null;
}

/* ── Sledování polohy ────────────────────────────────────────── */

function _startWatch() {
  _watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const timeSince     = Date.now() - _lastUpdateTime;
      const distanceMoved = _lastPosition
        ? _haversine(_lastPosition.coords.latitude, _lastPosition.coords.longitude,
                     pos.coords.latitude, pos.coords.longitude)
        : Infinity;

      if (timeSince >= UPDATE_INTERVAL_MS || distanceMoved >= MIN_DISTANCE_M) {
        console.log(`[live] Update GPS: ±${Math.round(pos.coords.accuracy)}m, pohyb ${Math.round(distanceMoved)}m`);
        _lastPosition   = pos;
        _lastUpdateTime = Date.now();
        _writeToFirestore(pos);
        _updateAccuracyDisplay(pos.coords.accuracy);
        _scheduleAutoOff();
      }
    },
    (err) => {
      console.error('[live] watchPosition error:', err);
      if (err.code === 3) _updateAccuracyDisplay(null); // timeout = GPS ztráta
    },
    { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 0 }
  );
}

async function _writeToFirestore(position) {
  if (!state.user) return;

  const now       = new Date();
  const expiresAt = new Date(now.getTime() + AUTO_OFF_MS);

  await setDoc(doc(db, 'liveLocations', state.user.uid), {
    userId:      state.user.uid,
    displayName: state.profile?.nickname || state.user.displayName || state.user.email?.split('@')[0] || 'Někdo',
    avatar:      state.profile?.avatar  || '👤',
    lat:         position.coords.latitude,
    lng:         position.coords.longitude,
    accuracy:    position.coords.accuracy,
    heading:     position.coords.heading  ?? null,
    speed:       position.coords.speed    ?? null,
    enabled:     true,
    lastUpdate:  serverTimestamp(),
    startedAt:   Timestamp.fromDate(now),
    expiresAt:   Timestamp.fromDate(expiresAt),
  }).catch(err => console.error('[live] Firestore write error:', err));
}

/* ── Listener pro ostatní členy ──────────────────────────────── */

function _startListening(map) {
  if (_liveListenerUnsub) _liveListenerUnsub();

  const q = query(collection(db, 'liveLocations'), where('enabled', '==', true));

  _liveListenerUnsub = onSnapshot(q, (snap) => {
    const now        = Date.now();
    const newMembers = new Map();

    snap.docs.forEach(d => {
      const data = d.data();
      if (data.userId === state.user?.uid) return; // přeskoč sebe

      // Přeskoč expirované
      const expMs = data.expiresAt?.toMillis ? data.expiresAt.toMillis()
                  : data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
      if (expMs && expMs < now) {
        deleteDoc(doc(db, 'liveLocations', data.userId)).catch(() => {});
        return;
      }

      newMembers.set(data.userId, data);
    });

    console.log(`[live] ${newMembers.size} live member(s) visible`);
    _syncMarkers(_activeMap, newMembers);
    _liveMembers = newMembers;
  }, err => console.error('[live] snapshot error:', err));
}

/* ── Markery na mapě ─────────────────────────────────────────── */

function _syncMarkers(map, members) {
  // Smaž markery členů co již nejsou live
  _liveMarkers.forEach((marker, userId) => {
    if (!members.has(userId)) {
      if (map) map.removeLayer(marker);
      _liveMarkers.delete(userId);
    }
  });

  // Přidej / aktualizuj
  if (map) {
    members.forEach((data, userId) => _addOrUpdateMarker(map, userId, data));
  }
}

function _addOrUpdateMarker(map, userId, data) {
  let marker = _liveMarkers.get(userId);

  if (!marker) {
    marker = window.L.marker([data.lat, data.lng], {
      icon: _createLiveIcon(data),
      zIndexOffset: 900,
    }).addTo(map);
    _liveMarkers.set(userId, marker);
  } else {
    marker.setLatLng([data.lat, data.lng]);
    marker.setIcon(_createLiveIcon(data));
  }

  const lastDate   = data.lastUpdate?.toDate ? data.lastUpdate.toDate() : new Date();
  const minsAgo    = Math.floor((Date.now() - lastDate.getTime()) / 60_000);
  const timeText   = minsAgo < 1  ? 'právě teď'
                   : minsAgo < 60 ? `před ${minsAgo} min`
                   : `před ${Math.floor(minsAgo / 60)} h`;

  marker.bindPopup(`
    <div style="text-align:center;padding:4px 8px">
      <div style="font-size:2rem;line-height:1.2">${data.avatar}</div>
      <strong style="font-size:.9rem">${_esc(data.displayName)}</strong><br>
      <small style="color:#6E6E73">📍 ${timeText}</small>
    </div>
  `);
}

function _createLiveIcon(data) {
  return window.L.divIcon({
    className: 'live-member-marker',
    html: `
      <div class="live-member-marker__bubble">
        <span class="live-member-marker__avatar">${data.avatar}</span>
        <span class="live-member-marker__name">${_esc(data.displayName)}</span>
      </div>
      <div class="live-member-marker__pin">
        <div class="live-member-marker__pulse"></div>
        <div class="live-member-marker__dot"></div>
      </div>
    `,
    iconSize:    [130, 62],
    iconAnchor:  [65, 62],
    popupAnchor: [0, -62],
  });
}

function _removeAllMarkers() {
  if (_activeMap) {
    _liveMarkers.forEach(m => _activeMap.removeLayer(m));
  }
  _liveMarkers.clear();
}

/* ── Refresh + Accuracy display ──────────────────────────────── */

export async function refreshLocation() {
  if (!_isLive) {
    showToast('Nejdřív zapni sdílení polohy.', 'warning');
    return;
  }

  const refreshBtn = document.getElementById('btn-refresh-live');
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.innerHTML = '⏳'; }

  try {
    const position = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout:    GPS_TIMEOUT_MS,
        maximumAge: 0,
      })
    );

    _lastPosition   = position;
    _lastUpdateTime = Date.now();
    await _writeToFirestore(position);
    _updateAccuracyDisplay(position.coords.accuracy);
    _scheduleAutoOff();

    showToast(`📍 Aktualizováno (přesnost ±${Math.round(position.coords.accuracy)}m)`, 'success');

  } catch (err) {
    console.error('[live] Refresh error:', err);
    showToast('Chyba při získání polohy.', 'error');
  } finally {
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.innerHTML = '🔄'; }
  }
}

function _updateAccuracyDisplay(accuracy) {
  const el = document.getElementById('live-accuracy');
  if (!el) return;

  if (accuracy === null || accuracy === undefined) {
    el.textContent = '🔴 GPS chyba';
    el.className   = 'live-banner__accuracy live-banner__accuracy--bad';
    return;
  }

  if (accuracy <= 20) {
    el.textContent = `🟢 ±${Math.round(accuracy)}m`;
    el.className   = 'live-banner__accuracy live-banner__accuracy--good';
  } else if (accuracy <= 50) {
    el.textContent = `🟡 ±${Math.round(accuracy)}m`;
    el.className   = 'live-banner__accuracy live-banner__accuracy--ok';
  } else {
    el.textContent = `🔴 ±${Math.round(accuracy)}m`;
    el.className   = 'live-banner__accuracy live-banner__accuracy--bad';
  }
}

/* ── Auto-off ────────────────────────────────────────────────── */

function _scheduleAutoOff() {
  if (_autoOffId) clearTimeout(_autoOffId);
  _autoOffId = setTimeout(async () => {
    await stopLiveLocation();
    showToast('⏱ Sdílení polohy automaticky vypnuto po 4 h.', 'info');
  }, AUTO_OFF_MS);
}

/* ── UI ──────────────────────────────────────────────────────── */

function _showBanner() {
  document.getElementById('live-location-banner')?.remove();

  const banner = document.createElement('div');
  banner.id        = 'live-location-banner';
  banner.className = 'live-banner';
  banner.innerHTML = `
    <div class="live-banner__content">
      <div class="live-banner__pulse"></div>
      <span class="live-banner__icon">🟢</span>
      <span class="live-banner__text">Live</span>
      <span class="live-banner__accuracy" id="live-accuracy">📡 Hledám GPS…</span>
      <button class="live-banner__btn live-banner__btn--refresh" id="btn-refresh-live" title="Aktualizovat polohu">🔄</button>
      <button class="live-banner__btn" id="btn-stop-live">Vypnout</button>
    </div>
  `;
  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add('live-banner--visible'));
  document.getElementById('btn-refresh-live')?.addEventListener('click', refreshLocation);
  document.getElementById('btn-stop-live')?.addEventListener('click', stopLiveLocation);
}

function _hideBanner() {
  const banner = document.getElementById('live-location-banner');
  if (!banner) return;
  banner.classList.remove('live-banner--visible');
  setTimeout(() => banner.remove(), 350);
}

function _setHeaderDot(on) {
  const avatarBtn = document.querySelector('.app-header .btn-avatar') ||
                    document.querySelector('.app-header [data-action="profile"]');
  if (!avatarBtn) return;

  avatarBtn.querySelector('.live-status-dot')?.remove();
  if (!on) return;

  const dot = document.createElement('span');
  dot.className = 'live-status-dot';
  avatarBtn.style.position = 'relative';
  avatarBtn.appendChild(dot);
}

/* ── Helpers ─────────────────────────────────────────────────── */

function _haversine(lat1, lng1, lat2, lng2) {
  const R  = 6_371_000;
  const d1 = (lat2 - lat1) * Math.PI / 180;
  const d2 = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(d1 / 2) ** 2
           + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
           * Math.sin(d2 / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

/* ── Export pro Map page ─────────────────────────────────────── */

/**
 * Poslouchá na všechny live + last-known polohy ostatních.
 * Volej z map-page.js. Vrátí unsubscribe funkci.
 */
export function listenToAllLocations(onUpdate) {
  const q = query(collection(db, 'liveLocations'));

  return onSnapshot(q, snap => {
    const now       = Date.now();
    const live      = [];
    const lastKnown = [];

    snap.docs.forEach(d => {
      const data = { id: d.id, ...d.data() };
      if (data.userId === state.user?.uid) return; // přeskoč sebe

      // Přeskoč expirované
      const expMs = data.expiresAt?.toMillis ? data.expiresAt.toMillis()
                  : data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
      if (expMs && expMs < now) {
        deleteDoc(doc(db, 'liveLocations', data.userId)).catch(() => {});
        return;
      }

      if (data.enabled) {
        live.push(data);
      } else {
        lastKnown.push(data);
      }
    });

    onUpdate({ live, lastKnown });
  }, err => console.error('[live] listenToAllLocations error:', err));
}
