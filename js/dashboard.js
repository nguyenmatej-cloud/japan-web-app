/**
 * dashboard.js – Modul Dashboard (Fáze 1 & 2).
 * Exportuje render(container) → cleanup funkci.
 */
import { state } from './app.js';

const DEPARTURE         = new Date('2026-09-07T00:00:00+02:00');
const PLANNING_DEADLINE  = new Date('2026-07-22T00:00:00+02:00');

export function render(container) {
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
          <div class="stat-card__value">6</div>
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

    </div>
  `;

  // Countdown interval
  const intervalId = setInterval(tickCountdowns, 1000);

  function tickCountdowns() {
    const mainEl     = document.getElementById('countdown-main');
    const planningEl = document.getElementById('countdown-planning');

    if (mainEl)     mainEl.innerHTML     = renderCountdownUnits(DEPARTURE);
    if (planningEl) planningEl.textContent = renderCountdownShort(PLANNING_DEADLINE);
  }

  // Vrátí cleanup funkci – router ji zavolá při odchodu ze stránky
  return () => clearInterval(intervalId);
}

/* ── Pomocné funkce ──────────────────────────────────────────── */

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
