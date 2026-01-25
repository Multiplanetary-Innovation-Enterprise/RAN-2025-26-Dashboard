from __future__ import annotations
import time
from typing import Any, Dict, Optional

from .services.imu_service import IMUService
from .services.encoder_service import EncoderService
from .services.battery_service import BatteryService
from .services.drive_service import DriveService
from .services.queue_service import QueueService
from .services.camera_service import CameraService
from rover_kinematics.msg import WheelRps # Custom ROS2 message for wheel speeds and angles
import rclpy
import threading


def now_ms() -> int:
    return int(time.time() * 1000)


class ServiceCenter:
    """
    Owns all services. Produces telemetry frames. Routes inbound commands to the correct service.
    This file should contain no networking code.
    """

    def __init__(self):
        self.imu = IMUService()
        self.enc = EncoderService()
        self.bat = BatteryService()
        self.drive = DriveService()
        self.queue = QueueService()
        #self.cam = CameraService(width=640, height=480, fps=15, show_depth=False)


        self.mux_mode = "teleop"  # teleop | auton

        self._tlm_seq = 0
        self._last_cmd = {"lx": 0.0, "az": 0.0}

        self._net_stats = {"ctl_kbps": 0, "tlm_kbps": 0, "vid_kbps": 0, "rtt_ms": 0}
        self.cam = CameraService(width=640, height=480, fps=15, show_depth=False)

        # Store latest wheel command for telemetry
        self._latest_wheel_cmd: Optional[WheelRps] = None

        # ROS spin thread for the camera node (also used for subscriptions)
        self.ros_thread = threading.Thread(target=rclpy.spin, args=(self.cam,), daemon=True)
        self.ros_thread.start()

        # Use the cam node as your ROS Node for creating the subscription
        self.cam.create_subscription(
        WheelRps,
        "/wheel_rps_cmd",
        self._on_wheel_cmd,
        10
        )

    # Callback to store latest wheel command
    def _on_wheel_cmd(self, msg: WheelRps):
        self._latest_wheel_cmd = msg

    async def start(self) -> None:
        await self.imu.start()
        await self.enc.start()
        await self.bat.start()
        await self.drive.start()
        await self.queue.start()
        await self.cam.start()


    async def stop(self) -> None:
        await self.queue.stop()
        await self.drive.stop()
        await self.bat.stop()
        await self.enc.stop()
        await self.imu.stop()

    def set_net_stats(self, net: Dict[str, Any]) -> None:
        self._net_stats.update(net)

    def latest_jpeg(self):
        return self.cam.latest_jpeg()


    async def handle_cmd(self, lx: float, az: float, rx, ry, rt, lt, a=0, b=0,x=0,y=0,lb=0,rb=0,back=0,start=0,lclick=0,rclick=0,dup=0,ddown=0,dleft=0,dright=0,home=0) -> None:
        # Enforce mux here 
        if self.mux_mode != "teleop":
            return
        self._last_cmd["lx"] = float(lx)
        self._last_cmd["az"] = float(az)
        await self.drive.handle_cmd(lx, az, rx, ry, rt, lt, a, b,x,y,lb,rb,back,start,lclick,rclick,dup,ddown,dleft,dright,home)

    async def handle_estop(self, value: bool) -> None:
        await self.drive.handle_estop(value)

    async def handle_mux_request(self, mode: str) -> None:
        if mode in ("teleop", "auton"):
            self.mux_mode = mode

    async def handle_queue_drive(self, cmd: Dict[str, Any]) -> None:
        await self.queue.handle_queue_drive(cmd)

    async def handle_queue_cancel(self) -> None:
        await self.queue.handle_queue_cancel()

    async def build_telemetry_frame(self, fields: Optional[list[str]] = None) -> Dict[str, Any]:
        fields = fields or ["imu", "enc", "bat", "net", "mux", "queue", "cam", "vid"]

        self._tlm_seq += 1
        frame: Dict[str, Any] = {
            "t": "tlm",
            "seq": self._tlm_seq,
            "ts_ms": now_ms(),
            "mux": self.mux_mode,
            "net": dict(self._net_stats),
            "cmd_echo": dict(self._last_cmd),
        }

        if "imu" in fields:
            frame["imu"] = await self.imu.poll()
        if "enc" in fields:
            frame["enc"] = await self.enc.poll()
        if "bat" in fields:
            frame["bat"] = await self.bat.poll()
        if "queue" in fields:
            q = await self.queue.poll()
            frame["queue"] = q.get("state")
        if "cam" in fields:
            frame["cam"] = await self.cam.poll()
        if "vid" in fields:
            frame["vid"] = {"fps": (frame.get("cam", {}).get("fps", 0.0))}

         # Add wheel command telemetry if available
        if self._latest_wheel_cmd is not None:
            frame["wheel_cmd"] = {
                "fl": {
                    "rps": self._latest_wheel_cmd.fl_rps,
                    "angle": self._latest_wheel_cmd.fl_angle,
                },
                "fr": {
                    "rps": self._latest_wheel_cmd.fr_rps,
                    "angle": self._latest_wheel_cmd.fr_angle,
                },
                "rl": {
                    "rps": self._latest_wheel_cmd.rl_rps,
                    "angle": self._latest_wheel_cmd.rl_angle,
                },
                "rr": {
                    "rps": self._latest_wheel_cmd.rr_rps,
                    "angle": self._latest_wheel_cmd.rr_angle,
                },
            }

        return frame

    async def consume_queue_events(self) -> Optional[Dict[str, Any]]:
        """
        Pull out queue results as separate events (queue.result).
        The telemetry frame includes queue.state, but results can be sent as events.
        """
        q = await self.queue.poll()
        if "result" in q:
            r = q["result"]
            return {"t": "queue.result", "ts_ms": now_ms(), **r}
        return None
