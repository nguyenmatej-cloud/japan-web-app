/** finance.js – Finance & Settle Up. Bude implementován v kroku 3. */
export function render(container) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-header__title">💰 Finance & Settle Up</h1>
        <p class="page-header__subtitle">Společné výdaje a vyrovnání dluhů</p>
      </div>
      <div class="empty-state">
        <span class="empty-state__icon" aria-hidden="true">💰</span>
        <h2 class="empty-state__title">Finance – připravujeme!</h2>
        <p class="empty-state__desc">
          Sleduj výdaje v JPY/CZK, rozděluj náklady a nechej aplikaci spočítat, kdo komu dluží.<br>
          Bude dostupné v kroku 3 implementace.
        </p>
      </div>
    </div>`;
}
