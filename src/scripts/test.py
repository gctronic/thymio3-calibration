import thymio
import time

# Test mode, replaced by the web application before upload.
# Valid values: full | main | low | touch
MODE = "__TEST_MODE__"

MOVEMENT_SPEED = 400
MIC_THR = 300
LED_BRIGHTNESS = 8
TEST_STATE_DELAY = 30  # 1/50*30 = 600 ms (mode task runs @50Hz)
MAX_BRIGHTNESS = 16
STM_TEST_TICKS = 450   # STM32 self test takes about 9 s

mot = thymio.MOTORS()
behav = thymio.BEHAVIORS()
sound = thymio.SOUND()
rgb_fl = thymio.LEDS_RGB(0)
rgb_fr = thymio.LEDS_RGB(1)
rgb_bl = thymio.LEDS_RGB(2)
rgb_br = thymio.LEDS_RGB(3)
rgb_front = thymio.LEDS_RGB(4)   # bottom RGB LED
rgb_back = thymio.LEDS_RGB(5)    # small back RGB LED
recv_led = thymio.LED_RECEIVER()
col_led = thymio.LED_COLOR()     # bottom white LED
imu = thymio.IMU()
rc5 = thymio.RC5()
btn = thymio.BUTTONS()
color = thymio.COLOR_SENSOR()

leds_lego_front = [thymio.LEDS_LEGO_FRONT(i) for i in range(8)]
leds_lego_back = [thymio.LEDS_LEGO_BACK(i) for i in range(8)]
leds_circle = [thymio.LEDS_CIRCLE(i) for i in range(8)]
leds_buttons = [thymio.LEDS_BUTTONS(i) for i in range(4)]

rgb_big = [rgb_bl, rgb_br, rgb_fr, rgb_fl]

motors_enabled = False
motor_counter = 0


# ==========================================
# HELPERS
# ==========================================

def tick(count):
    """Wait for `count` ticks at 50 Hz, driving the motor alternation meanwhile.

    This replaces the original cooperative state machine: the LED sequence is
    written linearly while the motors keep their 2 s forward / 2 s backward
    cycle, exactly as in the original delayCounter2 branch.
    """
    global motor_counter

    for _ in range(count):
        time.sleep(0.02)

        if not motors_enabled:
            continue

        motor_counter = motor_counter + 1
        if motor_counter == 100:    # 100 ticks = 2 s
            mot.set_speed(MOVEMENT_SPEED, MOVEMENT_SPEED)
        elif motor_counter >= 200:  # 200 ticks = 4 s
            motor_counter = 0
            mot.set_speed(-MOVEMENT_SPEED, -MOVEMENT_SPEED)


def start_motors():
    global motors_enabled, motor_counter
    motors_enabled = True
    motor_counter = 0


def stop_motors():
    global motors_enabled
    motors_enabled = False
    mot.set_speed(0, 0)


def play_startup_sound():
    """Step 5: speaker check. Retries because the upload sound may still play."""
    for _ in range(5):
        try:
            sound.play_onboard(0)  # alarm sound
            return
        except Exception:
            time.sleep(0.5)


def chase(leds, brightness):
    """Light the LEDs of a group one by one, then turn the last one off."""
    for i in range(len(leds)):
        for j in range(len(leds)):
            if j == i:
                leds[j].intensity(brightness)
            else:
                leds[j].intensity(0)
        tick(TEST_STATE_DELAY)
    leds[len(leds) - 1].intensity(0)


def rgb_cycle(led, level):
    """Light a RGB LED red, then green, then blue, then turn it off."""
    led.set_intensity(level, 0, 0)
    tick(TEST_STATE_DELAY)
    led.set_intensity(0, level, 0)
    tick(TEST_STATE_DELAY)
    led.set_intensity(0, 0, level)
    tick(TEST_STATE_DELAY)
    led.set_intensity(0, 0, 0)


def set_group(leds, brightness):
    for led in leds:
        led.intensity(brightness)


