"""
server/app.py — Driver Station Host + Relay

This laptop server does 3 things:
  1) Serves the web dashboard (index + static files)
  2) Hosts the browser WebSocket at /ws
     - forwards browser control messages to the Pi connection
     - forwards Pi telemetry/events to all browsers
  3) Proxies the Pi MJPEG stream at /video.mjpg
     - browser always loads video from the laptop, never directly from the Pi

Responsibilities:
- Serves the dashboard UI:
  - GET / -> web/index.html
  - GET /{static} -> web/* assets
- Hosts WebSocket endpoint /ws:
  - Accepts browser clients (many)
  - Accepts the Pi client (usually one)
  - Relays messages:
      Browser -> Pi: cmd/estop/queue/set/mux/etc
      Pi -> Browser: tlm/alerts/queue.state/queue.result/etc
- Proxies MJPEG video endpoint:
  - GET /video.mjpg -> streams bytes from Pi's MJPEG endpoint

Run:
  python server/app.py
  open http://localhost:8765
"""

import asyncio, json, pathlib
from aiohttp import web, WSMsgType, ClientSession, ClientTimeout

STATIC_DIR = pathlib.Path(__file__).parent.parent / "web"

# Point this to your Pi
# Pi Tailscale: 100.97.255.110
# Pi Router: 192.168.1.50
PI_HTTP_VIDEO = "http://100.97.255.110:9002/video.mjpg"

# The Pi connects IN to the laptop WS (so no PI_WS_URL needed here)

class DriverStationServer:
    def __init__(self):
        # Browser connections
        self.browsers = set()

        # Single Pi WS connection (optional, but expected)
        self.pi_ws = None

        # Shared HTTP session for proxying video
        self.http = None

    async def index(self, request: web.Request):
        return web.FileResponse(STATIC_DIR / "index.html")

    async def static(self, request: web.Request):
        path = request.match_info["path"]
        file_path = STATIC_DIR / path
        if not file_path.exists():
            raise web.HTTPNotFound()
        return web.FileResponse(file_path)

    async def ws_handler(self, request: web.Request):
        """
        Single WS endpoint (/ws) supports:
          - browsers
          - pi client

        We distinguish them by the first message:
          - Pi sends: {"t":"hello.ack","client":"pi",...}
          - Browser typically sends hb/cmd/etc or just waits for hello
        """
        ws = web.WebSocketResponse(max_msg_size=256 * 1024)
        await ws.prepare(request)

        # Give all clients a server hello
        await ws.send_str(json.dumps({"t":"hello","ver":"0.2","server":"laptop"}, separators=(",",":")))

        role = "unknown"
        self.browsers.add(ws)

        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue

                try:
                    m = json.loads(msg.data)
                except Exception:
                    await ws.send_str(json.dumps({"t":"alert","level":"error","msg":"bad JSON"}))
                    continue

                # Detect Pi client
                if role == "unknown" and m.get("t") == "hello.ack" and m.get("client") == "pi":
                    role = "pi"
                    # remove from browsers set if it was temporarily added
                    self.browsers.discard(ws)
                    self.pi_ws = ws
                    print("[Laptop] Pi connected (WS)")
                    # tell browsers
                    await self._broadcast({"t":"alert","level":"info","msg":"Pi connected"})
                    continue

                if role == "pi":
                    # Messages from Pi should be forwarded to browsers verbatim
                    await self._broadcast_raw(msg.data)
                    continue

                # Otherwise this is a browser
                role = "browser"

                # Forward browser messages to Pi if present
                if self.pi_ws is not None:
                    await self.pi_ws.send_str(msg.data)
                else:
                    # keep browser UI responsive with a clear warning
                    if m.get("t") in ("cmd","estop","queue.drive","queue.cancel"):
                        await ws.send_str(json.dumps({"t":"alert","level":"warn","msg":"Pi not connected"}))

        finally:
            self.browsers.discard(ws)
            if self.pi_ws is ws:
                self.pi_ws = None
                print("[Laptop] Pi disconnected (WS)")
                await self._broadcast({"t":"alert","level":"warn","msg":"Pi disconnected"})
        return ws

    async def _broadcast(self, obj: dict):
        s = json.dumps(obj, separators=(",",":"))
        await self._broadcast_raw(s)

    async def _broadcast_raw(self, data: str):
        await asyncio.gather(*(b.send_str(data) for b in list(self.browsers)), return_exceptions=True)

    async def mjpeg_proxy(self, request: web.Request):
        """
        Proxies Pi MJPEG so the browser always uses laptop /video.mjpg
        """
        if self.http is None:
            timeout = ClientTimeout(total=None, sock_connect=3, sock_read=None)
            self.http = ClientSession(timeout=timeout)

        # Pass through as a byte stream
        headers = {"Content-Type": "multipart/x-mixed-replace; boundary=--frame"}
        resp = web.StreamResponse(status=200, reason="OK", headers=headers)
        await resp.prepare(request)

        try:
            async with self.http.get(PI_HTTP_VIDEO) as upstream:
                async for chunk in upstream.content.iter_chunked(4096):
                    await resp.write(chunk)
        except Exception:
            # If Pi video is down, just end the stream
            pass

        return resp

async def make_app():
    srv = DriverStationServer()

    app = web.Application()
    app["srv"] = srv

    app.router.add_get("/", srv.index)
    app.router.add_get("/ws", srv.ws_handler)
    app.router.add_get("/video.mjpg", srv.mjpeg_proxy)
    app.router.add_get("/{path:.*}", srv.static)

    return app

if __name__ == "__main__":
    web.run_app(make_app(), host="0.0.0.0", port=8765)
