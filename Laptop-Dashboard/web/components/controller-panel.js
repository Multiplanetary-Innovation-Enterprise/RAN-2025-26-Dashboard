// components/controller-panel.js
class ControllerPanel extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add('panel');

    this.innerHTML = `
      <h2>Controller Status</h2>
      <div id="controller-slots">
        <div class="controller-slot" data-slot="0">
          <h3>Controller 1</h3>
          <p class="status">Not connected</p>
          <div class="buttons-grid"></div>
          <div class="sticks-row">
            <div class="stick-visual">
              <div class="stick-origin">
                <div class="stick-dot" id="left-stick-dot"></div>
              </div>
              <div class="stick-label">Left Stick</div>
            </div>
            <div class="stick-visual">
              <div class="stick-origin">
                <div class="stick-dot" id="right-stick-dot"></div>
              </div>
              <div class="stick-label">Right Stick</div>
            </div>
          </div>
          <pre class="pressed-display" id="pressed-summary">
No input yet…
          </pre>
        </div>

        <div class="controller-slot" data-slot="1">
          <h3>Controller 2 (optional)</h3>
          <p class="status">Not connected</p>
          <div class="buttons-grid"></div>
        </div>
      </div>
    `;
  }
}

customElements.define('controller-panel', ControllerPanel);