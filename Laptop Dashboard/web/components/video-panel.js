// components/video-panel.js
class VideoPanel extends HTMLElement {
    async connectedCallback() {
        if (this._rendered) return;
        this._rendered = true;
        this.classList.add('card');
        this.abortController = new AbortController();
        await this.loadJMuxer();
        
        this.innerHTML = `
            <h3>Live Video (H.264)</h3>
            <div style="position: relative; width: 100%; height: 240px; background: #000;">
                <video id="h264-player" autoplay muted playsinline 
                       style="width: 100%; height: 100%; object-fit: contain;"></video>
                <div id="videoStats" style="position: absolute; top: 5px; left: 5px; color: #0f0; background: rgba(0,0,0,0.5); padding: 2px;">Connecting...</div>
            </div>
        `;
        this.startStreaming();
    }

    loadJMuxer() {
        return new Promise((resolve) => {
            if (window.JMuxer) return resolve();
            const script = document.createElement('script');
            script.src = "./components/jmuxer.js";
            script.onload = resolve;
            document.head.appendChild(script);
        });
    }

    async startStreaming() {
        const videoElement = this.querySelector('#h264-player');
        const stats = this.querySelector('#videoStats');

        if (this.jmuxer) this.jmuxer.destroy();

        this.jmuxer = new JMuxer({
            node: videoElement,
            mode: 'video',
            flushingTime: 0,
            maxDelay: 0,
            clearBuffer: true,
            fps: 30,
            debug: false,
            onError: (e) => {
                // If the buffer crashes, we must restart the whole stream fetch
                if (/SourceBuffer/.test(e.toString()) || /InvalidState/.test(e.toString())) {
                    console.warn("Buffer Crash - Restarting...");
                    this.restart();
                }
            }
        });

        try {
            const response = await fetch('http://192.168.0.60:9002/video.h264', {
                signal: this.abortController.signal
            });
            
            const reader = response.body.getReader();
            stats.innerText = "Syncing...";

            let packetCount = 0;
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                if (packetCount === 0) stats.innerText = "Live";
                this.jmuxer.feed({ video: value });
                packetCount++;
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                stats.innerText = "Retry...";
                setTimeout(() => this.startStreaming(), 1000);
            }
        }
    }

    restart() {
        this.disconnectedCallback();
        setTimeout(() => this.startStreaming(), 200);
    }

    disconnectedCallback() {
        this.abortController.abort();
        if (this.jmuxer) {
            this.jmuxer.destroy();
            this.jmuxer = null;
        }
    }
}
customElements.define('video-panel', VideoPanel);
