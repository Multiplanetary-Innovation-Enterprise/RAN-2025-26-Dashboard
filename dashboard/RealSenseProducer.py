import rclpy
from rclpy.node import Node
from sensor_msgs.msg import CompressedImage
import pyrealsense2 as rs
import numpy as np
import cv2

class RealSenseProducer(Node):
    def __init__(self):
        super().__init__('realsense_producer')
        
        # 1. Initialize Publisher
        self.publisher_ = self.create_publisher(CompressedImage, 'camera/image_raw/compressed', 10)
        
        # 2. Configure RealSense Pipeline
        self.pipeline = rs.pipeline()
        config = rs.config()
        
        # Enable color and depth streams
        config.enable_stream(rs.stream.color, 424, 240, rs.format.bgr8, 6)
        config.enable_stream(rs.stream.depth, 480, 270, rs.format.z16, 6)
        
        # Start the pipeline
        self.pipeline.start(config)
        
        # Helper for alignment and colorizing depth
        self.align = rs.align(rs.stream.color)
        self.colorizer = rs.colorizer()
        
        # 3. Create a timer to "spin" the camera loop at 30 FPS
        self.timer = self.create_timer(1.0/30, self.timer_callback)
        self.get_logger().info("RealSense Producer Node has started.")

    def timer_callback(self):
        try:
            # Wait for a coherent set of frames
            frames = self.pipeline.wait_for_frames()
            
            # Align depth to color
            aligned_frames = self.align.process(frames)
            color_frame = aligned_frames.get_color_frame()
            depth_frame = aligned_frames.get_depth_frame()

            if not color_frame or not depth_frame:
                return

            # Convert to numpy arrays
            color_image = np.asanyarray(color_frame.get_data())
            depth_color_image = np.asanyarray(self.colorizer.colorize(depth_frame).get_data())

            # Combine side-by-side (Horizontal Stack)
            combined_image = np.hstack((color_image, depth_color_image))

            # 4. Encode to JPEG
            success, buffer = cv2.imencode('.jpg', color_image, [cv2.IMWRITE_JPEG_QUALITY, 80])
            #cv2.imwrite('test.jpg', color_image)
            
            if success:
                # Create and fill the ROS 2 message
                msg = CompressedImage()
                msg.header.stamp = self.get_clock().now().to_msg()
                msg.header.frame_id = "camera_link"
                msg.format = "jpeg"
                msg.data = buffer.tobytes()
                
                # Publish the frame
                self.publisher_.publish(msg)
            else:
                self.get_logger().info("FUCK")

        except Exception as e:
            self.get_logger().error(f"Error in timer callback: {e}")

    def destroy_node(self):
        self.pipeline.stop()
        super().destroy_node()

def main(args=None):
    rclpy.init(args=args)
    node = RealSenseProducer()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
