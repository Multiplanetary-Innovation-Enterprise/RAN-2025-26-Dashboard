// components/video-panel.js
class VideoPanel extends HTMLElement {
  connectedCallback() {
    // Prevent double-render if re-attached
    if (this._rendered) return;
    this._rendered = true;

    // Optional: add classes so it fits grid styling
    this.classList.add('card');
    this.id = this.id || 'videoSection';

    this.innerHTML = `
      <h3>Video</h3>
      <!-- Video Stream -->
      <img id="cam" src="http://192.168.1.236:9002/video.mjpg" alt="camera stream"
           style="width: 300px; height: 240px; background: black;">
      <div class="row">
        <label>Preset:
          <select id="videoPreset">
            <option>640x480@15</option>
            <option>640x360@15</option>
            <option>320x240@10</option>
          </select>
        </label>
        <span id="videoStats">paused</span>
      </div>
    `;
  }
}

customElements.define('video-panel', VideoPanel);
