import thymio
import time

imu = thymio.IMU()

while 1:
    print("angle_raw = " + str(imu.get_angle_raw()))
    print("angle_deg = " + str(imu.get_angle_deg()))
    time.sleep(0.1)
