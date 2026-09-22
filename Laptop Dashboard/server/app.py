"""
server/app.py — Driver Station HTTP + WebRTC relay

The laptop hosts one lightweight HTTP service:

  HTTP server (port 8765)
    - Serves the dashboard UI.
    - Handles WebRTC SDP signaling for the browser and rover Pi.

All application data between browser and rover is transported over
WebRTC DataChannels. No WebSocket application transport is used.

DataChannels:
  cmd        - unordered / unreliable; browser -> Pi teleop commands
  telemetry  - unordered / unreliable; Pi -> browser telemetry
  control    - ordered / reliable; e-stop, queue, mux, configuration, alerts
  heartbeat  - unordered / unreliable; application heartbeat / RTT

Run:
    python server/app.py

Open:
    http://localhost:8765
"""

from __future__ import annotations

import asyncio
import json
import pathlib
import threading
import uuid
from concurrent.futures import TimeoutError as FutureTimeoutError
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from aiortc import RTCPeerConnection, RTCSessionDescription


ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT_DIR / "web"

HTTP_HOST = "0.0.0.0"
HTTP_PORT = 8765

PI_OFFER_PATH = "/api/webrtc/pi/offer"
BROWSER_OFFER_PATH = "/api/webrtc/browser/offer"

MAX_HTTP_BODY = 512 * 1024
OFFER_TIMEOUT_S = 20.0
CLOSE_TIMEOUT_S = 5.0

PROTOCOL_VERSION = "0.3"

CONTROL_TYPES = {
    "hello",
    "hello.ack",
    "estop",
    "set",
    "mux.request",
    "mux.state",
    "queue.drive",
    "queue.cancel",
    "queue.state",
    "queue.result",
    "alert",
}

TELEMETRY_TYPES = {"tlm"}

HEARTBEAT_TYPES = {"hb", "hb.ack"}


def _json_bytes(obj: dict) -> bytes:
    return json.dumps(obj, separators=(",", ":")).encode("utf-8")


def _decode_json(data) -> dict | None:
    if isinstance(data, bytes):
        try:
            data = data.decode("utf-8")
        except UnicodeDecodeError:
            return None

    if not isinstance(data, str):
        return None

    try:
        obj = json.loads(data)
    except (json.JSONDecodeError, TypeError):
        return None

    return obj if isinstance(obj, dict) else None


class StaticRequestHandler(SimpleHTTPRequestHandler):
    """Serve dashboard files and the WebRTC signaling POST endpoints."""

    def __init__(self, *args, app=None, **kwargs):
        self.app = app
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, fmt, *args):
        # Keep the console focused on rover/network diagnostics.
        pass

    def _send_json(self, status: int, payload: dict) -> None:
        body = _json_bytes(payload)

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except (TypeError, ValueError):
            return None

        if length <= 0 or length > MAX_HTTP_BODY:
            return None

        body = self.rfile.read(length)
        return _decode_json(body)

    def do_POST(self):
        path = urlsplit(self.path).path

        if path not in (PI_OFFER_PATH, BROWSER_OFFER_PATH):
            self.send_error(404)
            return

        if self.app is None or self.app.loop is None:
            self._send_json(
                503,
                {
                    "ok": False,
                    "error": "server event loop is not ready",
                },
            )
            return

        msg = self._read_json_body()
        if msg is None:
            self._send_json(
                400,
                {
                    "ok": False,
                    "error": "invalid JSON request body",
                },
            )
            return

        role = "pi" if path == PI_OFFER_PATH else "browser"

        future = asyncio.run_coroutine_threadsafe(
            self.app.relay.handle_offer(role, msg),
            self.app.loop,
        )

        try:
            result = future.result(timeout=OFFER_TIMEOUT_S)
        except FutureTimeoutError:
            future.cancel()
            self._send_json(
                504,
                {
                    "ok": False,
                    "error": "WebRTC negotiation timed out",
                },
            )
            return
        except Exception as e:
            self._send_json(
                500,
                {
                    "ok": False,
                    "error": f"{type(e).__name__}: {e}",
                },
            )
            return

        self._send_json(200, result)


