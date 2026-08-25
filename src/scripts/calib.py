# Thymio 3 production calibration — arena A4 v3b (Gil 21.08.26)
#
# Walled 21 x 93 cm corridor. Start: rear on the START wall, on white,
# facing the far end. Narrow black patch at 14.5-21.3 cm, then four
# 1.5 cm bands at 15 cm pitch (23 / 38 / 53 / 68 cm).
#
# MODE is replaced by the web app before upload:
#   full      complete sequence
#   sensors   white + black only
#   gyro      sensors + wall-align 360
#   distance  stripe L/R + fw/bw (after factory reset of previous calib)
import thymio
import time

MODE = "__CALIB_MODE__"
if MODE.startswith("__"):
    MODE = "full"

SCRIPT_VERSION = "22.08.26v21"

CALIB_LR_FACTOR = 150
CALIB_FWBW_MOT_SPEED = 300
CALIB_FWBW_NUM_ROWS = 4
# Same hysteresis as V2 / gctronic and the colour-line V3 script.
# Applied to g0.value() AFTER ground white/black are set: black→0, white→1023,
# so 452 / 572 is a ±60 band around the midpoint. The 1.5 cm v3b stripes are
# the same high-contrast black-on-white as V2; the numbers stay.
GROUND_BLACK_THR = 452
GROUND_WHITE_THR = 572
TIMEOUT_SEC = 2000  # 20 s at 10 ms
LED_BRIGHTNESS = 8
GYRO_ROT_SPEED = 300  # behavior.c MOVEMENT_SPEED for manual gyro 360
REAR_SPEED = -200
REAR_APPROACH_SEC = 2.5
GYRO_SETTLE_SEC = 0.2
GYRO_READ_COUNT = 10
GYRO_READ_DT = 0.01
GYRO_OFFSET_WAIT_SEC = 10.0
GYRO_OFFSET_POLL_SEC = 0.1
# Firmware factory defaults (settings.h) used when wiping previous calib.
DEFAULT_GROUND_BLACK = 35
DEFAULT_GROUND_WHITE = 300

mot = thymio.MOTORS()
imu = thymio.IMU()
p0 = thymio.PROXIMITY(0)
p4 = thymio.PROXIMITY(4)
g0 = thymio.GROUND(0)
g1 = thymio.GROUND(1)
color = thymio.COLOR_SENSOR()
rgb_fl = thymio.LEDS_RGB(0)
rgb_fr = thymio.LEDS_RGB(1)
rgb_bl = thymio.LEDS_RGB(2)
rgb_br = thymio.LEDS_RGB(3)

ground_white = [0, 0]
ground_black = [1023, 1023]

calibLeft = 256.0
calibRight = 256.0
imu_angle_diff = 0

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
diff_prox_prev_first = 1
delta_count = 0
delta = 0

calib_state = 0
calib_timeout_counter = 0
fail_reason = ""
fail_state = -1

ok_color_white = 0
ok_gyro = 0
ok_mot_lr = 0
ok_ground = 0
ok_color_black = 0
ok_mot_dist_fw = 0
ok_mot_dist_bw = 0


def set_red_leds():
    rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
    rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
    rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
    rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)


def set_green_leds():
    rgb_fl.set_intensity(0, LED_BRIGHTNESS, 0)
    rgb_fr.set_intensity(0, LED_BRIGHTNESS, 0)
    rgb_bl.set_intensity(0, LED_BRIGHTNESS, 0)
    rgb_br.set_intensity(0, LED_BRIGHTNESS, 0)


def fail(state, reason):
    global fail_state, fail_reason, calib_state
    mot.set_speed(0, 0)
    set_red_leds()
    fail_state = state
    fail_reason = reason
    calib_state = 15


def sample_ground(dest):
    v0 = g0.reflected() - g0.ambient()
    v1 = g1.reflected() - g1.ambient()
    if v0 < 0:
        v0 = 0
    if v1 < 0:
        v1 = 0
    dest[0] = v0
    dest[1] = v1


def both_black():
    return (g0.value() < GROUND_BLACK_THR) and (g1.value() < GROUND_BLACK_THR)


