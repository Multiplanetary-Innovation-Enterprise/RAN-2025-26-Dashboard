// components/video-panel.js
class VideoPanel extends HTMLElement {
    async connectedCallback() {
        if (this._rendered) return;
        this._rendered = true;
        this.classList.add('card');
        this.abortController = new AbortController();
        await this.loadJMuxer();
        
        // Use a flex container to place the two video streams side-by-side
        this.innerHTML = `
            <h3>Live Video (H.264)</h3>
            <div style="display: flex; gap: 10px; width: 100%;">
                <div style="position: relative; flex: 1; height: 240px; background: #000;">
                    <video id="h264-player-1" autoplay muted playsinline 
                           style="width: 100%; height: 100%; object-fit: contain;"></video>
                    <div id="videoStats-1" style="position: absolute; top: 5px; left: 5px; color: #0f0; background: rgba(0,0,0,0.5); padding: 2px;">Connecting...</div>
                </div>
                
                <div style="position: relative; flex: 1; height: 240px; background: #000;">
                    <video id="h264-player-2" autoplay muted playsinline 
                           style="width: 100%; height: 100%; object-fit: contain;"></video>
                    <div id="videoStats-2" style="position: absolute; top: 5px; left: 5px; color: #0f0; background: rgba(0,0,0,0.5); padding: 2px;">Connecting...</div>
                </div>
            </div>
        `;
        
        // Store multiple jmuxer instances by ID
        this.jmuxers = {};
        
        // Start both streams dynamically
        // Note: Make sure the IP matches your actual robot IP!
        const host = "100.97.255.110:9002"; 
        this.startStreaming('1', `http://${host}/video/1.h264`);
        this.startStreaming('2', `http://${host}/video/2.h264`);
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

    async startStreaming(streamId, url) {
        const videoElement = this.querySelector(`#h264-player-${streamId}`);
        const stats = this.querySelector(`#videoStats-${streamId}`);

        if (this.jmuxers[streamId]) this.jmuxers[streamId].destroy();

        this.jmuxers[streamId] = new JMuxer({
            node: videoElement,
            mode: 'video',
            flushingTime: 0,
            maxDelay: 0,
            clearBuffer: true,
            fps: 30,
            debug: false,
            onError: (e) => {
                if (/SourceBuffer/.test(e.toString()) || /InvalidState/.test(e.toString())) {
                    console.warn(`Buffer Crash on Stream ${streamId} - Restarting...`);
                    this.restartStream(streamId, url);
                }
            }
        });

        try {
            const response = await fetch(url, {
                signal: this.abortController.signal
            });
            
            const reader = response.body.getReader();
            stats.innerText = `Cam ${streamId}: Syncing...`;

            let packetCount = 0;
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                if (packetCount === 0) stats.innerText = `Cam ${streamId}: Live`;
                this.jmuxers[streamId].feed({ video: value });
                packetCount++;
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                stats.innerText = `Cam ${streamId}: Retry...`;
                setTimeout(() => this.startStreaming(streamId, url), 1000);
            }
        }
    }

    restartStream(streamId, url) {
        if (this.jmuxers[streamId]) {
            this.jmuxers[streamId].destroy();
            this.jmuxers[streamId] = null;
        }
        setTimeout(() => this.startStreaming(streamId, url), 200);
    }

    disconnectedCallback() {
        this.abortController.abort();
        for (let id in this.jmuxers) {
            if (this.jmuxers[id]) {
                this.jmuxers[id].destroy();
            }
        }
        this.jmuxers = {};
    }
}
customElements.define('video-panel', VideoPanel);
