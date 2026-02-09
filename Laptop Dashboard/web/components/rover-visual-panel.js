// components/rover-visual-panel.js
class RoverVisualPanel extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add('card');
    this.id = this.id || 'roverVisualSection';

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
        Current mapping: Left stick X = steering, Left stick Y = throttle.
      </p>
    `;
  }
}

customElements.define('rover-visual-panel', RoverVisualPanel);