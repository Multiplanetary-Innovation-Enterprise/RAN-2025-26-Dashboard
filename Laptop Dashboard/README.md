# Laptop Driver Station Dashboard

This dashboard runs on the driver-station laptop.

It provides the browser UI and acts as a WebRTC relay between the browser and the rover Pi. It does not control hardware or generate telemetry.

## Responsibilities

- Serve the dashboard UI and static assets
- Provide HTTP endpoints for WebRTC SDP signaling
- Relay browser control DataChannels to the Pi
- Relay Pi telemetry/events to connected browsers
- Keep Pi and browser application heartbeats independent on their heartbeat DataChannels

Video is handled separately as H.264. The dashboard's video component connects directly to the Pi's H.264 stream; the old MJPEG proxy has been removed from this repository.

## Quick Start

```bash
python start_dashboard.py
```

The launcher creates `.venv`, installs `requirements.txt`, starts the server, and opens:

```text
http://localhost:8765
```

## Network Architecture

There is no WebSocket transport.

HTTP is used only for WebRTC SDP signaling while each peer connection is established. After negotiation, rover control, telemetry, queue events, e-stop, and heartbeat traffic use WebRTC DataChannels.

WebRTC DataChannels use SCTP over DTLS over UDP.

```text
Browser
   │
   │ WebRTC DataChannels
   │
   ▼
Laptop relay
   │
   │ WebRTC DataChannels
   │
   ▼
Rover Pi

HTTP :8765
   ├── /api/webrtc/browser/offer
   └── /api/webrtc/pi/offer

HTTP is signaling only; application data does not use HTTP.
```

## DataChannels

```text
cmd
  unordered / unreliable
  Browser -> Pi
  20 Hz teleop commands

telemetry
  unordered / unreliable
  Pi -> Browser
  10 Hz telemetry

control
  ordered / reliable
  Both directions
  e-stop, queue, mux, configuration, alerts

heartbeat
  unordered / unreliable
  Both directions
  application heartbeat / RTT
```

Separate channels keep high-rate traffic from creating application-level head-of-line blocking.

## Ports

```text
HTTP dashboard + WebRTC signaling: 8765
```

The Pi should be configured to post its SDP offer to:

```text
http://<laptop-ip>:8765/api/webrtc/pi/offer
```

The browser uses the same laptop origin for:

```text
/api/webrtc/browser/offer
```

## Project Structure

```text
Laptop Dashboard/
├─ server/
│  └─ app.py
├─ web/
│  ├─ index.html
│  ├─ main.js
│  ├─ app.js
│  ├─ gamepad.js
│  └─ components/
├─ requirements.txt
├─ start_dashboard.py
└─ wire_protocol.txt
```
