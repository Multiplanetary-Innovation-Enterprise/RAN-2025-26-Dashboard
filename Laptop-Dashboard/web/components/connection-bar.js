// components/connection-bar.js
class ConnectionBar extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.innerHTML = `
      <header class="bar">
        <button id="btnConnect">Connect</button>
        <span id="connStatus">disconnected</span>
      </header>
    `;
  }
}

customElements.define('connection-bar', ConnectionBar);
