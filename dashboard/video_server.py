# pi_dashboard/video_server.py
import asyncio
from aiohttp import web

class VideoServer:
    """
    Tiny HTTP server on the Pi that exposes /video.mjpg.
    Uses ServiceCenter.latest_jpeg() as the frame source.
    """

    def __init__(self, svcs, host="0.0.0.0", port=9002, fps=15):
        self.svcs = svcs
        self.host = host
        self.port = port
        self.fps = fps

    async def mjpeg_stream(self, request: web.Request):
        boundary = "frame"
        headers = {"Content-Type": f"multipart/x-mixed-replace; boundary=--{boundary}"}
        resp = web.StreamResponse(status=200, reason="OK", headers=headers)
        await resp.prepare(request)

        try:
            while True:
                jpg = self.svcs.latest_jpeg()
                if jpg is None:
                    await asyncio.sleep(0.01)
                    continue

                await resp.write(b"--" + boundary.encode() + b"\r\n")
                await resp.write(b"Content-Type: image/jpeg\r\n")
                await resp.write(f"Content-Length: {len(jpg)}\r\n\r\n".encode())
                await resp.write(jpg)
                await resp.write(b"\r\n")
                await resp.drain()
                await asyncio.sleep(1 / max(1, self.fps))
        except asyncio.CancelledError:
            pass
        except ConnectionResetError:
            pass
        return resp

    async def make_app(self):
        app = web.Application()
        app.router.add_get("/video.mjpg", self.mjpeg_stream)
        return app

    def run_in_background(self):
        """
        Run aiohttp server in the background. Call from within an asyncio app.
        """
        runner_holder = {}

        async def _run():
            app = await self.make_app()
            runner = web.AppRunner(app)
            await runner.setup()
            site = web.TCPSite(runner, self.host, self.port)
            await site.start()
            runner_holder["runner"] = runner

        async def _stop():
            runner = runner_holder.get("runner")
            if runner:
                await runner.cleanup()

        return _run, _stop