class DriverStationServer:
    """
    Relays application data between browser WebRTC peers and the rover Pi.

    There is no WebSocket state. The HTTP endpoints above are only used for
    initial SDP signaling; once the peers are established, application data
    uses WebRTC DataChannels.
    """

    def __init__(self):
        self.pi_pc: RTCPeerConnection | None = None
        self.pi_channels: dict[str, object] = {}

        # browser_id -> PeerConnection
        self.browser_pcs: dict[str, RTCPeerConnection] = {}
        # browser_id -> {"cmd": channel, "telemetry": channel, ...}
        self.browser_channels: dict[str, dict[str, object]] = {}

        self._pc_lock = asyncio.Lock()

    # ------------------------------------------------------------
    # WebRTC helpers
    # ------------------------------------------------------------

    async def _wait_ice_gathering_complete(
        self,
        pc: RTCPeerConnection,
    ) -> None:
        if pc.iceGatheringState == "complete":
            return

        done = asyncio.Event()

        @pc.on("icegatheringstatechange")
        def _on_state_change():
            if pc.iceGatheringState == "complete":
                done.set()

        try:
            await asyncio.wait_for(done.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            print(
                "[Laptop] ICE gathering timed out; "
                "using candidates gathered so far."
            )

    async def handle_offer(self, role: str, msg: dict) -> dict:
        """Create and return a WebRTC SDP answer for a Pi or browser offer."""
        if role not in ("pi", "browser"):
            raise ValueError(f"invalid WebRTC role: {role}")

        sdp = msg.get("sdp")
        sdp_type = msg.get("sdp_type", "offer")

        if not isinstance(sdp, str) or not sdp:
            raise ValueError("offer is missing SDP")

        async with self._pc_lock:
            if role == "pi":
                return await self._handle_pi_offer(sdp, sdp_type)

            browser_id = str(uuid.uuid4())
            return await self._handle_browser_offer(
                browser_id,
                sdp,
                sdp_type,
            )

    async def _handle_pi_offer(
        self,
        sdp: str,
        sdp_type: str,
    ) -> dict:
        if self.pi_pc is not None:
            await self._cleanup_pi(
                self.pi_pc,
                announce=False,
            )

        pc = RTCPeerConnection()
        self.pi_pc = pc
        self.pi_channels = {}

        @pc.on("datachannel")
        def _on_datachannel(channel):
            label = channel.label

            if label not in {
                "cmd",
                "telemetry",
                "control",
                "heartbeat",
            }:
                print(
                    f"[Laptop] Ignoring unknown Pi DataChannel: {label}"
                )
                return

            self.pi_channels[label] = channel

            @channel.on("open")
            def _on_open():
                print(
                    f"[Laptop] Pi DataChannel open: {label}"
                )

            @channel.on("close")
            def _on_close():
                print(
                    f"[Laptop] Pi DataChannel closed: {label}"
                )
                if self.pi_channels.get(label) is channel:
                    self.pi_channels.pop(label, None)

            @channel.on("message")
            def _on_message(data):
                asyncio.create_task(
                    self._handle_pi_data(
                        label,
                        data,
                    )
                )

        @pc.on("connectionstatechange")
        def _on_connection_state_change():
            state = pc.connectionState
            print(f"[Laptop] Pi WebRTC state: {state}")

            if state in {"failed", "closed"}:
                asyncio.create_task(
                    self._cleanup_pi(
                        pc,
                        announce=True,
                    )
                )

        await pc.setRemoteDescription(
            RTCSessionDescription(
                sdp=sdp,
                type=sdp_type,
            )
        )

        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await self._wait_ice_gathering_complete(pc)

        print("[Laptop] Pi WebRTC negotiation complete.")

        return {
            "ok": True,
            "sdp": pc.localDescription.sdp,
            "sdp_type": pc.localDescription.type,
            "protocol": PROTOCOL_VERSION,
        }

    async def _handle_browser_offer(
        self,
        browser_id: str,
        sdp: str,
        sdp_type: str,
    ) -> dict:
        pc = RTCPeerConnection()

        self.browser_pcs[browser_id] = pc
        self.browser_channels[browser_id] = {}

        @pc.on("datachannel")
        def _on_datachannel(channel):
            label = channel.label

            if label not in {
                "cmd",
                "telemetry",
                "control",
                "heartbeat",
            }:
                print(
                    f"[Laptop] Ignoring unknown browser DataChannel: {label}"
                )
                return

            self.browser_channels[browser_id][label] = channel

            @channel.on("open")
            def _on_open():
                print(
                    f"[Laptop] Browser {browser_id[:8]} "
                    f"DataChannel open: {label}"
                )

                if label == "control":
                    self._send_channel(
                        channel,
                        {
                            "t": "hello",
                            "ver": PROTOCOL_VERSION,
                            "server": "laptop",
                            "caps": [
                                "teleop",
                                "queue",
                                "estop",
                                "video_h264",
                            ],
                        },
                    )

                    if (
                        self.pi_pc is not None
                        and self.pi_pc.connectionState == "connected"
                    ):
                        self._send_channel(
                            channel,
                            {
                                "t": "alert",
                                "level": "info",
                                "msg": "Pi connected",
                            },
                        )

            @channel.on("close")
            def _on_close():
                print(
                    f"[Laptop] Browser {browser_id[:8]} "
                    f"DataChannel closed: {label}"
                )

                if self.browser_channels.get(browser_id, {}).get(label) is channel:
                    self.browser_channels[browser_id].pop(label, None)

            @channel.on("message")
            def _on_message(data):
                asyncio.create_task(
                    self._handle_browser_data(
                        browser_id,
                        label,
                        data,
                    )
                )

        @pc.on("connectionstatechange")
        def _on_connection_state_change():
            state = pc.connectionState
            print(
                f"[Laptop] Browser {browser_id[:8]} "
                f"WebRTC state: {state}"
            )

            if state in {"failed", "closed"}:
                asyncio.create_task(
                    self._cleanup_browser(
                        browser_id,
                        pc,
                    )
                )

        try:
            await pc.setRemoteDescription(
                RTCSessionDescription(
                    sdp=sdp,
                    type=sdp_type,
                )
            )

            answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            await self._wait_ice_gathering_complete(pc)

        except Exception:
            await self._cleanup_browser(
                browser_id,
                pc,
            )
            raise

        print(
            f"[Laptop] Browser {browser_id[:8]} "
            f"WebRTC negotiation complete."
        )

        return {
            "ok": True,
            "id": browser_id,
            "sdp": pc.localDescription.sdp,
            "sdp_type": pc.localDescription.type,
            "protocol": PROTOCOL_VERSION,
        }

    # ------------------------------------------------------------
    # DataChannel send helpers
    # ------------------------------------------------------------

    @staticmethod
    def _send_channel(channel, obj: dict) -> bool:
        if channel is None:
            return False

        if getattr(channel, "readyState", None) != "open":
            return False

        try:
            channel.send(
                json.dumps(
                    obj,
                    separators=(",", ":"),
                )
            )
            return True
        except Exception as e:
            print(
                f"[Laptop] DataChannel send failed: "
                f"{type(e).__name__}: {e}"
            )
            return False

    def _send_pi(self, obj: dict, channel_name: str) -> bool:
        channel = self.pi_channels.get(channel_name)
        return self._send_channel(channel, obj)

    def _broadcast(self, obj: dict, channel_name: str) -> None:
        dead = []

        for browser_id, channels in list(
            self.browser_channels.items()
        ):
            channel = channels.get(channel_name)

            if channel is None:
                continue

            if not self._send_channel(channel, obj):
                if (
                    getattr(channel, "readyState", None)
                    in {"closed", "closing"}
                ):
                    dead.append(browser_id)

        for browser_id in dead:
            pc = self.browser_pcs.get(browser_id)
            if pc is not None:
                asyncio.create_task(
                    self._cleanup_browser(
                        browser_id,
                        pc,
                    )
                )

    # ------------------------------------------------------------
    # Incoming DataChannel routing
    # ------------------------------------------------------------

    async def _handle_pi_data(
        self,
        channel_name: str,
        data,
    ) -> None:
        msg = _decode_json(data)
        if msg is None:
            print(
                f"[Laptop] Invalid Pi JSON on {channel_name}."
            )
            return

        msg_type = msg.get("t")

        if msg_type == "hello.ack":
            print("[Laptop] Pi application handshake received.")
            self._broadcast(
                {
                    "t": "alert",
                    "level": "info",
                    "msg": "Pi connected",
                },
                "control",
            )
            return

        if msg_type == "hb":
            self._send_pi(
                {
                    "t": "hb.ack",
                    "id": msg.get("id"),
                    "ts_ms": msg.get("ts_ms"),
                },
                "heartbeat",
            )
            return

        if msg_type == "tlm":
            self._broadcast(
                msg,
                "telemetry",
            )
            return

        # Queue results, alerts, mux state, etc. use the reliable channel.
        self._broadcast(
            msg,
            "control",
        )

    async def _handle_browser_data(
        self,
        browser_id: str,
        channel_name: str,
        data,
    ) -> None:
        msg = _decode_json(data)
        if msg is None:
            self._send_browser_alert(
                browser_id,
                "error",
                "bad JSON",
            )
            return

        msg_type = msg.get("t")

        if msg_type == "hb":
            self._send_browser_direct(
                browser_id,
                {
                    "t": "hb.ack",
                    "id": msg.get("id"),
                    "ts_ms": msg.get("ts_ms"),
                },
                "heartbeat",
            )
            return

        if self.pi_pc is None:
            if msg_type in {
                "cmd",
                "estop",
                "queue.drive",
                "queue.cancel",
                "mux.request",
                "set",
            }:
                self._send_browser_alert(
                    browser_id,
                    "warn",
                    "Pi not connected",
                )
            return

        if msg_type == "cmd":
            if channel_name != "cmd":
                self._send_browser_alert(
                    browser_id,
                    "error",
                    "cmd message received on wrong DataChannel",
                )
                return

            if not self._send_pi(
                msg,
                "cmd",
            ):
                self._send_browser_alert(
                    browser_id,
                    "warn",
                    "Pi command channel is not open",
                )
            return

        # All other browser control messages use the reliable control channel.
        if channel_name != "control":
            self._send_browser_alert(
                browser_id,
                "error",
                f"{msg_type} message received on wrong DataChannel",
            )
            return

        if not self._send_pi(
            msg,
            "control",
        ):
            self._send_browser_alert(
                browser_id,
                "warn",
                "Pi control channel is not open",
            )

    # ------------------------------------------------------------
    # Browser direct messages
    # ------------------------------------------------------------

    def _send_browser_direct(
        self,
        browser_id: str,
        obj: dict,
        channel_name: str,
    ) -> None:
        channel = self.browser_channels.get(
            browser_id,
            {},
        ).get(channel_name)

        self._send_channel(
            channel,
            obj,
        )

    def _send_browser_alert(
        self,
        browser_id: str,
        level: str,
        msg: str,
    ) -> None:
        self._send_browser_direct(
            browser_id,
            {
                "t": "alert",
                "level": level,
                "msg": msg,
            },
            "control",
        )

    # ------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------

    async def _cleanup_pi(
        self,
        pc: RTCPeerConnection,
        announce: bool,
    ) -> None:
        if self.pi_pc is not pc:
            return

        self.pi_pc = None
        self.pi_channels = {}

        try:
            await asyncio.wait_for(
                pc.close(),
                timeout=CLOSE_TIMEOUT_S,
            )
        except Exception:
            pass

        print("[Laptop] Pi WebRTC session closed.")

        if announce:
            self._broadcast(
                {
                    "t": "alert",
                    "level": "warn",
                    "msg": "Pi disconnected",
                },
                "control",
            )

    async def _cleanup_browser(
        self,
        browser_id: str,
        pc: RTCPeerConnection,
    ) -> None:
        if self.browser_pcs.get(browser_id) is not pc:
            return

        self.browser_pcs.pop(browser_id, None)
        self.browser_channels.pop(browser_id, None)

        try:
            await asyncio.wait_for(
                pc.close(),
                timeout=CLOSE_TIMEOUT_S,
            )
        except Exception:
            pass

        print(
            f"[Laptop] Browser {browser_id[:8]} session closed."
        )

    async def close(self) -> None:
        """Close all WebRTC sessions."""
        if self.pi_pc is not None:
            await self._cleanup_pi(
                self.pi_pc,
                announce=False,
            )

        for browser_id, pc in list(
            self.browser_pcs.items()
        ):
            await self._cleanup_browser(
                browser_id,
                pc,
            )


class DriverStationApp:
    """Own the static HTTP server and WebRTC signaling relay."""

    def __init__(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        self.relay = DriverStationServer()

        self.http_server = None
        self.http_thread = None

    def start_http_server(self) -> None:
        handler = partial(
            StaticRequestHandler,
            app=self,
        )

        self.http_server = ThreadingHTTPServer(
            (HTTP_HOST, HTTP_PORT),
            handler,
        )

        self.http_thread = threading.Thread(
            target=self.http_server.serve_forever,
            name="dashboard-http",
            daemon=True,
        )

        self.http_thread.start()

        print(
            f"[Laptop] HTTP server listening on "
            f"http://{HTTP_HOST}:{HTTP_PORT}"
        )
        print(
            f"[Laptop] Pi signaling endpoint: "
            f"http://<laptop-ip>:{HTTP_PORT}{PI_OFFER_PATH}"
        )

    async def close(self) -> None:
        if self.http_server is not None:
            self.http_server.shutdown()
            self.http_server.server_close()
            self.http_server = None

        if self.http_thread is not None:
            self.http_thread.join(timeout=2)
            self.http_thread = None

        await self.relay.close()


async def main() -> None:
    loop = asyncio.get_running_loop()
    app = DriverStationApp(loop)

    app.start_http_server()

    try:
        await asyncio.Future()
    finally:
        print("[Laptop] Shutting down...")
        await app.close()
        print("[Laptop] Shutdown complete.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
