// components/connection-bar.js
class ConnectionBar extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.innerHTML = `
      <header class="bar">
        <button id="btnConnect">Connect</button>
        <span id="connStatus" class="pill">disconnected</span>
        <span id="linkLaptop" class="pill link" data-state="off"
              title="Browser ⇄ laptop relay: heartbeat round trip and loss over the last ~5 s">
          <span class="link-name">Laptop</span>
          <span class="link-detail">—</span>
        </span>
        <span id="linkRover" class="pill link" data-state="off"
              title="Laptop ⇄ Pi: the Pi's heartbeat round trip and how fresh its telemetry is">
          <span class="link-name">Rover</span>
          <span class="link-detail">—</span>
        </span>
        <span id="linkWifi" class="pill link" data-state="off">
          <span class="link-name">Wi-Fi</span>
          <span class="link-detail">—</span>
        </span>
        <span id="alertMsg"></span>
      </header>
    `;

    // Mirror the status text into data-state so the status pill dot can be colored
    const status = this.querySelector("#connStatus");
    const sync = () => {
      const text = status.textContent;
      status.dataset.state =
        text === "connected" ? "ok" :
        /^(re)?connecting/.test(text) ? "warn" : "off";
    };
    new MutationObserver(sync).observe(status, { childList: true, characterData: true, subtree: true });
    sync();
  }
}

customElements.define('connection-bar', ConnectionBar);
