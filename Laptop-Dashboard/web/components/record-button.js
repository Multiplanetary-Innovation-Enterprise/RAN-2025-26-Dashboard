// components/record-button.js
// Start/stop button for the power CSV recorder (recorder.js). Lives in the
// connection bar so it is reachable from every page.

import { isRecording, startRecording, stopRecording, recordStatus } from "../recorder.js";

class RecordButton extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.innerHTML = `
      <button class="rec-button" data-state="idle"
              title="Record power telemetry to a CSV file (downloads when stopped)">
        <span class="rec-dot" aria-hidden="true"></span>
        <span class="rec-label">Record CSV</span>
      </button>
    `;

    this._button = this.querySelector("button");
    this._label = this.querySelector(".rec-label");

    this._button.addEventListener("click", () => {
      if (isRecording()) stopRecording();
      else startRecording();
    });

    window.addEventListener("recorder", e => this.onRecorder(e.detail));
  }

  onRecorder(detail) {
    clearInterval(this._timer);
    clearTimeout(this._flash);

    if (detail.recording) {
      this._button.dataset.state = "recording";
      this.render();
      this._timer = setInterval(() => this.render(), 500);
      return;
    }

    this._button.dataset.state = "idle";
    this._label.textContent = detail.saved
      ? `Saved ${detail.saved} rows`
      : "No telemetry recorded";
    this._flash = setTimeout(() => { this._label.textContent = "Record CSV"; }, 4000);
  }

  render() {
    const { rows, elapsed_s } = recordStatus();
    const m = Math.floor(elapsed_s / 60);
    const s = String(Math.floor(elapsed_s % 60)).padStart(2, "0");
    this._label.textContent = `Stop  ${m}:${s} · ${rows} rows`;
  }
}

customElements.define("record-button", RecordButton);
