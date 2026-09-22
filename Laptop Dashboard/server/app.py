"""
server/app.py — Driver Station HTTP + WebSocket Relay

The laptop hosts two lightweight services:

  HTTP server (port 8765)
    - Serves the dashboard UI and static assets.

  WebSocket server (port 8766)
    - Accepts the rover Pi connection.
    - Accepts browser connections.
    - Relays browser control messages to the Pi.
    - Relays Pi telemetry/events to browsers.
    - Handles application heartbeats directly.

Video is no longer proxied by the laptop. The dashboard uses the Pi's
H.264 stream directly, so the old MJPEG proxy has been removed.

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
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from aiortc import RTCPeerConnection, RTCSessionDescription


ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT_DIR / "web"

HTTP_HOST = "0.0.0.0"
HTTP_PORT = 8765

WS_HOST = "0.0.0.0"
WS_PORT = 8766
WS_PATH = "/ws"

MAX_WS_MESSAGE_SIZE = 256 * 1024
PING_INTERVAL = 5
PING_TIMEOUT = 2
OPEN_TIMEOUT = 5
CLOSE_TIMEOUT = 5


class StaticRequestHandler(SimpleHTTPRequestHandler):
    """Serve dashboard files from the web directory."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, fmt, *args):
        # Keep the dashboard console readable. WebSocket diagnostics are
        # logged separately below.
        pass


