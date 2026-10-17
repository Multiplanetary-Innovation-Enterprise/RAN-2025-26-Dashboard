// components/estop-panel.js
class EStopPanel extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add("card");

    this.innerHTML = `
      <h3>E-STOP</h3>
      <div class="row">
        <button id="btnEstop" class="danger">E-STOP</button>
        <button id="btnEstopClear">Clear</button>
      </div>
      <div>State: <strong id="estopState" class="estop-unknown">unknown</strong></div>
      <div>Motion owner: <strong id="owner">?</strong></div>
      <p class="note">
        Space bar also triggers E-STOP. While latched, the Pi publishes zeroed
        joystick commands; it does not stop autonomy.
      </p>
    `;
  }
}

customElements.define("estop-panel", EStopPanel);