def set_alternated(leds, brightness):
    """Light every other LED: used to signal a faulty IMU."""
    for i in range(len(leds)):
        if i % 2 == 0:
            leds[i].intensity(brightness)
        else:
            leds[i].intensity(0)


def color_sensor_ok():
    return color.get_raw() != [0, 0, 0, 0]


def imu_ok():
    return imu.get_acc() != [0, 0, 0]


# ==========================================
# TEST SECTIONS
# ==========================================

def test_stm_leds():
    """Step 6, STM32 part: front/back proximity, ground, battery and mic LEDs."""
    print("step 6: STM LEDs")
    behav.disable_leds_test()
    tick(10)
    behav.enable_leds_test()
    behav.set_led_mic_threshold(MIC_THR)
    tick(STM_TEST_TICKS)
    behav.disable_leds_test()


def test_main_leds():
    """Step 6, ESP32 part except the two bottom LEDs."""
    print("step 6: back RGB, big RGBs, receiver, lego, circle, buttons")
    rgb_cycle(rgb_back, LED_BRIGHTNESS)

    for led in rgb_big:
        rgb_cycle(led, LED_BRIGHTNESS)

    recv_led.intensity(MAX_BRIGHTNESS)
    tick(TEST_STATE_DELAY)
    recv_led.intensity(0)

    chase(leds_lego_back, LED_BRIGHTNESS)
    chase(leds_lego_front, LED_BRIGHTNESS)
    chase(leds_circle, LED_BRIGHTNESS)
    chase(leds_buttons, LED_BRIGHTNESS)


def test_low_leds():
    """Step 6, bottom LEDs only: bottom RGB LED and bottom white LED."""
    print("step 6: bottom RGB and bottom white LEDs")
    rgb_cycle(rgb_front, MAX_BRIGHTNESS)

    col_led.intensity(MAX_BRIGHTNESS)
    tick(TEST_STATE_DELAY)
    col_led.intensity(0)


def all_main_leds_on():
    """Turn on every upper LED at once, encoding the IMU status in the rows."""
    print("all LEDs on")
    behav.disable_leds_button()

    rgb_back.set_intensity(LED_BRIGHTNESS, LED_BRIGHTNESS, LED_BRIGHTNESS)
    for led in rgb_big:
        led.set_intensity(LED_BRIGHTNESS, LED_BRIGHTNESS, LED_BRIGHTNESS)
    recv_led.intensity(MAX_BRIGHTNESS)

    # Step 9: if the IMU does not answer, only half of the row LEDs are lit
    if imu_ok():
        set_group(leds_lego_back, LED_BRIGHTNESS)
        set_group(leds_lego_front, LED_BRIGHTNESS)
    else:
        print("IMU not responding")
        set_alternated(leds_lego_back, LED_BRIGHTNESS)
        set_alternated(leds_lego_front, LED_BRIGHTNESS)

    set_group(leds_circle, LED_BRIGHTNESS)
    set_group(leds_buttons, LED_BRIGHTNESS)

    imu.clear_tap_event()


last_color_status = None


def show_color_sensor_status():
    """Step 15: the 4 big RGB LEDs turn white if the color sensor answers."""
    global last_color_status

    ok = color_sensor_ok()

    if ok:
        level = LED_BRIGHTNESS
        for led in rgb_big:
            led.set_intensity(level, level, level)
    else:
        for led in rgb_big:
            led.set_intensity(LED_BRIGHTNESS, 0, 0)

    # Print only on change, the monitor loop calls this repeatedly
    if ok != last_color_status:
        last_color_status = ok
        if ok:
            print("color sensor: ok")
        else:
            print("color sensor: no answer")


# ==========================================
# MONITOR LOOPS
# ==========================================

def monitor_main():
    """Steps 9, 10, 11, 12, 14: IMU tap, TV remote, mic, proximity, charge."""
    print("manual test: tap the robot, send TV remote, clap, approach sensors")
    while 1:
        time.sleep(0.02)

        toggle = rc5.get_command()
        if toggle != -1:  # something received
            recv_led.intensity(toggle * MAX_BRIGHTNESS)

        if imu.tap_detected():
            set_group(leds_lego_back, 0)
            set_group(leds_lego_front, 0)