class DriverStationServer:
    """
    Owns the WebSocket relay state.

    A connection is classified as Pi or browser from its first application
    message. Browser output uses a small per-browser queue so a slow browser
    cannot directly block the Pi relay path.
    """

    def __init__(self):
        self.pi_ws = None
        self.pi_send_lock = asyncio.Lock()

        # websocket -> asyncio.Queue[str]
        self.browser_queues: dict = {}
        self.browser_writer_tasks: dict = {}

        # WebRTC PeerConnection to the Pi and its unordered/unreliable
        # "cmd" data channel. Signaling rides over the Pi WebSocket above.
        # Falls back to that WebSocket whenever the channel isn't open, so
        # this is purely additive -- nothing breaks if negotiation fails.
        self.pi_pc: RTCPeerConnection | None = None
        self.pi_cmd_channel = None

    # ------------------------------------------------------------
    # Browser connection management
    # ------------------------------------------------------------

    async def add_browser(self, ws) -> None:
        queue = asyncio.Queue(maxsize=32)
        self.browser_queues[ws] = queue
        self.browser_writer_tasks[ws] = asyncio.create_task(
            self._browser_writer(ws, queue)
        )

    async def remove_browser(self, ws) -> None:
        self.browser_queues.pop(ws, None)

        writer = self.browser_writer_tasks.pop(ws, None)
        if writer is not None:
            writer.cancel()
            await asyncio.gather(writer, return_exceptions=True)

    async def _browser_writer(self, ws, queue: asyncio.Queue) -> None:
        """Serialize writes to one browser WebSocket."""
        try:
            while True:
                data = await queue.get()
                await ws.send(data)

        except asyncio.CancelledError:
            raise

        except ConnectionClosed:
            pass

        except Exception as e:
            print(
                f"[Laptop] Browser writer error: "
                f"{type(e).__name__}: {e}"
            )

    def _queue_browser_message(self, ws, data: str) -> None:
        """
        Queue a browser message without awaiting the network write.

        The queue is intentionally bounded. If a browser falls behind,
        dropping a telemetry message is preferable to allowing that browser
        to create unbounded memory usage or stall the Pi relay.
        """
        queue = self.browser_queues.get(ws)
        if queue is None:
            return

        try:
            queue.put_nowait(data)
        except asyncio.QueueFull:
            # Drop the newest low-priority/broadcast message when the browser
            # can't keep up. Control acknowledgements have a separate direct
            # path below.
            pass

    async def _send_browser_direct(self, ws, data: str) -> None:
        """Send an immediate browser response such as heartbeat ACK."""
        queue = self.browser_queues.get(ws)
        if queue is None:
            return

        # For an ACK / warning, make room if necessary. The queue is bounded
        # so this cannot grow indefinitely.
        while True:
            try:
                queue.put_nowait(data)
                return
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    return

    # ------------------------------------------------------------
    # Pi connection management
    # ------------------------------------------------------------

    async def _send_pi(self, data: str) -> None:
        """Serialize writes to the single Pi WebSocket."""
        pi = self.pi_ws
        if pi is None:
            return

        async with self.pi_send_lock:
            try:
                await pi.send(data)
            except ConnectionClosed as e:
                print(
                    f"[Laptop] Pi send failed: "
                    f"code={e.code}, reason={e.reason}"
                )

                if self.pi_ws is pi:
                    self.pi_ws = None

    async def _send_pi_cmd(self, data: str) -> None:
        """
        Send a "cmd" message to the Pi, preferring the unordered/unreliable
        WebRTC channel so a lost drive command doesn't stall behind a TCP
        retransmit. Falls back to the plain WebSocket whenever the channel
        isn't open (startup, still negotiating, negotiation failed, etc.).
        """
        channel = self.pi_cmd_channel
        if channel is not None and channel.readyState == "open":
            try:
                channel.send(data)
                return
            except Exception as e:
                print(
                    f"[Laptop] 'cmd' data channel send failed, "
                    f"falling back to WebSocket: "
                    f"{type(e).__name__}: {e}"
                )

        await self._send_pi(data)

    # ------------------------------------------------------------
    # WebRTC (Pi "cmd" data channel)
    # ------------------------------------------------------------

    async def _handle_pi_webrtc_offer(self, ws, msg: dict) -> None:
        """Answer the Pi's WebRTC offer and adopt its 'cmd' data channel."""
        if self.pi_pc is not None:
            try:
                await self.pi_pc.close()
            except Exception:
                pass
            self.pi_pc = None
            self.pi_cmd_channel = None

        pc = RTCPeerConnection()
        self.pi_pc = pc

        @pc.on("datachannel")
        def _on_datachannel(channel):
            if channel.label != "cmd":
                return

            self.pi_cmd_channel = channel

            @channel.on("open")
            def _on_open():
                print("[Laptop] WebRTC 'cmd' data channel open.")

            @channel.on("close")
            def _on_close():
                print("[Laptop] WebRTC 'cmd' data channel closed.")
                if self.pi_cmd_channel is channel:
                    self.pi_cmd_channel = None

        try:
            await pc.setRemoteDescription(
                RTCSessionDescription(
                    sdp=msg.get("sdp", ""),
                    type=msg.get("sdp_type", "offer"),
                )
            )

            answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            await self._wait_ice_gathering_complete(pc)

            await ws.send(
                json.dumps(
                    {
                        "t": "webrtc.answer",
                        "sdp": pc.localDescription.sdp,
                        "sdp_type": pc.localDescription.type,
                    },
                    separators=(",", ":"),
                )
            )

        except Exception as e:
            print(
                f"[Laptop] WebRTC negotiation with Pi failed: "
                f"{type(e).__name__}: {e}. "
                f"'cmd' will stay on the WebSocket this session."
            )

    async def _wait_ice_gathering_complete(self, pc: RTCPeerConnection) -> None:
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
                "sending answer with candidates gathered so far."
            )

    async def _close_pi_webrtc(self) -> None:
        self.pi_cmd_channel = None

        if self.pi_pc is not None:
            try:
                await self.pi_pc.close()
            except Exception:
                pass
            self.pi_pc = None

    # ------------------------------------------------------------
    # Broadcast helpers
    # ------------------------------------------------------------

    def _broadcast_raw(self, data: str) -> None:
        """Queue a message for all browsers without awaiting their sockets."""
        for browser in list(self.browser_queues):
            self._queue_browser_message(browser, data)

    def _broadcast(self, obj: dict) -> None:
        self._broadcast_raw(
            json.dumps(obj, separators=(",", ":"))
        )

    # ------------------------------------------------------------
    # WebSocket handler
    # ------------------------------------------------------------

    async def ws_handler(self, ws) -> None:
        """
        Handle one Pi or browser WebSocket connection.
        """
        request_path = urlsplit(ws.request.path).path
        if request_path != WS_PATH:
            await ws.close(
                code=1008,
                reason="invalid WebSocket path",
            )
            return

        remote = ws.remote_address
        role = "unknown"

        # Everyone gets the server greeting first.
        await ws.send(
            json.dumps(
                {
                    "t": "hello",
                    "ver": "0.2",
                    "server": "laptop",
                },
                separators=(",", ":"),
            )
        )

        try:
            async for message in ws:
                if isinstance(message, bytes):
                    message = message.decode("utf-8")

                try:
                    msg = json.loads(message)
                except (json.JSONDecodeError, TypeError):
                    if role == "browser":
                        await self._send_browser_direct(
                            ws,
                            json.dumps(
                                {
                                    "t": "alert",
                                    "level": "error",
                                    "msg": "bad JSON",
                                },
                                separators=(",", ":"),
                            ),
                        )
                    continue

                msg_type = msg.get("t")

                # ------------------------------------------------
                # Pi identification
                # ------------------------------------------------
                if (
                    role == "unknown"
                    and msg_type == "hello.ack"
                    and msg.get("client") == "pi"
                ):
                    role = "pi"

                    old_pi = self.pi_ws
                    self.pi_ws = ws

                    print(
                        f"[Laptop] Pi connected (WS) "
                        f"remote={remote}"
                    )

                    # If a previous Pi connection still exists, explicitly
                    # close it. The identity check in finally() prevents that
                    # old handler from clearing the new connection.
                    if old_pi is not None and old_pi is not ws:
                        try:
                            await old_pi.close(
                                code=1012,
                                reason="replaced by new Pi connection",
                            )
                        except Exception:
                            pass

                    self._broadcast(
                        {
                            "t": "alert",
                            "level": "info",
                            "msg": "Pi connected",
                        }
                    )
                    continue

                # ------------------------------------------------
                # Pi messages
                # ------------------------------------------------
                if role == "pi":
                    if msg_type == "webrtc.offer":
                        await self._handle_pi_webrtc_offer(ws, msg)
                        continue

                    if msg_type == "hb":
                        # The server itself acknowledges the Pi heartbeat.
                        # This keeps RTT measurement independent of browsers.
                        await ws.send(
                            json.dumps(
                                {
                                    "t": "hb.ack",
                                    "id": msg.get("id"),
                                    "ts_ms": msg.get("ts_ms"),
                                },
                                separators=(",", ":"),
                            )
                        )
                        continue

                    # Telemetry/events are broadcast asynchronously to
                    # browsers. A slow browser cannot block this handler.
                    self._broadcast_raw(message)
                    continue

                # ------------------------------------------------
                # Browser identification
                # ------------------------------------------------
                if role == "unknown":
                    role = "browser"
                    await self.add_browser(ws)
                    print(
                        f"[Laptop] Browser connected: remote={remote}"
                    )

                if role == "browser":
                    # Browser heartbeat is acknowledged locally. The Pi
                    # doesn't need to know about browser keepalive traffic.
                    if msg_type == "hb":
                        await self._send_browser_direct(
                            ws,
                            json.dumps(
                                {
                                    "t": "hb.ack",
                                    "id": msg.get("id"),
                                    "ts_ms": msg.get("ts_ms"),
                                },
                                separators=(",", ":"),
                            ),
                        )
                        continue

                    # Forward all other browser protocol messages to Pi.
                    # "cmd" prefers the unordered/unreliable WebRTC channel;
                    # everything else (estop, queue.*, mux.request) stays
                    # on the ordered/reliable WebSocket on purpose.
                    if self.pi_ws is not None:
                        if msg_type == "cmd":
                            await self._send_pi_cmd(message)
                        else:
                            await self._send_pi(message)
                    elif msg_type in (
                        "cmd",
                        "estop",
                        "queue.drive",
                        "queue.cancel",
                        "mux.request",
                    ):
                        await self._send_browser_direct(
                            ws,
                            json.dumps(
                                {
                                    "t": "alert",
                                    "level": "warn",
                                    "msg": "Pi not connected",
                                },
                                separators=(",", ":"),
                            ),
                        )

        except ConnectionClosed as e:
            print(
                f"[Laptop] WebSocket closed: "
                f"role={role}, remote={remote}, "
                f"code={e.code}, reason={e.reason}"
            )

        except Exception as e:
            print(
                f"[Laptop] WebSocket error: "
                f"role={role}, remote=RAN-2025-26-Rover-Code-main-websockets-migrated{remote}, "
                f"{type(e).__name__}: {e}"
            )

        finally:
            if role == "browser":
                await self.remove_browser(ws)
                print(
                    f"[Laptop] Browser disconnected: remote={remote}"
                )

            elif role == "pi":
                # Only clear the Pi reference if this is still the active
                # connection. A stale connection must never clear a newer one.
                if self.pi_ws is ws:
                    self.pi_ws = None
                    await self._close_pi_webrtc()

                    print(
                        f"[Laptop] Pi disconnected: remote={remote}"
                    )

                    self._broadcast(
                        {
                            "t": "alert",
                            "level": "warn",
                            "msg": "Pi disconnected",
                        }
                    )

    # ------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------

    async def close(self) -> None:
        """Close tracked WebSocket connections."""
        await self._close_pi_webrtc()

        if self.pi_ws is not None:
            try:
                await self.pi_ws.close(
                    code=1001,
                    reason="server shutdown",
                )
            except Exception:
                pass
            self.pi_ws = None

        for browser in list(self.browser_queues):
            try:
                await browser.close(
                    code=1001,
                    reason="server shutdown",
                )
            except Exception:
                pass

            await self.remove_browser(browser)


