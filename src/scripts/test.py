import thymio
import time

MOVEMENT_SPEED = 400
MIC_THR = 300
LED_BRIGHTNESS = 8
TEST_STATE_DELAY = 30 # 1/50*30=600 ms (mode task run @50hz)
MAX_BRIGHTNESS = 16

mot = thymio.MOTORS()
behav = thymio.BEHAVIORS()
sound = thymio.SOUND()
rgb_fl = thymio.LEDS_RGB(0)
rgb_fr = thymio.LEDS_RGB(1)
rgb_bl = thymio.LEDS_RGB(2)
rgb_br = thymio.LEDS_RGB(3)
rgb_front = thymio.LEDS_RGB(4)
rgb_back = thymio.LEDS_RGB(5)
recv_led = thymio.LED_RECEIVER()
lf0 = thymio.LEDS_LEGO_FRONT(0)
lf1 = thymio.LEDS_LEGO_FRONT(1)
lf2 = thymio.LEDS_LEGO_FRONT(2)
lf3 = thymio.LEDS_LEGO_FRONT(3)
lf4 = thymio.LEDS_LEGO_FRONT(4)
lf5 = thymio.LEDS_LEGO_FRONT(5)
lf6 = thymio.LEDS_LEGO_FRONT(6)
lf7 = thymio.LEDS_LEGO_FRONT(7)
lb0 = thymio.LEDS_LEGO_BACK(0)
lb1 = thymio.LEDS_LEGO_BACK(1)
lb2 = thymio.LEDS_LEGO_BACK(2)
lb3 = thymio.LEDS_LEGO_BACK(3)
lb4 = thymio.LEDS_LEGO_BACK(4)
lb5 = thymio.LEDS_LEGO_BACK(5)
lb6 = thymio.LEDS_LEGO_BACK(6)
lb7 = thymio.LEDS_LEGO_BACK(7)
lb0 = thymio.LEDS_LEGO_BACK(0)
lb1 = thymio.LEDS_LEGO_BACK(1)
lb2 = thymio.LEDS_LEGO_BACK(2)
lb3 = thymio.LEDS_LEGO_BACK(3)
lb4 = thymio.LEDS_LEGO_BACK(4)
lb5 = thymio.LEDS_LEGO_BACK(5)
lb6 = thymio.LEDS_LEGO_BACK(6)
lb7 = thymio.LEDS_LEGO_BACK(7)
lc0 = thymio.LEDS_CIRCLE(0)
lc1 = thymio.LEDS_CIRCLE(1)
lc2 = thymio.LEDS_CIRCLE(2)
lc3 = thymio.LEDS_CIRCLE(3)
lc4 = thymio.LEDS_CIRCLE(4)
lc5 = thymio.LEDS_CIRCLE(5)
lc6 = thymio.LEDS_CIRCLE(6)
lc7 = thymio.LEDS_CIRCLE(7)
lbtn0 = thymio.LEDS_BUTTONS(0)
lbtn1 = thymio.LEDS_BUTTONS(1)
lbtn2 = thymio.LEDS_BUTTONS(2)
lbtn3 = thymio.LEDS_BUTTONS(3)
col_led = thymio.LED_COLOR()
imu = thymio.IMU()
rc5 = thymio.RC5()
btn = thymio.BUTTONS()
color = thymio.COLOR_SENSOR()

play_trials = 0
while 1:
    if play_trials == 5:
        break
    try:
        sound.play_onboard(0) # alarm sound
    except Exception as e: # when the upload is done, the robot emit a sound and if this script is executed just after upload then that sound can be still playing
        time.sleep(0.5)
        play_trials = play_trials + 1
        continue
behav.disable_behaviors()
behav.disable_leds_proximity()
behav.disable_led_microphone()
behav.disable_leds_battery()
behav.enable_leds_test()
behav.set_led_mic_threshold(MIC_THR)
col_led.intensity(0)

stmTestRunning = 1
delayCounter = 0
delayCounter2 = 0
testState = 0