def monitor_touch():
    """Step 13: press all 5 buttons, the related LEDs turn off."""
    print("manual test: press left, right, forward, backward, center")
    while 1:
        time.sleep(0.02)

        button_state = btn.get_status()

        if button_state[3] == 1:  # forward
            leds_buttons[0].intensity(0)
        if button_state[4] == 1:  # right
            leds_buttons[1].intensity(0)
        if button_state[0] == 1:  # backward
            leds_buttons[2].intensity(0)
        if button_state[1] == 1:  # left
            leds_buttons[3].intensity(0)
        if button_state[2] == 1:  # center
            set_group(leds_circle, 0)


def monitor_low():
    """Steps 15 and 16: color sensor and ground sensors."""
    print("manual test: to test the ground sensors, install the black cover")
    while 1:
        time.sleep(0.5)
        show_color_sensor_status()


def monitor_full():
    """Original combined manual test: TV remote, IMU tap and touch buttons."""
    print("manual test: tap, TV remote, clap, proximity, buttons")
    while 1:
        time.sleep(0.02)

        toggle = rc5.get_command()
        if toggle != -1:
            recv_led.intensity(toggle * MAX_BRIGHTNESS)

        if imu.tap_detected():
            set_group(leds_lego_back, 0)
            set_group(leds_lego_front, 0)

        button_state = btn.get_status()

        if button_state[3] == 1:  # forward
            leds_buttons[0].intensity(0)
        if button_state[4] == 1:  # right
            leds_buttons[1].intensity(0)
        if button_state[0] == 1:  # backward
            leds_buttons[2].intensity(0)
        if button_state[1] == 1:  # left
            leds_buttons[3].intensity(0)
        if button_state[2] == 1:  # center
            set_group(leds_circle, 0)


# ==========================================
# MODES
# ==========================================

def enable_sensor_behaviors():
    """Steps 8, 11, 12: battery, microphone and proximity LED behaviors."""
    behav.enable_leds_proximity()
    behav.enable_led_microphone()
    behav.enable_leds_battery()
    behav.set_led_mic_threshold(MIC_THR)


def run_full():
    play_startup_sound()
    test_stm_leds()
    enable_sensor_behaviors()
    start_motors()
    test_main_leds()
    test_low_leds()
    stop_motors()
    all_main_leds_on()
    rgb_front.set_intensity(MAX_BRIGHTNESS, MAX_BRIGHTNESS, MAX_BRIGHTNESS)
    col_led.intensity(MAX_BRIGHTNESS)
    show_color_sensor_status()
    monitor_full()


def run_main():
    play_startup_sound()
    test_stm_leds()
    enable_sensor_behaviors()
    start_motors()
    test_main_leds()
    stop_motors()
    all_main_leds_on()
    monitor_main()


def run_low():
    behav.enable_leds_proximity()  # step 16: ground sensor LEDs
    test_low_leds()
    rgb_front.set_intensity(MAX_BRIGHTNESS, MAX_BRIGHTNESS, MAX_BRIGHTNESS)
    col_led.intensity(MAX_BRIGHTNESS)
    monitor_low()


def run_touch():
    behav.disable_leds_button()
    set_group(leds_buttons, LED_BRIGHTNESS)
    set_group(leds_circle, LED_BRIGHTNESS)
    monitor_touch()


# ==========================================
# ENTRY POINT
# ==========================================

print("test mode: " + MODE)

behav.disable_behaviors()
behav.disable_leds_test()
behav.disable_leds_proximity()
behav.disable_led_microphone()
behav.disable_leds_battery()
behav.set_led_mic_threshold(MIC_THR)
col_led.intensity(0)
set_group(leds_buttons, 0)

if MODE == "main":
    run_main()
elif MODE == "low":
    run_low()
elif MODE == "touch":
    run_touch()
else:
    run_full()
