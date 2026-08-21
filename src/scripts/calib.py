import thymio
import time

CALIB_LR_MOT_SPEED = 300
CALIB_LR_RUN_SLEEP = 150 # 1.5 seconds
CALIB_LR_STOP_SLEEP = 0.0
CALIB_LR_FACTOR = 150
CALIB_LR_ITERATIONS = 3
WALL_THR_OA = 3000
WALL_THR = 3500
CALIB_FWBW_MOT_SPEED = 300
CALIB_FWBW_NUM_ROWS = 4
MAX_ROT_SPEED = 500
MOT_SPEED_WALL = 70
GROUND_BLACK_THR = 452
GROUND_WHITE_THR = 572
OPEN_LOOP_DELAY = 600
TIMEOUT_SEC = 2000 # based on 10 ms tick
GYRO_TIMEOUT_SEC = 16000 # find line + 4 slower turns
GYRO_ROT_SPEED = 125  # slower spin during gyro stripe calibration
LED_BRIGHTNESS = 8

mot = thymio.MOTORS()
imu = thymio.IMU()
p0 = thymio.PROXIMITY(0)
p1 = thymio.PROXIMITY(1)
p2 = thymio.PROXIMITY(2)
p3 = thymio.PROXIMITY(3)
p4 = thymio.PROXIMITY(4)
p5 = thymio.PROXIMITY(5)
p6 = thymio.PROXIMITY(6)
g0 = thymio.GROUND(0)
g1 = thymio.GROUND(1)
color = thymio.COLOR_SENSOR()
rgb_fl = thymio.LEDS_RGB(0)
rgb_fr = thymio.LEDS_RGB(1)
rgb_bl = thymio.LEDS_RGB(2)
rgb_br = thymio.LEDS_RGB(3)

ground_white = [0, 0]
ground_black = [1023, 1023]

mot_left_right_diff_perc = 0
calibLeft = 256.0
calibRight = 256.0
calib_lr_it = 0

imu_angle_diff = 0  # firmware GyroRotFactor; default 0 → 90° = 16383 raw
GYRO_RAW_90 = 16383  # firmware ROTATION_ANGLE_90 (0x3FFF)
GYRO_TURNS = 4  # full revolutions via left ground IR after first line
# Firmware: rotation_angle_90_ = 16383 + GyroRotFactor
# Stripe: expected_raw = N*4*16383; factor = (raw - expected)/(4N)

gyro_turn_count = 0
gyro_synced = 0
gyro_prev_black = 0
gyro_ground_black_thr = 100

calib_mot_fw_state = 0
calib_mot_fw_num_rows = 0
calib_mot_fw_first_row = 1
calib_mot_fw_sum = 0
calib_mot_fw_time = 0
calib_mot_fw = [0, 0, 0]

calib_mot_bw_state = 0
calib_mot_bw_num_rows = 0
calib_mot_bw_first_row = 1
calib_mot_bw_sum = 0
calib_mot_bw_time = 0
calib_mot_bw = [0, 0, 0]
diff_prox = 0
diff_prox_prev = 0
delta_count = 0
delta = 0

calib_state = 0
state_counter = 0
calib_timeout_counter = 0
fail_reason = ""
fail_state = -1

# Per-item success: only successful calibrations are saved to flash
ok_color_white = 0
ok_gyro = 0
ok_mot_lr = 0
ok_ground = 0
ok_color_black = 0
ok_mot_dist_fw = 0
ok_mot_dist_bw = 0