while 1:
    time.sleep(0.02) # 50 Hz

    if(stmTestRunning == 1):
        behav.enable_leds_test()
        behav.set_led_mic_threshold(MIC_THR)
        delayCounter = delayCounter + 1
        if(delayCounter == 450): # Wait for the STM terminates its test after about 9 seconds (14 states using 600 ms delay and some spare time).
            delayCounter = 0
            stmTestRunning = 0
            behav.disable_leds_test()
            behav.enable_leds_proximity()
            behav.enable_led_microphone()
            behav.enable_leds_battery()
        continue


    if testState != 63:
        delayCounter2 = delayCounter2 + 1
        if(delayCounter2 == 100): # 100 ticks = 2 sec (mode task run @50hz)
            mot.set_speed(MOVEMENT_SPEED, MOVEMENT_SPEED)
        if(delayCounter2 == 200): # 200 ticks = 4 sec (mode task run @50hz)
            delayCounter2 = 0
            mot.set_speed(-MOVEMENT_SPEED, -MOVEMENT_SPEED)
    else:
        mot.set_speed(0, 0)

    if testState == 0:
        rgb_back.set_intensity(LED_BRIGHTNESS, 0, 0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 1:
        rgb_back.set_intensity(0, LED_BRIGHTNESS, 0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 2:
        rgb_back.set_intensity(0, 0, LED_BRIGHTNESS)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            rgb_back.set_intensity(0, 0, 0)
            testState = testState + 1

    elif testState == 3:
        rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 4:
        rgb_bl.set_intensity(0, LED_BRIGHTNESS, 0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 5:
        rgb_bl.set_intensity(0, 0, LED_BRIGHTNESS)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            rgb_bl.set_intensity(0, 0, 0)
            testState = testState + 1

    elif testState == 6:
        rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 7:
        rgb_br.set_intensity(0, LED_BRIGHTNESS, 0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 8:
        rgb_br.set_intensity(0, 0, LED_BRIGHTNESS)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            rgb_br.set_intensity(0, 0, 0)
            testState = testState + 1

    elif testState == 9:
        rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 10:
        rgb_fr.set_intensity(0, LED_BRIGHTNESS, 0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 11:
        rgb_fr.set_intensity(0, 0, LED_BRIGHTNESS)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            rgb_fr.set_intensity(0, 0, 0)
            testState = testState + 1

    elif testState == 12:
        rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 13:
        rgb_fl.set_intensity(0, LED_BRIGHTNESS, 0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 14:
        rgb_fl.set_intensity(0, 0, LED_BRIGHTNESS)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            rgb_fl.set_intensity(0, 0, 0)
            testState = testState + 1

    elif testState == 15:
        recv_led.intensity(MAX_BRIGHTNESS)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            recv_led.intensity(0)
            #testState = testState + 1
            testState = 17;

    # elif testState == 16: # Mic led (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break; 

    elif testState == 17:
        lb0.intensity(LED_BRIGHTNESS)
        lb1.intensity(0)
        lb2.intensity(0)
        lb3.intensity(0)
        lb4.intensity(0)
        lb5.intensity(0)
        lb6.intensity(0)
        lb7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 18:
        lb0.intensity(0)
        lb1.intensity(LED_BRIGHTNESS)
        lb2.intensity(0)
        lb3.intensity(0)
        lb4.intensity(0)
        lb5.intensity(0)
        lb6.intensity(0)
        lb7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 19:
        lb0.intensity(0)
        lb1.intensity(0)
        lb2.intensity(LED_BRIGHTNESS)
        lb3.intensity(0)
        lb4.intensity(0)
        lb5.intensity(0)
        lb6.intensity(0)
        lb7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1
 
    elif testState == 20:
        lb0.intensity(0)
        lb1.intensity(0)
        lb2.intensity(0)
        lb3.intensity(LED_BRIGHTNESS)
        lb4.intensity(0)
        lb5.intensity(0)
        lb6.intensity(0)
        lb7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 21:
        lb0.intensity(0)
        lb1.intensity(0)
        lb2.intensity(0)
        lb3.intensity(0)
        lb4.intensity(LED_BRIGHTNESS)
        lb5.intensity(0)
        lb6.intensity(0)
        lb7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 22:
        lb0.intensity(0)
        lb1.intensity(0)
        lb2.intensity(0)
        lb3.intensity(0)
        lb4.intensity(0)
        lb5.intensity(LED_BRIGHTNESS)
        lb6.intensity(0)
        lb7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1
    
    elif testState == 23:
        lb0.intensity(0)
        lb1.intensity(0)
        lb2.intensity(0)
        lb3.intensity(0)
        lb4.intensity(0)
        lb5.intensity(0)
        lb6.intensity(LED_BRIGHTNESS)
        lb7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 24:
        lb0.intensity(0)
        lb1.intensity(0)
        lb2.intensity(0)
        lb3.intensity(0)
        lb4.intensity(0)
        lb5.intensity(0)
        lb6.intensity(0)
        lb7.intensity(LED_BRIGHTNESS)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            lb7.intensity(0)
            testState = testState + 1

    elif testState == 25:
        lf0.intensity(LED_BRIGHTNESS)
        lf1.intensity(0)
        lf2.intensity(0)
        lf3.intensity(0)
        lf4.intensity(0)
        lf5.intensity(0)
        lf6.intensity(0)
        lf7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 26:
        lf0.intensity(0)
        lf1.intensity(LED_BRIGHTNESS)
        lf2.intensity(0)
        lf3.intensity(0)
        lf4.intensity(0)
        lf5.intensity(0)
        lf6.intensity(0)
        lf7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 27:
        lf0.intensity(0)
        lf1.intensity(0)
        lf2.intensity(LED_BRIGHTNESS)
        lf3.intensity(0)
        lf4.intensity(0)
        lf5.intensity(0)
        lf6.intensity(0)
        lf7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 28:
        lf0.intensity(0)
        lf1.intensity(0)
        lf2.intensity(0)
        lf3.intensity(LED_BRIGHTNESS)
        lf4.intensity(0)
        lf5.intensity(0)
        lf6.intensity(0)
        lf7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1      

    elif testState == 29:
        lf0.intensity(0)
        lf1.intensity(0)
        lf2.intensity(0)
        lf3.intensity(0)
        lf4.intensity(LED_BRIGHTNESS)
        lf5.intensity(0)
        lf6.intensity(0)
        lf7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1             

    elif testState == 30:
        lf0.intensity(0)
        lf1.intensity(0)
        lf2.intensity(0)
        lf3.intensity(0)
        lf4.intensity(0)
        lf5.intensity(LED_BRIGHTNESS)
        lf6.intensity(0)
        lf7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1    

    elif testState == 31:
        lf0.intensity(0)
        lf1.intensity(0)
        lf2.intensity(0)
        lf3.intensity(0)
        lf4.intensity(0)
        lf5.intensity(0)
        lf6.intensity(LED_BRIGHTNESS)
        lf7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1           

    elif testState == 32:
        lf0.intensity(0)
        lf1.intensity(0)
        lf2.intensity(0)
        lf3.intensity(0)
        lf4.intensity(0)
        lf5.intensity(0)
        lf6.intensity(0)
        lf7.intensity(LED_BRIGHTNESS)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            lf7.intensity(0)
            testState = testState + 1  

    elif testState == 33:
        lc0.intensity(LED_BRIGHTNESS)
        lc1.intensity(0)
        lc2.intensity(0)
        lc3.intensity(0)
        lc4.intensity(0)
        lc5.intensity(0)
        lc6.intensity(0)
        lc7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1 

    elif testState == 34:
        lc0.intensity(0)
        lc1.intensity(LED_BRIGHTNESS)
        lc2.intensity(0)
        lc3.intensity(0)
        lc4.intensity(0)
        lc5.intensity(0)
        lc6.intensity(0)
        lc7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1 

    elif testState == 35:
        lc0.intensity(0)
        lc1.intensity(0)
        lc2.intensity(LED_BRIGHTNESS)
        lc3.intensity(0)
        lc4.intensity(0)
        lc5.intensity(0)
        lc6.intensity(0)
        lc7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1    

    elif testState == 36:
        lc0.intensity(0)
        lc1.intensity(0)
        lc2.intensity(0)
        lc3.intensity(LED_BRIGHTNESS)
        lc4.intensity(0)
        lc5.intensity(0)
        lc6.intensity(0)
        lc7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1        

    elif testState == 37:
        lc0.intensity(0)
        lc1.intensity(0)
        lc2.intensity(0)
        lc3.intensity(0)
        lc4.intensity(LED_BRIGHTNESS)
        lc5.intensity(0)
        lc6.intensity(0)
        lc7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1             

    elif testState == 38:
        lc0.intensity(0)
        lc1.intensity(0)
        lc2.intensity(0)
        lc3.intensity(0)
        lc4.intensity(0)
        lc5.intensity(LED_BRIGHTNESS)
        lc6.intensity(0)
        lc7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 39:
        lc0.intensity(0)
        lc1.intensity(0)
        lc2.intensity(0)
        lc3.intensity(0)
        lc4.intensity(0)
        lc5.intensity(0)
        lc6.intensity(LED_BRIGHTNESS)
        lc7.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1       

    elif testState == 40:
        lc0.intensity(0)
        lc1.intensity(0)
        lc2.intensity(0)
        lc3.intensity(0)
        lc4.intensity(0)
        lc5.intensity(0)
        lc6.intensity(0)
        lc7.intensity(LED_BRIGHTNESS)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            lc7.intensity(0)
            testState = testState + 1     

    elif testState == 41:
        lbtn0.intensity(LED_BRIGHTNESS)
        lbtn1.intensity(0)
        lbtn2.intensity(0)
        lbtn3.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1 

    elif testState == 42:
        lbtn0.intensity(0)
        lbtn1.intensity(LED_BRIGHTNESS)
        lbtn2.intensity(0)
        lbtn3.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 43:
        lbtn0.intensity(0)
        lbtn1.intensity(0)
        lbtn2.intensity(LED_BRIGHTNESS)
        lbtn3.intensity(0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 44:
        lbtn0.intensity(0)
        lbtn1.intensity(0)
        lbtn2.intensity(0)
        lbtn3.intensity(LED_BRIGHTNESS)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            lbtn3.intensity(0)
            #testState = testState + 1    
            testState = 52             

    # case 45: // front left (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break;       

    # case 46: // front left-center (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break;   

    # case 47: // front center (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break;     

    # case 48: // front right-center (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break;               

    # case 49: // front right (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break;         

    # case 50: // ground left (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break;  

    # case 51: // ground right (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break; 

    elif testState == 52:
        rgb_front.set_intensity(MAX_BRIGHTNESS, 0, 0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1

    elif testState == 53:
        rgb_front.set_intensity(0, MAX_BRIGHTNESS, 0)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            testState = testState + 1   

    elif testState == 54:
        rgb_front.set_intensity(0, 0, MAX_BRIGHTNESS)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            rgb_front.set_intensity(0, 0, 0)
            testState = testState + 1  
 
    elif testState == 55:
        col_led.intensity(MAX_BRIGHTNESS)
        delayCounter = delayCounter + 1
        if(delayCounter == TEST_STATE_DELAY):
            delayCounter = 0
            col_led.intensity(0)
            #testState = testState + 1
            testState = 62                           

    # case 56: // prox back left (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break; 

    # case 57: // led battery left (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break;       

    # case 58: // led battery center (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break;  

    # case 59: // led battery right (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break;     

    # case 60: // prox back right (STM)
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     //testState++;
    #     testState = 62;
    #   }
    #   break; 

    # case 61:
    #   Codec_PlayMP3FileFromFlash(E_SoundIndex_Bye);
    #   delayCounter++;
    #   if(delayCounter == TEST_STATE_DELAY) {
    #     delayCounter = 0;
    #     testState++;
    #   }
    #   break;       

    elif testState == 62: # Turn on all leds
        behav.disable_leds_button()
        rgb_back.set_intensity(LED_BRIGHTNESS, LED_BRIGHTNESS, LED_BRIGHTNESS)
        if color.get_raw() == [0, 0, 0, 0]: # color sensor read problem
            rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_br.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fr.set_intensity(LED_BRIGHTNESS, 0, 0)
            rgb_fl.set_intensity(LED_BRIGHTNESS, 0, 0)            
        else:
            rgb_bl.set_intensity(LED_BRIGHTNESS, LED_BRIGHTNESS, LED_BRIGHTNESS)
            rgb_br.set_intensity(LED_BRIGHTNESS, LED_BRIGHTNESS, LED_BRIGHTNESS)
            rgb_fr.set_intensity(LED_BRIGHTNESS, LED_BRIGHTNESS, LED_BRIGHTNESS)
            rgb_fl.set_intensity(LED_BRIGHTNESS, LED_BRIGHTNESS, LED_BRIGHTNESS)
        recv_led.intensity(MAX_BRIGHTNESS)
        if(imu.get_acc() == [0, 0, 0]): # imu read problem
            lb0.intensity(LED_BRIGHTNESS)
            lb1.intensity(0)
            lb2.intensity(LED_BRIGHTNESS)
            lb3.intensity(0)
            lb4.intensity(LED_BRIGHTNESS)
            lb5.intensity(0)
            lb6.intensity(LED_BRIGHTNESS)
            lb7.intensity(0)
            lf0.intensity(LED_BRIGHTNESS)
            lf1.intensity(0)
            lf2.intensity(LED_BRIGHTNESS)
            lf3.intensity(0)
            lf4.intensity(LED_BRIGHTNESS)
            lf5.intensity(0)
            lf6.intensity(LED_BRIGHTNESS)
            lf7.intensity(0)
        else:
            lb0.intensity(LED_BRIGHTNESS)
            lb1.intensity(LED_BRIGHTNESS)
            lb2.intensity(LED_BRIGHTNESS)
            lb3.intensity(LED_BRIGHTNESS)
            lb4.intensity(LED_BRIGHTNESS)
            lb5.intensity(LED_BRIGHTNESS)
            lb6.intensity(LED_BRIGHTNESS)
            lb7.intensity(LED_BRIGHTNESS)
            lf0.intensity(LED_BRIGHTNESS)
            lf1.intensity(LED_BRIGHTNESS)
            lf2.intensity(LED_BRIGHTNESS)
            lf3.intensity(LED_BRIGHTNESS)
            lf4.intensity(LED_BRIGHTNESS)
            lf5.intensity(LED_BRIGHTNESS)
            lf6.intensity(LED_BRIGHTNESS)
            lf7.intensity(LED_BRIGHTNESS)
        lc0.intensity(LED_BRIGHTNESS)
        lc1.intensity(LED_BRIGHTNESS)
        lc2.intensity(LED_BRIGHTNESS)
        lc3.intensity(LED_BRIGHTNESS)
        lc4.intensity(LED_BRIGHTNESS)
        lc5.intensity(LED_BRIGHTNESS)
        lc6.intensity(LED_BRIGHTNESS)
        lc7.intensity(LED_BRIGHTNESS)        
        lbtn0.intensity(LED_BRIGHTNESS)
        lbtn1.intensity(LED_BRIGHTNESS)
        lbtn2.intensity(LED_BRIGHTNESS)
        lbtn3.intensity(LED_BRIGHTNESS)
        rgb_front.set_intensity(MAX_BRIGHTNESS, MAX_BRIGHTNESS, MAX_BRIGHTNESS)
        col_led.intensity(MAX_BRIGHTNESS)

        imu.clear_tap_event()
        
        testState = testState + 1

    elif testState == 63: # wait sensors check
        toggle = rc5.get_command()
        if(toggle != -1): # something received
            recv_led.intensity(toggle*MAX_BRIGHTNESS)
            
        if(imu.tap_detected()):
            lb0.intensity(0)
            lb1.intensity(0)
            lb2.intensity(0)
            lb3.intensity(0)
            lb4.intensity(0)
            lb5.intensity(0)
            lb6.intensity(0)
            lb7.intensity(0)
            lf0.intensity(0)
            lf1.intensity(0)
            lf2.intensity(0)
            lf3.intensity(0)
            lf4.intensity(0)
            lf5.intensity(0)
            lf6.intensity(0)
            lf7.intensity(0)

        buttonState = btn.get_status()

        if(buttonState[3] == 1): # forward
            lbtn0.intensity(0)

        if(buttonState[4] == 1): # right
            lbtn1.intensity(0)

        if(buttonState[0] == 1): # backward
            lbtn2.intensity(0)

        if(buttonState[1] == 1): # left
            lbtn3.intensity(0)

        if(buttonState[2] == 1): # center
            lc0.intensity(0)
            lc1.intensity(0)
            lc2.intensity(0)
            lc3.intensity(0)
            lc4.intensity(0)
            lc5.intensity(0)
            lc6.intensity(0)
            lc7.intensity(0)                                                               


        # hue, saturation, value = color.get_hsv()
        # if (saturation >= 12) and (value > 20):
        #     if ((hue >= 0) and (hue <= 57)) or ((hue > 300) and (hue <= 360)): # red
        #         rgb_bl.set_intensity(LED_BRIGHTNESS, 0, 0)

        #     elif (hue <= 160): # green
        #         rgb_br.set_intensity(0, LED_BRIGHTNESS, 0)

        #     elif (hue <= 300): # blue
        #         rgb_fr.set_intensity(0, 0, LED_BRIGHTNESS)

