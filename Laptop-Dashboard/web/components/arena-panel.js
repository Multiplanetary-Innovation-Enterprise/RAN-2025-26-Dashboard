// components/arena-panel.js
class ArenaPanel extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add('card');

    this.innerHTML = `
      <h3>Arena</h3>
      <div class="arena-container">
        <div class="arena-placeholder">
          Arena view coming soon
        </div>
      </div>
    `;
  }
}

customElements.define('arena-panel', ArenaPanel);
