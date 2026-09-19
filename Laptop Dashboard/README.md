# Laptop Driver Station Dashboard

This dashboard runs on the driver-station laptop.

It provides the browser UI and acts as a WebSocket relay between the browser and the rover Pi. It does not control hardware or generate telemetry.

## Responsibilities

- Serve the dashboard UI and static assets
- Host the WebSocket relay for browser and rover connections
- Relay browser control messages to the Pi
- Relay Pi telemetry/events to connected browsers
- Keep Pi and browser application heartbeats local to their respective WebSocket connections

Video is handled separately as H.264. The dashboard's video component connects directly to the Pi's H.264 stream; the old MJPEG proxy has been removed from this repository.

## Quick Start

```bash
python start_dashboard.py
```

The launcher creates `.venv`, installs `requirements.txt`, starts the server, and opens:

```text
http://localhost:8765
```

## Ports

```text
HTTP dashboard: 8765
WebSocket relay: 8766
```

The WebSocket endpoint is:

```text
ws://<laptop-ip>:8766/ws
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

## Communication

The rover and driver station use the `websockets` Python library for their WebSocket endpoints. Browser clients use the browser-native WebSocket API.

```text
Browser ─────── WebSocket :8766 ─────── Laptop ─────── WebSocket ─────── Pi
                                      relay
```