class DriverStationApp:
    """Own the static HTTP server and WebSocket server."""

    def __init__(self):
        self.relay = DriverStationServer()
        self.http_server = None
        self.http_thread = None
        self.ws_server = None

    def start_http_server(self) -> None:
        self.http_server = ThreadingHTTPServer(
            (HTTP_HOST, HTTP_PORT),
            StaticRequestHandler,
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

    async def start_websocket_server(self) -> None:
        self.ws_server = await serve(
            self.relay.ws_handler,
            WS_HOST,
            WS_PORT,
            ping_interval=PING_INTERVAL,
            ping_timeout=PING_TIMEOUT,
            open_timeout=OPEN_TIMEOUT,
            close_timeout=CLOSE_TIMEOUT,
            max_size=MAX_WS_MESSAGE_SIZE,
            max_queue=16,
            server_header="RAN Driver Station",
        )

        print(
            f"[Laptop] WebSocket server listening on "
            f"ws://{WS_HOST}:{WS_PORT}{WS_PATH}"
        )

    async def close(self) -> None:
        if self.ws_server is not None:
            self.ws_server.close()
            await self.ws_server.wait_closed()
            self.ws_server = None

        await self.relay.close()

        if self.http_server is not None:
            self.http_server.shutdown()
            self.http_server.server_close()
            self.http_server = None

        if self.http_thread is not None:
            self.http_thread.join(timeout=2)
            self.http_thread = None


async def main() -> None:
    app = DriverStationApp()

    app.start_http_server()
    await app.start_websocket_server()

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