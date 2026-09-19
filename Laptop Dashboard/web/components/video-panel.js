class VideoPanel extends HTMLElement {
    async connectedCallback() {
        if (this._rendered) return;
        this._rendered = true;
        this.classList.add('card');
        
        // Use a flex container to place the two video streams side-by-side
        this.innerHTML = `
            <h3>Live Video (WebRTC)</h3>
            <div style="display: flex; gap: 10px; width: 100%;">
                <div style="position: relative; flex: 1; height: 240px; background: #000;">
                    <video id="webrtc-player-1" autoplay muted playsinline 
                           style="width: 100%; height: 100%; object-fit: contain;"></video>
                    <div id="videoStats-1" style="position: absolute; top: 5px; left: 5px; color: #0f0; background: rgba(0,0,0,0.5); padding: 2px;">Connecting...</div>
                </div>
                
                <div style="position: relative; flex: 1; height: 240px; background: #000;">
                    <video id="webrtc-player-2" autoplay muted playsinline 
                           style="width: 100%; height: 100%; object-fit: contain;"></video>
                    <div id="videoStats-2" style="position: absolute; top: 5px; left: 5px; color: #0f0; background: rgba(0,0,0,0.5); padding: 2px;">Connecting...</div>
                </div>
            </div>
        `;
        
        // Store RTCPeerConnection instances to manage lifecycles
        this.peerConnections = {};
        
        // Note: Update these paths to match your exact MediaMTX stream names!
        // MediaMTX uses the /whep endpoint for WebRTC signaling.
        //100.97.255.110 
        const host = "100.97.255.110:8889"; 
        this.startStreaming('1', `http://${host}/rover_video_1/whep`);
        this.startStreaming('2', `http://${host}/rover_video_2/whep`);
    }

async startStreaming(streamId, url) {
        const videoElement = this.querySelector(`#webrtc-player-${streamId}`);
        const statsUI = this.querySelector(`#videoStats-${streamId}`);

        if (this.peerConnections[streamId]) {
            this.peerConnections[streamId].close();
        }

        const pc = new RTCPeerConnection();
        this.peerConnections[streamId] = pc;

        pc.addTransceiver('video', { direction: 'recvonly' });

        pc.ontrack = (event) => {
            videoElement.srcObject = event.streams[0];
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                statsUI.innerText = `Cam ${streamId}: Live`;
            } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                statsUI.innerText = `Cam ${streamId}: Disconnected`;
                setTimeout(() => this.startStreaming(streamId, url), 2000);
            } else {
                statsUI.innerText = `Cam ${streamId}: ${pc.connectionState}...`;
            }
        };

        // Latency & Network Polling
        let lastRtt = "0"; // Store RTT outside the loop to remember it between updates

        const statsInterval = setInterval(async () => {
            if (pc.connectionState !== 'connected') return;
            
            try {
                const rtcStats = await pc.getStats();
                let jitter = "0";
                let fps = 0;

                rtcStats.forEach(report => {
                    // Update RTT only if the browser actually performed a ping this cycle
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        if (report.currentRoundTripTime !== undefined) {
                            lastRtt = (report.currentRoundTripTime * 1000).toFixed(0);
                        }
                    }
                    // Update Jitter and FPS (these update continuously based on video packets)
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        if (report.jitter !== undefined) {
                            jitter = (report.jitter * 1000).toFixed(0);
                        }
                        fps = report.framesPerSecond || 0;
                    }
                });

                if (fps > 0 || lastRtt > 0) {
                    statsUI.innerText = `Cam ${streamId} | RTT: ${lastRtt}ms | Jit: ${jitter}ms | ${fps} FPS`;
                }
            } catch (e) {
                console.warn(`Stats error on Cam ${streamId}:`, e);
            }
        }, 1000);

        // Clear interval if connection closes to prevent memory leaks
        pc.addEventListener('signalingstatechange', () => {
            if (pc.signalingState === 'closed') clearInterval(statsInterval);
        });

        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/sdp' },
                body: offer.sdp
            });

            if (!response.ok) throw new Error("MediaMTX rejected the WebRTC offer");

            const answerSdp = await response.text();
            await pc.setRemoteDescription({
                type: 'answer',
                sdp: answerSdp
            });

        } catch (err) {
            console.warn(`Stream ${streamId} failed to connect:`, err);
            statsUI.innerText = `Cam ${streamId}: Retry...`;
            setTimeout(() => this.startStreaming(streamId, url), 2000);
        }
    }

    disconnectedCallback() {
        // Cleanly close all WebRTC connections when the component is removed
        for (let id in this.peerConnections) {
            if (this.peerConnections[id]) {
                this.peerConnections[id].close();
            }
        }
        this.peerConnections = {};
    }
}
customElements.define('video-panel', VideoPanel);