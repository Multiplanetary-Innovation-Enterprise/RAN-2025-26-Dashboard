# pi_dashboard/services/camera_service.py
import threading, time, math
from collections import deque
from typing import Any, Dict, Optional

import cv2
import numpy as np

from .base import BaseService

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import CompressedImage
from cv_bridge import CvBridge

try:
    import pyrealsense2 as rs
    _RS_OK = True
except Exception:
    _RS_OK = False


class CameraService(BaseService, Node):
    """
    Camera service for Pi:
      - Captures frames in background thread
      - Provides latest JPEG bytes for MJPEG streaming
      - poll() returns health + fps (small telemetry)
    """
    name = "cam"

    def __init__(self, width=424, height=240, fps=15, show_depth=False, jpeg_quality=70):
        Node.__init__(self, "camera_service_node")
        self.width, self.height, self.fps = width, height, fps
        self.show_depth = show_depth
        self.jpeg_quality = int(jpeg_quality)

        self._run = False
        self._lock = threading.Lock()
        self._last_jpeg: Optional[bytes] = None
        self._frame_times = deque(maxlen=60)

        self._rs_ok = _RS_OK
        self._use_synthetic = False

        self.pipeline = None
        self.config = None
        self.align = None
        self.colorizer = None
        self.subscription = self.create_subscription(
            CompressedImage,
            'camera/image_raw/compressed',
            self.image_callback,
            10)
        self.latest_msg = None
        self.bridge = CvBridge()
        print("End Camera Service INIT")


    async def stop(self) -> None:
        self._run = False

    def latest_jpeg(self) -> Optional[bytes]:
        with self._lock:
            #print(f"LATEST jpeg: {self._last_jpeg}")
            return self._last_jpeg

    async def poll(self) -> Dict[str, Any]:
        return {
            "ok": True,
            "synthetic": bool(self._use_synthetic),
            "fps": float(self._compute_fps(tick=False)),
        }

    def image_callback(self, msg):
        #print(f"IMAGE")
        self.latest_msg = msg

        if self.latest_msg is None:
            return
        
        # Capture the message and clear it (so we don't process the same frame twice)
        msg = self.latest_msg
        self.latest_msg = None 

        # 1. Convert ROS CompressedImage back to OpenCV/Numpy
        # Since it's JPEG, we decode it
        np_arr = np.frombuffer(msg.data, np.uint8)
        frame_bgr = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if frame_bgr is None:
            return

        # --- Your existing processing logic starts here ---
        # Note: 'frames', 'color', and 'depth' variables from pyrealsense2 
        # won't exist here because the other node already combined them.
        
        fps = self._compute_fps(tick=True)
        cv2.putText(frame_bgr, f"FPS:{fps:.1f}", (10, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 1, cv2.LINE_AA)

        ok, buf = cv2.imencode(".jpg", frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality])
        if ok:
            with self._lock:
                self._last_jpeg = buf.tobytes()
                        

    def _compute_fps(self, tick: bool = False) -> float:
        now = time.time()
        if tick:
            self._frame_times.append(now)
        if len(self._frame_times) < 2:
            return 0.0
        dt = (self._frame_times[-1] - self._frame_times[0]) / max(1, len(self._frame_times) - 1)
        return 1.0 / dt if dt > 0 else 0.0


#TODO
#COPY DASHBOARD ROS PROJECT AND SAVE IT SOMEWHERE, DELETE MAIN ROS PROJECT AND THEN IMPORT FROM THE GITHUB REPOSITORY TO MAKE IT A REPOSITORY, THEN ADD NEEDED ROS PROJECT FILES BACK 