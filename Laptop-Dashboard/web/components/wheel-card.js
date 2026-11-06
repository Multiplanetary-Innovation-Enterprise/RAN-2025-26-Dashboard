// components/wheel-card.js
// Per-wheel Kraken telemetry. Usage: <wheel-card label="Front Left"></wheel-card>

const FIELDS = ["rps", "cmd", "steer", "current", "temp", "fault"];

class WheelCard extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add("wheel-card");

    this.innerHTML = `
      <h3>${this.getAttribute("label") ?? ""}</h3>
      <div class="stat-list">
        <div class="stat"><span class="stat-label">RPS</span><span data-f="rps">—</span></div>
        <div class="stat"><span class="stat-label">Cmd</span><span data-f="cmd">—</span></div>
        <div class="stat"><span class="stat-label">Steer</span><span data-f="steer">—</span></div>
        <div class="stat"><span class="stat-label">Current</span><span data-f="current">—</span></div>
        <div class="stat"><span class="stat-label">Temp</span><span data-f="temp">—</span></div>
        <div class="stat"><span class="stat-label">Status</span><span data-f="fault">—</span></div>
      </div>
    `;

    this._el = {};
    for (const f of FIELDS) this._el[f] = this.querySelector(`[data-f="${f}"]`);
  }

  // faultState: "ok" | "fault" | "disconnected"
  update(data, faultState) {
    if (!this._el || !data) return;

    const fmt = (v, digits) => (Number(v) || 0).toFixed(digits);

    this._el.rps.textContent = fmt(data.measured_rps, 2);
    this._el.cmd.textContent = fmt(data.commanded_rps, 2);
    this._el.steer.textContent = `${fmt((Number(data.steer) || 0) * 180 / Math.PI, 1)}°`;
    this._el.current.textContent = `${fmt(data.current, 1)} A`;
    this._el.temp.textContent = `${fmt(data.temp, 1)} °C`;

    const fault = this._el.fault;
    fault.textContent =
      faultState === "disconnected" ? "NOT CONNECTED" :
      faultState === "fault" ? "FAULT" : "OK";
    fault.className = `fault-${faultState === "disconnected" ? "disconnected" : faultState === "fault" ? "active" : "ok"}`;
  }
}

customElements.define("wheel-card", WheelCard);
