// components/rover-visual-panel.js
// Top-down rover view driven entirely by rover telemetry:
//   steering angle  <- uros linear_actuator (/drivetrain/feedback/wheel_curr),
//                      or rover_kinematics' command while that feedback is stale
//   wheel speed     <- kraken_drive (/drivetrain/telemetry/wheel_state)

const WHEELS = ["fl", "fr", "rl", "rr"];

// rover_kinematics: max_linear_speed (0.6 m/s) / (2*pi*wheel_radius (0.15 m))
const MAX_WHEEL_RPS = 0.64;

class RoverVisualPanel extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add("card");

    this.innerHTML = `
      <h3>Rover Drive</h3>
      <div class="rover-body">
        ${WHEELS.map(w => `
          <div class="wheel-slot ${w}">
            <div class="wheel" data-wheel="${w}"></div>
            <span class="wheel-rps" data-rps="${w}">—</span>
          </div>`).join("")}
      </div>
      <div class="stat-list">
        <div class="stat"><span class="stat-label">Drive mode</span><strong id="drive-mode-value">unknown</strong></div>
        <div class="stat"><span class="stat-label">Steering</span><span id="steer-source">no data</span></div>
      </div>
    `;

    this._wheelEls = {};
    this._rpsEls = {};
    for (const w of WHEELS) {
      this._wheelEls[w] = this.querySelector(`[data-wheel="${w}"]`);
      this._rpsEls[w] = this.querySelector(`[data-rps="${w}"]`);
    }
    this._steerSourceEl = this.querySelector("#steer-source");
  }

  // wheels: { fl: { measured_rps, steer, ... }, ... } from the Pi's wheel_state
  update(wheels, steerSource) {
    if (!this._wheelEls || !wheels) return;

    for (const w of WHEELS) {
      const data = wheels[w];
      if (!data) continue;

      // ROS angles are CCW-positive; CSS rotate() is clockwise-positive.
      const steer = Number(data.steer) || 0;
      const rps = Number(data.measured_rps) || 0;
      const intensity = Math.min(1, Math.abs(rps) / MAX_WHEEL_RPS);

      const wheel = this._wheelEls[w];
      wheel.style.transform = `rotate(${-steer}rad)`;
      wheel.style.setProperty("--speed", intensity.toFixed(2));
      wheel.classList.toggle("reverse", rps < -0.01);

      this._rpsEls[w].textContent = rps.toFixed(2);
    }

    if (steerSource) {
      this._steerSourceEl.textContent =
        steerSource === "feedback" ? "measured (uros)" :
        steerSource === "command" ? "commanded (uros feedback stale)" :
        "no data";
    }
  }
}

customElements.define("rover-visual-panel", RoverVisualPanel);
