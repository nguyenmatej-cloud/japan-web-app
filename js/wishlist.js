/** wishlist.js – Skupinový Wishlist. Bude implementován v kroku 2. */
export function render(container) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-header__title">⭐ Skupinový Wishlist</h1>
        <p class="page-header__subtitle">Nápady na aktivity, jídlo a místa v Japonsku</p>
      </div>
      <div class="empty-state">
        <span class="empty-state__icon" aria-hidden="true">⭐</span>
        <h2 class="empty-state__title">Wishlist – připravujeme!</h2>
        <p class="empty-state__desc">
          Tento modul bude plně funkční v dalším kroku.<br>
          Přidávejte nápady, lajkujte a co-signujte přání ostatních.
        </p>
      </div>
    </div>`;
}