while 1:


    if calib_state == 0: # ground white + color white, then gyro at start
        mot.set_straight_calibration(256, 256) # reset calibration
        # ground
        ground_white[0] = g0.reflected() - g0.ambient()
        if(ground_white[0] < 0):
            ground_white[0] = 0
        ground_white[1] = g1.reflected() - g1.ambient()
        if(ground_white[1] < 0):
            ground_white[1] = 0     
        # color
        color.calibrate_and_save_white()
        ok_color_white = 1

        gyro_ground_black_thr = ground_white[0]/2

        # Gyro offsets values
        #imu.disable_gyro_auto_calib()
        #imu.calibrate_gyro()

        # Gyro at start: find floor line (g0), then N turns, set GyroRotFactor
        gyro_turn_count = 0
        gyro_synced = 0
        gyro_ir = g0.reflected() - g0.ambient()
        if gyro_ir < 0:
            gyro_ir = 0
        gyro_prev_black = 1 if (gyro_ir < gyro_ground_black_thr) else 0
        mot.set_speed(-GYRO_ROT_SPEED, GYRO_ROT_SPEED)  # CCW until first ground line
        calib_timeout_counter = 0
        calib_state = 20
        #print("ground white = " + str(ground_white))

    elif calib_state == 20: # find line → factor 0 + reset → N turns → factor=(raw-expected)/(4N)
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= GYRO_TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            fail_state = 20
            fail_reason = "Gyro stripe turns timed out (left ground IR did not see " + str(GYRO_TURNS) + " full turns). synced=" + str(gyro_synced) + " turns=" + str(gyro_turn_count)
            calib_state = 15
            continue

        mot.set_speed(-GYRO_ROT_SPEED, GYRO_ROT_SPEED)

        # Left ground proximity IR only (not color sensor)
        gyro_ir = g0.reflected() - g0.ambient()
        if gyro_ir < 0:
            gyro_ir = 0
        gyro_black = 1 if (gyro_ir < gyro_ground_black_thr) else 0
        if gyro_black == 1 and gyro_prev_black == 0:
            if gyro_synced == 0:
                # First ground line: clear factor (nominal 16383/90°) and zero angle
                imu.set_gyro_scale_calib(0)
                imu.reset_angle()
                gyro_synced = 1
                gyro_turn_count = 0
            else:
                gyro_turn_count = gyro_turn_count + 1
                if gyro_turn_count >= GYRO_TURNS:
                    mot.set_speed(0, 0)
                    time.sleep(1.0)
                    # Firmware: rotation_angle_90 = 16383 + factor
                    # After N true turns: expected = N*4*16383, factor = (raw-expected)/(4N)
                    gyro_raw = imu.get_angle_raw()
                    gyro_expected = GYRO_TURNS * 4 * GYRO_RAW_90
                    gyro_diff = gyro_raw - gyro_expected
                    imu_angle_diff = int(gyro_diff / (GYRO_TURNS * 4))
                    #print("gyro raw angle = " + str(gyro_raw))
                    #print("gyro expected raw (N*4*16383) = " + str(gyro_expected))
                    #print("gyro difference (raw - expected) = " + str(gyro_diff))
                    #print("imu GyroRotFactor (diff/(4N)) = " + str(imu_angle_diff))
                    #print("imu rotation_angle_90 (16383+factor) = " + str(GYRO_RAW_90 + imu_angle_diff))
                    imu.set_gyro_scale_calib(imu_angle_diff)
                    ok_gyro = 1
                    imu.reset_angle()
                    time.sleep(0.2)
                    # Face corridor: turn right 90° (CW)
                    imu.rotate_deg(-90, MAX_ROT_SPEED)
                    calib_timeout_counter = 0
                    calib_state = 21
        gyro_prev_black = gyro_black

    elif calib_state == 21: # wait face corridor, then original motor L/R calib
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            fail_state = 21
            fail_reason = "Timed out waiting to face the corridor after gyro (rotate_deg -90)"
            calib_state = 15
            continue
        if imu.rotation_completed():
            time.sleep(1.0)
            imu.reset_angle()
            time.sleep(0.1)
            calib_state = 1

    elif calib_state == 1: # go back a bit to save some space for the left/right calibration
        mot.set_speed(-int(CALIB_LR_MOT_SPEED/2), -int(CALIB_LR_MOT_SPEED/2))
        time.sleep(1.0)
        mot.set_speed(0, 0)
        time.sleep(0.5)
        state_counter = 0
        calib_state = 22

    elif calib_state == 22: # go forward with obstacle avoidance in order to align with walls
        # avoid obstacles (follow the "tunnel")
        #proxSum =  int((p0.value() + p1.value() - p3.value() - p4.value())/10);
        proxSum =  int((p0.value() - p4.value())/15);
        mot.set_speed(CALIB_LR_MOT_SPEED+proxSum, CALIB_LR_MOT_SPEED-proxSum)

        state_counter = state_counter + 1
        if state_counter >= 200: # 2 seconds
            mot.set_speed(0, 0)
            time.sleep(1.0)
            imu.reset_angle()
            time.sleep(0.1)
            calib_state = 2

    elif calib_state == 2: # motors left/right

        if calib_lr_it < CALIB_LR_ITERATIONS:
            #rgb_fr.set_intensity(0, 0, 7)
            calib_lr_it = calib_lr_it + 1
            mot.set_speed(CALIB_LR_MOT_SPEED, CALIB_LR_MOT_SPEED)
            #time.sleep(CALIB_LR_RUN_SLEEP)
            state_counter = 0
            calib_state = 23          
        else:
            #print("motor straight calib: " + str(mot.get_straight_calibration()))
            ok_mot_lr = 1
            rgb_fr.set_intensity(0, 0, 0)
            rgb_br.set_intensity(0, 0, 0)
            rgb_bl.set_intensity(0, 0, 0)
            calib_timeout_counter = 0
            calib_state = 3

    elif calib_state == 23: # go forward for a while to see if the robot goes straight or not
        state_counter = state_counter + 1
        if state_counter >= CALIB_LR_RUN_SLEEP:
            angle = imu.get_angle_raw()
            imu.reset_angle()
            #print("LR angle " + str(angle))
            calibLeft = calibLeft + angle/CALIB_LR_FACTOR
            calibRight = calibRight - angle/CALIB_LR_FACTOR
            mot.set_straight_calibration(int(calibLeft), int(calibRight))
            calib_state = 2            
        if p0.value() > 2500:
            rgb_bl.set_intensity(7, 0, 0)
        else:
            rgb_bl.set_intensity(0, 0, 0)
        if p4.value() > 2500:
            rgb_br.set_intensity(7, 0, 0)
        else:
            rgb_br.set_intensity(0, 0, 0)

    elif calib_state == 3: # advance till the end of the tunnel
    
        # avoid obstacles (follow the "tunnel")
        #proxSum =  int((p0.value() + p1.value() - p3.value() - p4.value())/10);
        proxSum =  int((p0.value() - p4.value())/15);
        #print("proxSum = " + str(proxSum))
        mot.set_speed(CALIB_LR_MOT_SPEED+proxSum, CALIB_LR_MOT_SPEED-proxSum)

        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            fail_state = 2
            fail_reason = "Timed out advancing to end wall (state 2)"
            calib_state = 15 # print calib values
            continue
        if p2.value() >= WALL_THR_OA:
            mot.set_speed(0, 0)
            time.sleep(1.0)
            calib_timeout_counter = 0
            calib_state = 4
            #print("calib_state = " + str(calib_state))

    elif calib_state == 4: # ground black + color black
        # ground
        ground_black[0] = g0.reflected() - g0.ambient()
        if(ground_black[0] < 0):
            ground_black[0] = 0
        ground_black[1] = g1.reflected() - g1.ambient()
        if(ground_black[1] < 0):
            ground_black[1] = 0
        g0.set_calibration_from_values([ground_black[0], ground_black[1], ground_white[0], ground_white[1]])
        ok_ground = 1
        # color
        color.calibrate_and_save_black()
        ok_color_black = 1
        #print("ground black = " + str(ground_black))

        mot.set_speed(-CALIB_FWBW_MOT_SPEED, -CALIB_FWBW_MOT_SPEED)
        calib_timeout_counter = 0
        calib_state = 13
    
    elif calib_state == 5: # robot can be not perfectly straight after the rotation since not yet calibrated
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            fail_state = 5
            fail_reason = "Timed out waiting for 180° rotation after black (state 5)"
            calib_state = 15 # print calib values
            continue         
        if imu.rotation_completed():
            time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue
            state_counter = 0
            imu.reset_angle()
            mot.set_speed(CALIB_LR_MOT_SPEED, CALIB_LR_MOT_SPEED)
            calib_timeout_counter = 0
            calib_state = 6
            #print("calib_state = " + str(calib_state))            
    
    elif calib_state == 6: # wall-follow open-loop (original path; gyro set calls removed)
        # avoid obstacles (follow the "tunnel")
        #proxSum =  int((p0.value() + p1.value() - p3.value() - p4.value())/10);
        proxSum =  int((p0.value() - p4.value())/15);
        mot.set_speed(CALIB_LR_MOT_SPEED+proxSum, CALIB_LR_MOT_SPEED-proxSum)

        state_counter = state_counter + 1
        if state_counter >= OPEN_LOOP_DELAY:
            mot.set_speed(0, 0)
            time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue
            # gyro factor already set at start — do not call set_gyro_scale_calib here
            mot.set_speed(MOT_SPEED_WALL, MOT_SPEED_WALL)
            calib_timeout_counter = 0
            calib_state = 7
            #print("calib_state = " + str(calib_state))

    elif calib_state == 7: # advance till the beginning of the tunnel
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            fail_state = 7
            fail_reason = "Timed out advancing to start wall (state 7)"
            calib_state = 15 # print calib values
            continue         
        if p2.value() >= WALL_THR:
            mot.set_speed(0, 0)
            time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue    
            imu.rotate_deg(180, MAX_ROT_SPEED) # positive rotation => rotate left
            calib_timeout_counter = 0        
            calib_state = 9
            #print("calib_state = " + str(calib_state))

    elif calib_state == 9: # robot should be straight because the rotation uses the gyro calibration
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            fail_state = 9
            fail_reason = "Timed out waiting for 180° rotation before distance (state 9)"
            calib_state = 15 # print calib values
            continue         
        if imu.rotation_completed():
            time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue
            state_counter = 0
            mot.set_speed(CALIB_FWBW_MOT_SPEED, CALIB_FWBW_MOT_SPEED)      
            calib_timeout_counter = 0      
            calib_state = 10
            #print("calib_state = " + str(calib_state))

    elif calib_state == 10: # motors forward
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            fail_state = 10
            fail_reason = "Timed out during forward distance calibration (state 10)"
            calib_state = 15 # print calib values
            continue        
        if calib_mot_fw_state == 0:
            mot.distance_calib_timer_set(2147483647) # Set a big delay in order for the timer to run for the entire calibration sequence without stopping the robot
            mot.distance_calib_timer_start()
            calib_mot_fw_state = 1
            imu.reset_angle()
            #print("go to state 1 from 0")

        elif calib_mot_fw_state == 1: # Go forward until the start of the first black line is detected, then reset the timer
            #temp_rot = imu.get_angle_deg()*2
            #mot.set_speed(CALIB_FWBW_MOT_SPEED+temp_rot, CALIB_FWBW_MOT_SPEED-temp_rot) # try to keep the robot straight during the forward movement using the gyro feedback
            #proxSum =  int((p0.value() + p1.value() - p3.value() - p4.value())/10);
            proxSum =  int((p0.value() - p4.value())/15);
            mot.set_speed(CALIB_FWBW_MOT_SPEED+proxSum, CALIB_FWBW_MOT_SPEED-proxSum)

            #print("g0 = " + str(g0.value()) + ", g1 = " + str(g1.value()))
            if ((g0.value() < GROUND_BLACK_THR) and (g1.value() < GROUND_BLACK_THR)):
                if calib_mot_fw_first_row == 1:
                    calib_mot_fw_first_row = 0
                else:
                    calib_mot_fw[calib_mot_fw_num_rows-1] = mot.distance_calib_timer_get()
                    #print("timer value = " + str(calib_mot_fw[calib_mot_fw_num_rows-1]))
                mot.set_speed(0, 0)
                time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue
                mot.distance_calib_timer_reset()
                mot.set_speed(CALIB_FWBW_MOT_SPEED, CALIB_FWBW_MOT_SPEED)
                calib_mot_fw_num_rows = calib_mot_fw_num_rows + 1
                if (calib_mot_fw_num_rows == CALIB_FWBW_NUM_ROWS):
                    mot.set_speed(0, 0)
                    calib_mot_fw_time = sum(calib_mot_fw) // len(calib_mot_fw)
                    ok_mot_dist_fw = 1
                    mot.distance_calib_timer_pause()
                    calib_timeout_counter = 0
                    calib_state = 15
                    #print("calib_state = " + str(calib_state))    
                    continue
                calib_mot_fw_state = 2;
                #print("go to state 2 from 1 (row " + str(calib_mot_fw_num_rows) + ")")

        elif calib_mot_fw_state == 2: # During the travel the robot should be able to detect the end of the black line
            #temp_rot = imu.get_angle_deg()*2
            #mot.set_speed(CALIB_FWBW_MOT_SPEED+temp_rot, CALIB_FWBW_MOT_SPEED-temp_rot) # try to keep the robot straight during the forward movement using the gyro feedback
            #proxSum =  int((p0.value() + p1.value() - p3.value() - p4.value())/10);
            proxSum =  int((p0.value() - p4.value())/15);
            mot.set_speed(CALIB_FWBW_MOT_SPEED+proxSum, CALIB_FWBW_MOT_SPEED-proxSum)            
            if ((g0.value() > GROUND_WHITE_THR) and (g1.value() > GROUND_WHITE_THR)):
                calib_mot_fw_state = 1
                #print("go to state 1 from 2")

    elif calib_state == 11: # advance till the wall in order to cross the black line
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            fail_state = 11
            fail_reason = "Timed out advancing to wall after forward distance (state 11)"
            calib_state = 15 # print calib values
            continue        
        if p2.value() >= WALL_THR:
            mot.set_speed(0, 0)
            time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue
            mot.set_speed(-CALIB_FWBW_MOT_SPEED, -CALIB_FWBW_MOT_SPEED)
            calib_timeout_counter = 0
            calib_state = 13
            #print("calib_state = " + str(calib_state))

    elif calib_state == 12: # try to be as straight as possible (perpendicular to the wall)
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            fail_state = 12
            fail_reason = "Timed out straightening before backward distance (state 12)"
            calib_state = 15 # print calib values
            continue        
        if abs(p1.value() - p3.value()) <= 300: # if the robot is straight enough
            mot.set_speed(0, 0)
            time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue
            mot.set_speed(-CALIB_FWBW_MOT_SPEED, -CALIB_FWBW_MOT_SPEED)
            calib_timeout_counter = 0
            calib_state = 13
            #print("calib_state = " + str(calib_state))
        else:
            # turn left or right depending on which side is closer to the wall
            if p1.value() > p3.value():
                mot.set_speed(-30, 30)
            else:
                mot.set_speed(30, -30)
    
    elif calib_state == 13: # leave the black zone 
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            fail_state = 13
            fail_reason = "Timed out leaving black zone (state 13)"
            calib_state = 15 # print calib values
            continue        
        if(g0.value() > GROUND_WHITE_THR) and (g1.value() > GROUND_WHITE_THR):
            calib_timeout_counter = 0
            calib_state = 14
            #print("calib_state = " + str(calib_state))

    elif calib_state == 14: # motors backward
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            fail_state = 14
            fail_reason = "Timed out during backward distance calibration (state 14)"
            calib_state = 15 # print calib values
            continue        
        if calib_mot_bw_state == 0:
            mot.distance_calib_timer_set(2147483647) # Set a big delay in order for the timer to run for the entire calibration sequence without stopping the robot
            mot.distance_calib_timer_start()
            calib_mot_bw_state = 1
            imu.reset_angle()            
            #print("go to state 1 from 0")

        elif calib_mot_bw_state == 1: # Go backward until the start of the first black line is detected, then reset the timer
            temp_rot = 0 #imu.get_angle_deg()*4            
            #mot.set_speed(-CALIB_FWBW_MOT_SPEED+temp_rot, -CALIB_FWBW_MOT_SPEED-temp_rot) # try to keep the robot straight during the forward movement using the gyro feedback
            proxSum =  0 #int((p5.value() - p6.value())/10);
            diff_prox = p0.value() - p4.value()
            delta_count = delta_count + 1
            if delta_count > 10:
                delta_count = 0
                delta = int((diff_prox - diff_prox_prev)/10)
                #print("delta = " + str(delta))
                diff_prox_prev = diff_prox
            mot.set_speed(-CALIB_FWBW_MOT_SPEED+temp_rot-proxSum-delta, -CALIB_FWBW_MOT_SPEED-temp_rot+proxSum+delta)

            if ((g0.value() < GROUND_BLACK_THR) and (g1.value() < GROUND_BLACK_THR)):
                if calib_mot_bw_first_row == 1:
                    calib_mot_bw_first_row = 0
                else:
                    calib_mot_bw[calib_mot_bw_num_rows-1] = mot.distance_calib_timer_get()
                    #print("timer value = " + str(calib_mot_bw[calib_mot_bw_num_rows-1]))
                mot.set_speed(0, 0)
                time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue
                mot.distance_calib_timer_reset()
                mot.set_speed(-CALIB_FWBW_MOT_SPEED, -CALIB_FWBW_MOT_SPEED)
                calib_mot_bw_num_rows = calib_mot_bw_num_rows + 1
                if (calib_mot_bw_num_rows == CALIB_FWBW_NUM_ROWS):
                    mot.set_speed(0, 0)
                    calib_mot_bw_time = sum(calib_mot_bw) // len(calib_mot_bw)
                    ok_mot_dist_bw = 1
                    mot.distance_calib_timer_pause()
                    calib_timeout_counter = 0
                    calib_state = 24
                    #print("calib_state = " + str(calib_state))
                    continue
                calib_mot_bw_state = 2;
                #print("go to state 2 from 1 (row " + str(calib_mot_bw_num_rows) + ")")

        elif calib_mot_bw_state == 2: # During the travel the robot should be able to detect the end of the black line
            temp_rot = 0 #imu.get_angle_deg()*4            
            #mot.set_speed(-CALIB_FWBW_MOT_SPEED+temp_rot, -CALIB_FWBW_MOT_SPEED-temp_rot) # try to keep the robot straight during the forward movement using the gyro feedback
            proxSum =  0 #int((p5.value() - p6.value())/10);
            diff_prox = p0.value() - p4.value()
            delta_count = delta_count + 1
            if delta_count > 10:
                delta_count = 0
                delta = int((diff_prox - diff_prox_prev)/10)
                #print("delta = " + str(delta))
                diff_prox_prev = diff_prox
            mot.set_speed(-CALIB_FWBW_MOT_SPEED+temp_rot-proxSum-delta, -CALIB_FWBW_MOT_SPEED-temp_rot+proxSum+delta)
            if ((g0.value() > GROUND_WHITE_THR) and (g1.value() > GROUND_WHITE_THR)):
                calib_mot_bw_state = 1
                #print("go to state 1 from 2")
    
    elif calib_state == 24: # go back till the beginning of the tunnel
        mot.set_speed(-CALIB_FWBW_MOT_SPEED, -CALIB_FWBW_MOT_SPEED)
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            fail_state = 7
            fail_reason = "Timed out advancing to start wall (state 7)"
            calib_state = 15 # print calib values
            continue         
        if p5.value() >= WALL_THR:
            mot.set_speed(0, 0)
            time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue    
            state_counter = 0
            mot.set_speed(CALIB_FWBW_MOT_SPEED, CALIB_FWBW_MOT_SPEED)      
            calib_timeout_counter = 0      
            calib_state = 10

    elif calib_state == 15: # print calib values + save successful items only
        if fail_reason != "":
            print("fail reason = " + fail_reason)
            print("fail state = " + str(fail_state))
        if fail_reason == "" and calib_timeout_counter == 0:
            rgb_fl.set_intensity(0, LED_BRIGHTNESS, 0)
            rgb_fr.set_intensity(0, LED_BRIGHTNESS, 0)
            rgb_bl.set_intensity(0, LED_BRIGHTNESS, 0)
            rgb_br.set_intensity(0, LED_BRIGHTNESS, 0)
            print("calibration completed successfully!")
        else:
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            print("calibration failed or timed out!")

        #print("=== calibration report (flash save) ===")
        # Rule: save every successful new calibration; skip only if that item failed / was not reached

        print("mot left = " + str(int(calibLeft)))
        print("mot right = " + str(int(calibRight)))
        if ok_mot_lr == 1:
            mot.save_straight_calibration()
            print("mot L/R straight SAVED to flash")
        else:
            print("mot L/R straight NOT SAVED (calibration failed or not reached)")

        print("imu scaling = " + str(imu_angle_diff))
        if ok_gyro == 1:
            imu.save_gyro_scale_calib()
            print("imu gyro scale SAVED to flash")
        else:
            print("imu gyro scale NOT SAVED (calibration failed or not reached)")
        print("imu offsets = " + str(imu.get_gyro_calib()))
        imu.save_gyro_calib()
        print("imu gyro offsets SAVED to flash")
        imu.enable_gyro_auto_calib()

        print("mot forward = " + str(calib_mot_fw_time))
        print("mot backward = " + str(calib_mot_bw_time))
        if ok_mot_dist_fw == 1 and ok_mot_dist_bw == 1:
            mot.set_distance_calibration(calib_mot_fw_time, calib_mot_bw_time)
            mot.save_distance_calibration()
            print("mot distance fw/bw SAVED to flash")
        else:
            print("mot distance fw/bw NOT SAVED (calibration failed or not reached; fw_ok:" + str(ok_mot_dist_fw) + " bw_ok:" + str(ok_mot_dist_bw) + ")")

        print("color calib = " + str(color.get_calibration()))
        if ok_color_white == 1:
            print("color white SAVED to flash (during run)")
        else:
            print("color white NOT SAVED (calibration failed or not reached)")
        if ok_color_black == 1:
            print("color black SAVED to flash (during run)")
        else:
            print("color black NOT SAVED (calibration failed or not reached)")

        print("ground black = " + str(ground_black))
        print("ground white = " + str(ground_white))
        if ok_ground == 1:
            g0.save_calibration_from_values()
            print("ground sensors SAVED to flash")
        else:
            print("ground sensors NOT SAVED (calibration failed or not reached)")

        # Explicit end marker. Flash writes above stall the CPU for a while, so
        # the host cannot tell "report finished" from "robot busy" by silence.
        # No '=' in this line: the host parses key=value pairs.
        print("calibration report end")
        break

    time.sleep(0.01)

