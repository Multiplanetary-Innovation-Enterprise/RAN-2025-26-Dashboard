// components/teleop-panel.js
class TeleopPanel extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add('card');
    this.id = this.id || 'teleopSection';

    this.innerHTML = `
      <h3>Teleop</h3>
      <button id="btnEstop" class="danger">E-STOP</button>
      <div>Owner: <strong id="owner">?</strong></div>
      <div>lx: <span id="lx">0.00</span> m/s | az: <span id="az">0.00</span> rad/s</div>
      <p class="note">
        Keyboard: W/S = forward/back, A/D = left/right. Rate limited to 20 Hz.
      </p>
    `;
  }
}

customElements.define('teleop-panel', TeleopPanel);
