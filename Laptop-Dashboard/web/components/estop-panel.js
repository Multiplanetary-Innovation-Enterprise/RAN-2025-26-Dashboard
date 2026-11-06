// components/estop-panel.js
class EStopPanel extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add("card");

    this.innerHTML = `
      <h3>E-STOP</h3>
      <div class="estop-actions">
        <button id="btnEstop" class="danger">E-STOP</button>
        <button id="btnEstopClear">Clear</button>
      </div>
      <div class="stat-list">
        <div class="stat"><span class="stat-label">State</span><strong id="estopState" class="estop-unknown">unknown</strong></div>
        <div class="stat"><span class="stat-label">Motion owner</span><strong id="owner">?</strong></div>
      </div>
      <p class="note">
        Space bar = E-STOP. Holds all drive wheels at 0 (teleop and autonomy).
      </p>
    `;
  }
}

customElements.define("estop-panel", EStopPanel);
