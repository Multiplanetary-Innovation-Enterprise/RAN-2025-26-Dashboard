from __future__ import annotations
import asyncio
from typing import Any, Dict, Optional

from .config import DashboardConfig
from .service_center import ServiceCenter
from .network_handler import NetworkHandler
from .video_server import VideoServer
import rclpy
import sys


class PiDashboard:
    """
    High level app:
      - starts services
      - connects network
      - routes inbound messages to ServiceCenter
      - periodically sends telemetry and queue events
    """

    def __init__(self, cfg: DashboardConfig):
        self.cfg = cfg
        self.svcs = ServiceCenter()
        self.net = NetworkHandler(cfg.ws_url, client_name=cfg.client_name)
        self.telemetry_hz = cfg.telemetry_hz
        self.tlm_fields = list(cfg.tlm_fields)
        self.video = VideoServer(self.svcs, host="0.0.0.0", port=9002, fps=15)
        self._video_start = None
        self._video_stop = None

    

    async def start(self) -> None:
        await self.svcs.start()
        self._video_start, self._video_stop = self.video.run_in_background()
        await self._video_start()
        await self.net.connect()

        # Send hello on connect
        await self.net.send({
            "t": "hello.ack",
            "ver": "0.2",
            "client": self.cfg.client_name,
            "caps": ["telemetry", "teleop", "queue", "estop"],
        })

    async def stop(self) -> None:
        await self.net.close()
        await self.svcs.stop()
        if self._video_stop:
            await self._video_stop()


    async def on_message(self, msg: Dict[str, Any]) -> None:
        t = msg.get("t")

        if t == "hello":
            # server hello, nothing required
            return

        if t == "hb.ack":
            self.net.handle_hb_ack(msg)
            return

        if t == "set":
            hz = msg.get("telemetry_hz", self.telemetry_hz)
            try:
                self.telemetry_hz = max(1, min(int(hz), 30))
            except Exception:
                pass
            fields = msg.get("tlm_fields")
            if isinstance(fields, list) and fields:
                self.tlm_fields = [str(x) for x in fields]
            return

        if t == "mux.request":
            await self.svcs.handle_mux_request(str(msg.get("mode", "teleop")))
            return

        if t == "cmd":                                                                                                                                                                                                                                                                  #a=0, b=0,x=0,y=0,lb=0,rb=0,back=0,start=0,lclick=0,rclick=0,dup=0,ddown=0,dleft=0,dright=0,home=0
            await self.svcs.handle_cmd(float(msg.get("lx", 0.0)), float(msg.get("az", 0.0)), float(msg.get("rx", 0.0)), float(msg.get("ry", 0.0)), float(msg.get("rt", 0.0)), float(msg.get("lt", 0.0)), int(msg.get("btnA", 0.0)), int(msg.get("btnB", 0.0)), int(msg.get("btnX", 0.0)), int(msg.get("btnY", 0.0)), int(msg.get("btnLB", 0.0)), int(msg.get("btnRB", 0.0)), int(msg.get("btnBACK", 0.0)), int(msg.get("btnSTART", 0.0)), int(msg.get("btnLCLICK", 0.0)), int(msg.get("btnRCLICK", 0.0)), int(msg.get("btnDUP", 0.0)), int(msg.get("btnDDOWN", 0.0)), int(msg.get("btnDLEFT", 0.0)), int(msg.get("btnDRIGHT", 0.0)), int(msg.get("btnHOME", 0.0)))
            return

        if t == "estop":
            await self.svcs.handle_estop(bool(msg.get("value", True)))
            return

        if t == "queue.drive":
            await self.svcs.handle_queue_drive(msg)
            return

        if t == "queue.cancel":
            await self.svcs.handle_queue_cancel()
            return

        # Unknown message type, ignore or alert upstream
        return

    async def telemetry_loop(self) -> None:
        while True:
            # Update net stats based on last interval
            interval = 1.0 / max(1, self.telemetry_hz)
            self.svcs.set_net_stats(self.net.get_net_stats_kbps(interval))

            tlm = await self.svcs.build_telemetry_frame(fields=self.tlm_fields)
            await self.net.send(tlm, channel="tlm")

            # Optional event style queue.result messages
            qr = await self.svcs.consume_queue_events()
            if qr:
                await self.net.send(qr, channel="tlm")

            await asyncio.sleep(interval)

    async def run(self) -> None:
        await self.start()
        tasks = [
            asyncio.create_task(self.net.recv_loop(self.on_message)),
            asyncio.create_task(self.net.heartbeat_loop(self.cfg.heartbeat_hz)),
            asyncio.create_task(self.telemetry_loop()),
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            for t in tasks:
                t.cancel()
            await self.stop()

def main(args=None) -> None:
    #cfg = DashboardConfig()
    #app = PiDashboard(cfg)
    #asyncio.run(app.run())

    # 1. Initialize rclpy FIRST
    rclpy.init(args=args)

    #try:
        # 2. Now you can safely create your app/nodes
    cfg = DashboardConfig()
    app = PiDashboard(cfg)
    asyncio.run(app.run())
        
        # If your app needs to spin to process ROS callbacks:
        # rclpy.spin(app.service_center.drive) 
        
    #except Exception as e:
    #    print(f"Error: {e}")
    #finally:
        # 3. Shutdown cleanly
    #    rclpy.shutdown()

if __name__ == "__main__":
    main()
