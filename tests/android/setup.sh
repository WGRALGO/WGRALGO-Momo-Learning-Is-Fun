#!/usr/bin/env bash
# Android emulator testing (not part of the release): builds the debuggable test APK (build-test/, never dist/),
# boots a phone or tablet emulator with no window (its sound goes to a silent test device), installs the APK.
# Usage: tests/android/setup.sh phone|tablet     then: node tests/android/check.js phone|tablet
# Uses the phone/tablet virtual devices from the Up Top apps (uthr_phone = Pixel 6, uthr_tablet = Pixel Tablet,
# Android 14); creates them if missing. UPTOP_EMU_GPU=host|swiftshader_indirect picks the renderer (default host).
set -euo pipefail
cd "$(dirname "$0")/../.."
KIND=${1:-phone}
T=${UPTOP_TOOLS:-$HOME/.local/share/uptop-build}
export JAVA_HOME=$T/jdk PATH=$T/jdk/bin:$T/sdk/platform-tools:$PATH ANDROID_SDK_ROOT=$T/sdk ANDROID_HOME=$T/sdk ANDROID_AVD_HOME=$HOME/.android/avd
./build.sh --test >/dev/null
AVD=uthr_$KIND; DEV=$([ "$KIND" = tablet ] && echo pixel_tablet || echo pixel_6)
if ! "$T/sdk/emulator/emulator" -list-avds | grep -qx "$AVD"; then
  echo no | "$T/sdk/cmdline-tools/latest/bin/avdmanager" create avd -n "$AVD" -k "system-images;android-34;default;x86_64" -d "$DEV" >/dev/null
fi
adb kill-server >/dev/null 2>&1 || true; adb start-server >/dev/null
for d in $(adb devices | awk 'NR>1 && /emulator/ {print $1}'); do adb -s "$d" emu kill >/dev/null 2>&1 || true; done
sleep 2
# a silent sound device, so the checks can play real sound without anyone hearing it (tests/android/teardown.sh removes it)
if command -v pactl >/dev/null && ! pactl list short sinks | grep -q momo_test; then
  pactl load-module module-null-sink sink_name=momo_test sink_properties=device.description=MomoTest >/dev/null
fi
PULSE_SINK=momo_test nohup "$T/sdk/emulator/emulator" -avd "$AVD" -no-window -no-boot-anim -no-snapshot -gpu "${UPTOP_EMU_GPU:-host}" -memory 3072 >build-test/emulator.log 2>&1 &
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 2; done
sleep 25      # right after boot Android applies the wallpaper's theme colors, which relaunches any app on screen
adb shell settings put global window_animation_scale 0; adb shell settings put global transition_animation_scale 0; adb shell settings put global animator_duration_scale 0
adb install -r build-test/test.apk >/dev/null
echo "booted $AVD and installed"
