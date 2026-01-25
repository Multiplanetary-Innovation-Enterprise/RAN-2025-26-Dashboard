// components/rover-visual-panel.js
class RoverVisualPanel extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add('panel');

    this.innerHTML = `
      <h2>Rover Drive Visualization</h2>
      <div id="rover-visual">
        <div class="rover-body">
          <div class="wheel front-left"></div>
          <div class="wheel front-right"></div>
          <div class="wheel rear-left"></div>
          <div class="wheel rear-right"></div>
        </div>
        <div class="throttle-indicator">
          <div class="throttle-bar">
            <div id="throttle-fill"></div>
          </div>
          <div id="throttle-label">Throttle: 0%</div>
        </div>
      </div>
      <p class="hint">
        Visualizes actual wheel commands and throttle from rover telemetry.
      </p>
    `;

    // Cache wheel elements
    this.wheels = {
      fl: this.querySelector('.wheel.front-left'),
      fr: this.querySelector('.wheel.front-right'),
      rl: this.querySelector('.wheel.rear-left'),
      rr: this.querySelector('.wheel.rear-right')
    };

    this.throttleFill = this.querySelector('#throttle-fill');
    this.throttleLabel = this.querySelector('#throttle-label');
  }

  /**
   * Update wheel angles and throttle based on telemetry
   * wheel_cmd: {
   *   fl: { rps: number, angle: number },
   *   fr: { rps: number, angle: number },
   *   rl: { rps: number, angle: number },
   *   rr: { rps: number, angle: number }
   * }
   */
  updateWheelAnimation(wheel_cmd) {
    if (!wheel_cmd) return;

    // Animate each wheel: rotation based on RPS, steering angle for front wheels
    for (const key of ['fl', 'fr', 'rl', 'rr']) {
      const el = this.wheels[key];
      if (!el || !wheel_cmd[key]) continue;

      // Front wheels steer with angle, all wheels rotate with rps
      const angleDeg = wheel_cmd[key].angle || 0; // radians -> deg if needed
      const rps = wheel_cmd[key].rps || 0;

      const rotationDeg = (performance.now() * rps * 360 / 1000) % 360;

      if (key === 'fl' || key === 'fr') {
        // apply steering + rotation
        el.style.transform = `rotate(${angleDeg * 180 / Math.PI}deg) translateY(0) rotate(${rotationDeg}deg)`;
      } else {
        // rear wheels just rotate
        el.style.transform = `rotate(${rotationDeg}deg)`;
      }
    }

    // Update throttle based on average forward/back RPS (fl + fr average)
    const avgRps = ((wheel_cmd.fl?.rps || 0) + (wheel_cmd.fr?.rps || 0)) / 2;
    const throttlePercent = Math.min(Math.abs(avgRps) * 50, 100); // scale to 0-100%
    this.throttleFill.style.width = `${throttlePercent}%`;
    this.throttleLabel.textContent = `Throttle: ${throttlePercent.toFixed(0)}%`;
  }
}

customElements.define('rover-visual-panel', RoverVisualPanel);