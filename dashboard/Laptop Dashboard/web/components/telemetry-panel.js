// components/telemetry-panel.js
class TelemetryPanel extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add('card');
    this.id = this.id || 'telemetrySection';

    this.innerHTML = `
      <h3>Telemetry</h3>
      <div>IMU rpy (rad): <span id="imuRpy">-</span></div>
      <div>Enc rps L/R: <span id="encRps">-</span></div>
      <div>Battery: <span id="battery">-</span></div>
      <div>Net kbps (ctl | tlm | vid): <span id="netKbps">-</span></div>
    `;
  }
}

customElements.define('telemetry-panel', TelemetryPanel);
