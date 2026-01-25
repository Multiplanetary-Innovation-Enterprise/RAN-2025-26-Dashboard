// components/queue-panel.js
class QueuePanel extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add('card');
    this.id = this.id || 'queueSection';

    this.innerHTML = `
      <h3>Command Queue</h3>
      <div class="row">
        <label>Distance (m)
          <input id="inDistance" type="number" value="1.0" step="0.1">
        </label>
        <label>Heading (deg)
          <input id="inHeading" type="number" value="0" step="5">
        </label>
        <label>Max speed (m/s)
          <input id="inMaxSpeed" type="number" value="0.4" step="0.1">
        </label>
      </div>
      <div class="row">
        <button id="btnEnqueue">Enqueue</button>
        <button id="btnCancel">Cancel Active</button>
      </div>
      <div id="queueState">idle</div>
    `;
  }
}

customElements.define('queue-panel', QueuePanel);
