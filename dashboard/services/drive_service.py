from typing import Any, Dict
from .base import BaseService
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist  # Standard ROS2 drive message
from sensor_msgs.msg import Joy

class DriveService(BaseService, Node): # Inherit from Node
    name = "drive"

    def __init__(self):
        # Initialize the ROS2 Node part of this class
        Node.__init__(self, "drive_service_node")
        
        self._last_cmd = {"lx": 0.0, "az": 0.0}
        self._estop = False

        # Create a publisher for the 'cmd_vel' topic
        self.cmd_pub = self.create_publisher(Joy, 'joy', 10)

    async def handle_cmd(self, lx: float, az: float, rx: float, ry: float, rt: float, lt: float, a=0, b=0,x=0,y=0,lb=0,rb=0,back=0,start=0,lclick=0,rclick=0,dup=0,ddown=0,dleft=0,dright=0,home=0) -> None:
        if self._estop:
            return
            
        self._last_cmd["lx"] = float(lx)
        self._last_cmd["az"] = float(az)
        
        # Create and publish the ROS2 message
        joy = Joy()
        #joy. = self._last_cmd["lx"]
        #joy. = self._last_cmd["az"]
        #rx and ry joy axis not used yet
        joy.axes = [0.0] * 6
        joy.buttons = [0] * 17
        #joy.axes[2] = self._last_cmd["lx"]
        joy.axes[0] = self._last_cmd["az"] #Left stick X
        joy.axes[1] = self._last_cmd["lx"] #Left stick Y
        joy.axes[2] = float(rx)            #RIGHT STICK X
        joy.axes[3] = float(-ry)           #RIGHT STICK Y
        joy.axes[4] = float(rt)            #Right Trigger
        joy.axes[5] = float(lt)            #Left Trigger
        joy.buttons[0] = a                 #A button
        joy.buttons[1] = b                 #B button
        joy.buttons[2] = x                 #X button
        joy.buttons[3] = y                 #Y button
        joy.buttons[4] = lb                #Left Bumper
        joy.buttons[5] = rb                #Right Bumper
        joy.buttons[8] = back              #Back button (2 squares)
        joy.buttons[9] = start             #Start button (hamburger menu)
        joy.buttons[10] = lclick           #Left stick button
        joy.buttons[11] = rclick           #Right stick button
        joy.buttons[12] = dup              #DPAD up
        joy.buttons[13] = ddown            #DPAD down
        joy.buttons[14] = dleft            #DPAD left
        joy.buttons[15] = dright           #DPAD right
        joy.buttons[16] = home             #Home button

        #ERROR joy.axes[5]= self._last_cmd["lx"]
        self.cmd_pub.publish(joy)
        
        self.get_logger().info(f"Publishing LX: {lx}, AZ: {az}")

    async def handle_estop(self, value: bool) -> None:
        self._estop = bool(value)
        if self._estop:
            # Force motor stop by publishing zeros
            self._last_cmd["lx"] = 0.0
            self._last_cmd["az"] = 0.0
            self.get_logger().warn("ESTOP ACTIVE: Sending zero velocity")
            # Also send zero Joy message
            joy = Joy()
            joy.axes = [0.0] * 6
            joy.buttons = [0] * 17
            self.cmd_pub.publish(joy)

    async def poll(self) -> Dict[str, Any]:
        return {"cmd_echo": dict(self._last_cmd), "estop": self._estop}