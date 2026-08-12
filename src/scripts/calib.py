import thymio
import time

CALIB_LR_MOT_SPEED = 300
WALL_THR = 3500
CALIB_FWBW_MOT_SPEED = 300
CALIB_FWBW_NUM_ROWS = 4
MAX_ROT_SPEED = 500
MOT_SPEED_WALL = 70
GROUND_BLACK_THR = 452
GROUND_WHITE_THR = 572
OPEN_LOOP_DELAY = 600
TIMEOUT_SEC = 2000 # based on 10 ms tick
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

left_calib = 0
right_calib = 0

ground_white = [0, 0]
ground_black = [1023, 1023]

speed_sum_left = 0
speed_sum_right = 0
mot_left_right_diff_perc = 0

imu_angle_diff = 360

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

while 1:

    if calib_state == 0: # ground white + color white
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

        mot.set_speed(CALIB_LR_MOT_SPEED, CALIB_LR_MOT_SPEED)
        calib_state = 1
        #print("ground white = " + str(ground_white))

    elif calib_state == 1: # motors left/right
        # avoid obstacles (follow the "tunnel")
        proxSum =  int((p0.value() + p1.value() - p3.value() - p4.value())/10);
        #print("proxSum = " + str(proxSum))
        mot.set_speed(CALIB_LR_MOT_SPEED+proxSum, CALIB_LR_MOT_SPEED-proxSum)

        #print(str(mot.get_left_speed()) + "," + str(mot.get_right_speed()))
        speed_sum_left = speed_sum_left + mot.get_left_speed()
        speed_sum_right = speed_sum_right + mot.get_right_speed()

        state_counter = state_counter + 1
        if state_counter >= OPEN_LOOP_DELAY: # enough to have a good estimation of the speed difference between left and right motors
            mot.set_speed(0, 0)
            #print("sum left = " + str(speed_sum_left))
            #print("sum right = " + str(speed_sum_right))            
            min_value = 0
            if(speed_sum_left > speed_sum_right):
                min_value = speed_sum_right
            else:
                min_value = speed_sum_left
            mot_left_right_diff_perc = (speed_sum_left - speed_sum_right)/min_value # positive means right motor is actually faster than left: robot tends to turn left so right motor speed is decreased and eventually its sum is less
            lr_factor = int(256*(mot_left_right_diff_perc/2))
            left_calib = int(256 + lr_factor)
            right_calib = int(256 - lr_factor)
            mot.set_straight_calibration(left_calib, right_calib)
            time.sleep(0.2)
            mot.set_speed(MOT_SPEED_WALL, MOT_SPEED_WALL)
            calib_state = 2
            #print("sum left = " + str(speed_sum_left) + ", sum right = " + str(speed_sum_right))
            #print("left calib = " + str(left_calib) + ", right calib = " + str(right_calib))
            #print("calib_state = " + str(calib_state))

    elif calib_state == 2: # advance till the end of the tunnel
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            calib_state = 15 # print calib values
            continue
        if p2.value() >= WALL_THR:
            mot.set_speed(0, 0)
            calib_timeout_counter = 0
            calib_state = 3
            #print("calib_state = " + str(calib_state))

    elif calib_state == 3: # try to be as straight as possible (perpendicular to the wall)
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            calib_state = 15 # print calib values
            continue        
        if abs(p1.value() - p3.value()) <= 100: # if the robot is straight enough
            mot.set_speed(0, 0)
            time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue
            calib_timeout_counter = 0
            calib_state = 4
            #print("calib_state = " + str(calib_state))
        else:
            # turn left or right depending on which side is closer to the wall
            if p1.value() > p3.value():
                mot.set_speed(-30, 30)
            else:
                mot.set_speed(30, -30)

    elif calib_state == 4: # ground black + color black
        # ground
        ground_black[0] = g0.reflected() - g0.ambient()
        if(ground_black[0] < 0):
            ground_black[0] = 0
        ground_black[1] = g1.reflected() - g1.ambient()
        if(ground_black[1] < 0):
            ground_black[1] = 0
        g0.set_calibration_all([ground_black[0], ground_black[1], ground_white[0], ground_white[1]])
        # color
        color.calibrate_and_save_black()

        imu.reset_angle()
        imu.set_gyro_scale_calib(0)
        imu.rotate_deg(180, MAX_ROT_SPEED) # positive rotation => rotate left
        calib_state = 5
        #print("calib_state = " + str(calib_state))
        #print("ground black = " + str(ground_black))
    
    elif calib_state == 5: # robot can be not perfectly straight after the rotation since not yet calibrated
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
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
    
    elif calib_state == 6: # gyro scaling calibration
        # avoid obstacles (follow the "tunnel")
        proxSum =  int((p0.value() + p1.value() - p3.value() - p4.value())/10);
        mot.set_speed(CALIB_LR_MOT_SPEED+proxSum, CALIB_LR_MOT_SPEED-proxSum)

        #print(str(mot.get_left_speed()) + "," + str(mot.get_right_speed()))
        speed_sum_left = speed_sum_left + mot.get_left_speed()
        speed_sum_right = speed_sum_right + mot.get_right_speed()

        state_counter = state_counter + 1
        if state_counter >= OPEN_LOOP_DELAY: # enough to have a good estimation of the angle difference between the robot angle after the 180 degree rotation and the expected 180 degrees
            mot.set_speed(0, 0)
            time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue
            #print("imu angle = " + str(imu.get_angle_raw()))
            imu_angle_diff = int(imu.get_angle_raw()/2) # divided by 2 because the robot should have rotated of 180 degrees but if the gyro is not well scaled it can be more or less than 180
            imu.set_gyro_scale_calib(imu_angle_diff)
            mot.set_speed(MOT_SPEED_WALL, MOT_SPEED_WALL)
            calib_state = 7
            #print("calib_state = " + str(calib_state))
            #print("imu diff angle = " + str(imu_angle_diff))

    elif calib_state == 7: # advance till the beginning of the tunnel
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            calib_state = 15 # print calib values
            continue         
        if p2.value() >= WALL_THR:
            mot.set_speed(0, 0)
            time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue    
            calib_timeout_counter = 0        
            calib_state = 8
            #print("calib_state = " + str(calib_state))

    elif calib_state == 8: # try to be as straight as possible (perpendicular to the wall)
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            calib_state = 15 # print calib values
            continue         
        if abs(p1.value() - p3.value()) <= 100: # if the robot is straight enough
            mot.set_speed(0, 0)
            time.sleep(1.0) # wait a bit to be sure to be completely stopped before continue
            imu.rotate_deg(180, MAX_ROT_SPEED) # positive rotation => rotate left
            calib_timeout_counter = 0
            calib_state = 9
            #print("calib_state = " + str(calib_state))
        else:
            # turn left or right depending on which side is closer to the wall
            if p1.value() > p3.value():
                mot.set_speed(-30, 30)
            else:
                mot.set_speed(30, -30)

    elif calib_state == 9: # robot should be straight because the rotation uses the gyro calibration
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            mot.set_speed(0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
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
            proxSum =  int((p0.value() + p1.value() - p3.value() - p4.value())/10);
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
                    mot.set_speed(MOT_SPEED_WALL, MOT_SPEED_WALL)
                    calib_mot_fw_time = sum(calib_mot_fw) // len(calib_mot_fw)
                    mot.distance_calib_timer_pause()
                    calib_timeout_counter = 0
                    calib_state = 11
                    #print("calib_state = " + str(calib_state))    
                    continue
                calib_mot_fw_state = 2;
                #print("go to state 2 from 1 (row " + str(calib_mot_fw_num_rows) + ")")

        elif calib_mot_fw_state == 2: # During the travel the robot should be able to detect the end of the black line
            #temp_rot = imu.get_angle_deg()*2
            #mot.set_speed(CALIB_FWBW_MOT_SPEED+temp_rot, CALIB_FWBW_MOT_SPEED-temp_rot) # try to keep the robot straight during the forward movement using the gyro feedback
            proxSum =  int((p0.value() + p1.value() - p3.value() - p4.value())/10);
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
            calib_state = 15 # print calib values
            continue        
        if abs(p1.value() - p3.value()) <= 100: # if the robot is straight enough
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
                delta = int((diff_prox - diff_prox_prev)/6)
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
                    mot.distance_calib_timer_pause()
                    calib_timeout_counter = 0
                    calib_state = 15
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
                delta = int((diff_prox - diff_prox_prev)/6)
                #print("delta = " + str(delta))
                diff_prox_prev = diff_prox
            mot.set_speed(-CALIB_FWBW_MOT_SPEED+temp_rot-proxSum-delta, -CALIB_FWBW_MOT_SPEED-temp_rot+proxSum+delta)
            if ((g0.value() > GROUND_WHITE_THR) and (g1.value() > GROUND_WHITE_THR)):
                calib_mot_bw_state = 1
                #print("go to state 1 from 2")
    
    elif calib_state == 15: # print calib values
        if calib_timeout_counter == 0:
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
            print("calibration timeout!")        
        print("mot left = " + str(left_calib))
        print("mot right = " + str(right_calib))
        # mot.set_straight_calibration(left_calib, right_calib) # already done at step 1
        if left_calib != 0 and right_calib != 0:
            mot.save_straight_calibration()
            #pass
        print("imu scaling = " + str(imu_angle_diff)) 
        # imu.set_gyro_scale_calib(imu_angle_diff) # already done at step 6
        if imu_angle_diff != 360:
            imu.save_gyro_scale_calib()
            #pass
        print("mot forward = " + str(calib_mot_fw_time))
        print("mot backward = " + str(calib_mot_bw_time))
        mot.set_distance_calibration(calib_mot_fw_time, calib_mot_bw_time)
        if calib_mot_fw_time != 0 and calib_mot_bw_time != 0:
            mot.save_distance_calibration()
            #pass
        print("color calib = " + str(color.get_calibration())) # already saved at step 0 and 4
        print("ground black = " + str(ground_black))
        print("ground white = " + str(ground_white))
        #g0.set_calibration_all([ground_black[0], ground_black[1], ground_white[0], ground_white[1]]) # already done at step 4
        if ground_black[0] != 1023 and ground_black[1] != 1023 and ground_white[0] != 0 and ground_white[1] != 0:
            g0.save_calibration()
            #pass
        break

    time.sleep(0.01)