def both_white():
    return (g0.value() > GROUND_WHITE_THR) and (g1.value() > GROUND_WHITE_THR)


def either_white():
    return (g0.value() > GROUND_WHITE_THR) or (g1.value() > GROUND_WHITE_THR)


def wait_gyro_settle():
    time.sleep(GYRO_SETTLE_SEC)


def gyro_read():
    wait_gyro_settle()
    raw_sum = 0
    deg_sum = 0
    i = 0
    while i < GYRO_READ_COUNT:
        raw_sum = raw_sum + imu.get_angle_raw()
        deg_sum = deg_sum + imu.get_angle_deg()
        i = i + 1
        time.sleep(GYRO_READ_DT)
    return raw_sum // GYRO_READ_COUNT, deg_sum // GYRO_READ_COUNT


def gyro_reset():
    wait_gyro_settle()
    imu.reset_angle()


def gyro_offsets_nonzero(offs):
    return (offs[0] != 0) and (offs[1] != 0) and (offs[2] != 0)


def wait_gyro_offsets():
    mot.set_speed(0, 0)
    imu.enable_gyro_auto_calib()
    print("waiting for gyro offsets (auto-calib, stay still)")
    t = 0.0
    while t < GYRO_OFFSET_WAIT_SEC:
        offs = imu.get_gyro_calib()
        if gyro_offsets_nonzero(offs):
            imu.disable_gyro_auto_calib()
            #print("imu offsets = " + str(offs) + " (frozen for this run)")
            return 1
        time.sleep(GYRO_OFFSET_POLL_SEC)
        t = t + GYRO_OFFSET_POLL_SEC
    print("imu offsets still zero = " + str(imu.get_gyro_calib()))
    imu.disable_gyro_auto_calib()
    return 0


def reset_previous_calibrations():
    # Wipe RAM and flash so this run does not inherit L/R, distance, gyro or
    # ground from a previous robot / previous attempt. Colour has no factory
    # reset; white then black samples overwrite it during the run.
    print("resetting previous calibration")
    mot.reset_straight_calibration()
    mot.save_straight_calibration()
    mot.reset_distance_calibration()
    mot.save_distance_calibration()
    imu.set_gyro_scale_calib(0)
    imu.save_gyro_scale_calib()
    imu.reset_gyro_calib()
    imu.save_gyro_calib()
    g0.set_and_save_calibration_from_values(
        [DEFAULT_GROUND_BLACK, DEFAULT_GROUND_BLACK,
         DEFAULT_GROUND_WHITE, DEFAULT_GROUND_WHITE])
    print("previous calibration reset to factory")


print("script version = " + SCRIPT_VERSION)
#print("calib mode = " + MODE)

