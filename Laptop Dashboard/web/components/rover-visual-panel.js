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
      
      <div class="drive-mode-indicator">
        <span class="label">Drive Mode:</span>
        <span id="drive-mode-value">Unknown</span>
      </div>
    `;
  }
}

customElements.define('rover-visual-panel', RoverVisualPanel);