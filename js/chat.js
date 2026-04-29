/** chat.js – Skupinový chat. Bude implementován v kroku 5. */
export function render(container) {
  container.innerHTML = `
    <div class="page page--enter">
      <div class="page-header">
        <h1 class="page-header__title">💬 Chat</h1>
        <p class="page-header__subtitle">Skupinový real-time chat</p>
      </div>
      <div class="empty-state">
        <span class="empty-state__icon" aria-hidden="true">💬</span>
        <h2 class="empty-state__title">Chat – připravujeme!</h2>
        <p class="empty-state__desc">
          Real-time skupinový chat přes Firestore.<br>
          Bude dostupný v kroku 5 implementace.
        </p>
      </div>
    </div>`;
}
