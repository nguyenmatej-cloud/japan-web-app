/** itinerary.js – Itinerář / Kalendář. Bude implementován v kroku 4. */
export function render(container) {
  container.innerHTML = `
    <div class="page page--enter">
      <div class="page-header">
        <h1 class="page-header__title">📅 Itinerář</h1>
        <p class="page-header__subtitle">14denní plán cesty (7.–20. 9. 2026)</p>
      </div>
      <div class="empty-state">
        <span class="empty-state__icon" aria-hidden="true">📅</span>
        <h2 class="empty-state__title">Itinerář – připravujeme!</h2>
        <p class="empty-state__desc">
          Aktivní ve Fázi 2. Admin sestaví itinerář drag &amp; drop z wishlistu.<br>
          Bude dostupný v kroku 4 implementace.
        </p>
      </div>
    </div>`;
}