while 1:

    if calib_state == 0:
        reset_previous_calibrations()
        if wait_gyro_offsets() == 0:
            fail(0, "Timed out waiting for gyro offsets (keep the robot still)")
            continue

        if MODE == "distance":
            mot.set_speed(200, 200)
            calib_timeout_counter = 0
            calib_state = 3
            continue

        sample_ground(ground_white)
        color.calibrate_and_save_white()
        ok_color_white = 1

        # Square the bumper on the START wall, then roll onto the black patch.
        rgb_bl.set_intensity(7, 0, 0)
        rgb_br.set_intensity(7, 0, 0)
        mot.set_speed(-200, -200)
        time.sleep(0.2)
        mot.set_speed(0, 0)
        time.sleep(0.4)
        gyro_reset()

        rgb_bl.set_intensity(0, 0, 0)
        rgb_br.set_intensity(0, 0, 0)
        rgb_fl.set_intensity(0, 7, 0)
        rgb_fr.set_intensity(0, 7, 0)
        mot.set_speed(200, 200)
        time.sleep(1.1)
        mot.set_speed(0, 0)
        rgb_fl.set_intensity(0, 0, 0)
        rgb_fr.set_intensity(0, 0, 0)
        time.sleep(0.1)
        calib_state = 1

    elif calib_state == 1:
        # Ground IRs should now be on the narrow black patch (arena v3b).
        sample_ground(ground_black)
        g0.set_calibration_from_values(
            [ground_black[0], ground_black[1], ground_white[0], ground_white[1]])
        ok_ground = 1
        color.calibrate_and_save_black()
        ok_color_black = 1
        #print("ground black = " + str(ground_black))
        #print("ground white = " + str(ground_white))

        if MODE == "sensors":
            calib_state = 15
            continue
        calib_state = 2

    elif calib_state == 2:
        # Firmware CalibrateGyro(): after -360, reset, leftover yaw, factor = -raw/4.
        # The 1.1 s roll-out is extra vs the manual menu; rotate_deg resets the
        # integrator, so that yaw is saved here and added to the wall leftover.
        time.sleep(0.2) 
        gyro_raw_before_turn, gyro_deg_before_turn = gyro_read()
        #print("gyro raw before turn = " + str(gyro_raw_before_turn))
        #print("gyro deg before turn = " + str(gyro_deg_before_turn))
        #print("gyro: rotate_deg -360 at speed " + str(GYRO_ROT_SPEED) + " (scale 0)")
        imu.rotate_deg(-360, GYRO_ROT_SPEED)
        while imu.rotation_completed() == 0:
            time.sleep(0.1)
        time.sleep(0.3) 
        gyro_raw_after_360, gyro_deg_after_360 = gyro_read()
        #print("gyro after 360 raw = " + str(gyro_raw_after_360))
        #print("gyro after 360 deg = " + str(gyro_deg_after_360))
        #print("gyro after 360 raw as deg = " + str((gyro_raw_after_360 * 90) // 16384))
        gyro_reset()
        #print("gyro: 360 done, integrator reset, reverse 2.5 s then sample leftover")

        rgb_fl.set_intensity(0, 0, 7)
        time.sleep(0.1)
        rgb_fl.set_intensity(0, 0, 0)
        mot.set_speed(REAR_SPEED, REAR_SPEED)
        time.sleep(REAR_APPROACH_SEC)
        mot.set_speed(0, 0)
        time.sleep(0.3) 
        leftover, leftover_deg = gyro_read()
        angle_raw = gyro_raw_before_turn + leftover
        rgb_fl.set_intensity(0, 7, 0)
        imu_angle_diff = int(-angle_raw / 4)
        imu.set_gyro_scale_calib(imu_angle_diff)
        ##print("gyro raw leftover = " + str(leftover))
        #print("gyro leftover deg = " + str(leftover_deg))
        #print("gyro leftover raw as deg = " + str((leftover * 90) // 16384))
        #print("gyro raw total = " + str(angle_raw))
        #print("imu scaling = " + str(imu_angle_diff) + " applied in RAM (flash at end)")
        gyro_reset()
        ok_gyro = 1

        if MODE == "gyro":
            calib_state = 15
            continue
        calib_state = 3

    elif calib_state == 3:
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            fail(3, "Timed out finding black after gyro (state 3)")
            continue
        mot.set_speed(200, 200)
        if both_black():
            time.sleep(0.1)
            mot.set_speed(0, 0)
            #print("found black rectangle: " + str(g0.value()) + ", " + str(g1.value()))
            calib_timeout_counter = 0
            calib_state = 5

    elif calib_state == 5:
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            fail(5, "Timed out finding white after black patch (state 5)")
            continue
        mot.set_speed(100, 100)
        if both_white():
            mot.set_speed(0, 0)
            time.sleep(0.5)
            #print("found white after rectangle: " + str(g0.value()) + ", " + str(g1.value()))
            calib_timeout_counter = 0
            calib_state = 10
            #time.sleep(0.5)
            #mot.set_speed(CALIB_FWBW_MOT_SPEED, CALIB_FWBW_MOT_SPEED)

    elif calib_state == 10:
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            fail(10, "Timed out during forward distance calibration (state 10)")
            continue
        if calib_mot_fw_state == 0:
            mot.distance_calib_timer_set(2147483647)
            mot.distance_calib_timer_start()
            calib_mot_fw_state = 1
            gyro_reset()
            #print("go to state 1 from 0")

        elif calib_mot_fw_state == 1:
            mot.set_speed(CALIB_FWBW_MOT_SPEED, CALIB_FWBW_MOT_SPEED)
            if both_black():
                if calib_mot_fw_first_row == 1:
                    calib_mot_fw_first_row = 0
                else:
                    calib_mot_fw[calib_mot_fw_num_rows - 1] = mot.distance_calib_timer_get()
                    #print("timer value = " + str(calib_mot_fw[calib_mot_fw_num_rows - 1]))
                mot.set_speed(0, 0)
                time.sleep(0.8)
                angle, _angle_deg = gyro_read()
                gyro_reset()
                #print("LR angle = " + str(angle))
                calibLeft = calibLeft + angle / CALIB_LR_FACTOR
                calibRight = calibRight - angle / CALIB_LR_FACTOR
                mot.set_straight_calibration(int(calibLeft), int(calibRight))

                if p0.value() > 2500:
                    rgb_bl.set_intensity(7, 0, 0)
                else:
                    rgb_bl.set_intensity(0, 0, 0)
                if p4.value() > 2500:
                    rgb_br.set_intensity(7, 0, 0)
                else:
                    rgb_br.set_intensity(0, 0, 0)

                mot.distance_calib_timer_reset()
                mot.set_speed(CALIB_FWBW_MOT_SPEED, CALIB_FWBW_MOT_SPEED)
                calib_mot_fw_num_rows = calib_mot_fw_num_rows + 1
                if calib_mot_fw_num_rows == CALIB_FWBW_NUM_ROWS:
                    mot.set_speed(0, 0)
                    calib_mot_fw_time = sum(calib_mot_fw) // len(calib_mot_fw)
                    ok_mot_dist_fw = 1
                    mot.distance_calib_timer_pause()
                    calib_timeout_counter = 0
                    #print("motor straight calib = " + str(mot.get_straight_calibration()))
                    ok_mot_lr = 1
                    calib_state = 11
                    continue
                calib_mot_fw_state = 2

        elif calib_mot_fw_state == 2:
            mot.set_speed(CALIB_FWBW_MOT_SPEED, CALIB_FWBW_MOT_SPEED)
            if both_white():
                calib_mot_fw_state = 1

    elif calib_state == 11:
        mot.set_speed(200, 200)
        time.sleep(1)
        mot.set_speed(0, 0)
        time.sleep(0.2)
        mot.set_speed(-CALIB_FWBW_MOT_SPEED, -CALIB_FWBW_MOT_SPEED)
        calib_timeout_counter = 0
        calib_state = 13

    elif calib_state == 13:
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            fail(13, "Timed out leaving black zone (state 13)")
            continue
        if both_white():
            calib_timeout_counter = 0
            calib_state = 14

    elif calib_state == 14:
        calib_timeout_counter = calib_timeout_counter + 1
        if calib_timeout_counter >= TIMEOUT_SEC:
            fail(14, "Timed out during backward distance calibration (state 14)")
            continue
        if calib_mot_bw_state == 0:
            mot.distance_calib_timer_set(2147483647)
            mot.distance_calib_timer_start()
            calib_mot_bw_state = 1
            gyro_reset()

        elif calib_mot_bw_state == 1:
            temp_rot = 0
            proxSum = 0
            diff_prox = p0.value() - p4.value()
            delta_count = delta_count + 1
            if delta_count > 10:
                delta_count = 0
                if diff_prox_prev_first == 1:
                    diff_prox_prev_first = 0
                    diff_prox_prev = diff_prox
                delta = int((diff_prox - diff_prox_prev) / 8)
                diff_prox_prev = diff_prox
            mot.set_speed(-CALIB_FWBW_MOT_SPEED + temp_rot - proxSum - delta,
                          -CALIB_FWBW_MOT_SPEED - temp_rot + proxSum + delta)

            if both_black():
                if calib_mot_bw_first_row == 1:
                    calib_mot_bw_first_row = 0
                else:
                    calib_mot_bw[calib_mot_bw_num_rows - 1] = mot.distance_calib_timer_get()
                    #print("timer value = " + str(calib_mot_bw[calib_mot_bw_num_rows - 1]))
                mot.set_speed(0, 0)
                time.sleep(1.0)
                mot.distance_calib_timer_reset()
                mot.set_speed(-CALIB_FWBW_MOT_SPEED, -CALIB_FWBW_MOT_SPEED)
                calib_mot_bw_num_rows = calib_mot_bw_num_rows + 1
                if calib_mot_bw_num_rows == CALIB_FWBW_NUM_ROWS:
                    mot.set_speed(0, 0)
                    calib_mot_bw_time = sum(calib_mot_bw) // len(calib_mot_bw)
                    ok_mot_dist_bw = 1
                    mot.distance_calib_timer_pause()
                    calib_timeout_counter = 0
                    calib_state = 15
                    continue
                calib_mot_bw_state = 2
                #print("go to state 2 from 1 (row " + str(calib_mot_bw_num_rows) + ")")

        elif calib_mot_bw_state == 2:
            temp_rot = 0
            proxSum = 0
            diff_prox = p0.value() - p4.value()
            delta_count = delta_count + 1
            if delta_count > 10:
                delta_count = 0
                if diff_prox_prev_first == 1:
                    diff_prox_prev_first = 0
                    diff_prox_prev = diff_prox
                delta = int((diff_prox - diff_prox_prev) / 8)
                diff_prox_prev = diff_prox
            mot.set_speed(-CALIB_FWBW_MOT_SPEED + temp_rot - proxSum - delta,
                          -CALIB_FWBW_MOT_SPEED - temp_rot + proxSum + delta)
            if both_white():
                calib_mot_bw_state = 1

    elif calib_state == 15:
        mot.set_speed(0, 0)
        if fail_reason != "":
            print("fail reason = " + fail_reason)
            print("fail state = " + str(fail_state))
        if fail_reason == "":
            set_green_leds()
            print("calibration completed successfully!")
        else:
            set_red_leds()
            print("calibration failed or timed out!")

        if ok_mot_lr == 1:
            print("mot left = " + str(int(calibLeft)))
            print("mot right = " + str(int(calibRight)))
            mot.save_straight_calibration()
            print("mot L/R straight SAVED to flash")
        else:
            print("mot L/R straight NOT SAVED (calibration failed or not reached)")

        if ok_gyro == 1:
            print("imu scaling = " + str(imu_angle_diff))
            imu.save_gyro_scale_calib()
            print("imu gyro scale SAVED to flash")
        else:
            print("imu gyro scale NOT SAVED (calibration failed or not reached)")
        print("imu offsets = " + str(imu.get_gyro_calib()))
        imu.save_gyro_calib()
        print("imu gyro offsets SAVED to flash")
        imu.enable_gyro_auto_calib()

        if ok_mot_dist_fw == 1:
            print("mot forward = " + str(calib_mot_fw_time))
        if ok_mot_dist_bw == 1:
            print("mot backward = " + str(calib_mot_bw_time))
        if ok_mot_dist_fw == 1 and ok_mot_dist_bw == 1:
            mot.set_distance_calibration(calib_mot_fw_time, calib_mot_bw_time)
            mot.save_distance_calibration()
            print("mot distance fw/bw SAVED to flash")
        else:
            print("mot distance fw/bw NOT SAVED (calibration failed or not reached; fw_ok:" +
                  str(ok_mot_dist_fw) + " bw_ok:" + str(ok_mot_dist_bw) + ")")

        print("color calib = " + str(color.get_calibration()))
        if ok_color_white == 1:
            print("color white SAVED to flash (during run)")
        else:
            print("color white NOT SAVED (calibration failed or not reached)")
        if ok_color_black == 1:
            print("color black SAVED to flash (during run)")
        else:
            print("color black NOT SAVED (calibration failed or not reached)")

        if ok_ground == 1:
            print("ground black = " + str(ground_black))
            print("ground white = " + str(ground_white))
            g0.save_calibration_from_values()
            print("ground sensors SAVED to flash")
        else:
            print("ground sensors NOT SAVED (calibration failed or not reached)")

        print("calibration report end")
        break

    time.sleep(0.01)
