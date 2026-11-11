#!/usr/bin/env bash
# Stops the emulator and removes the silent test sound device.
cd "$(dirname "$0")/../.."
T=${UPTOP_TOOLS:-$HOME/.local/share/uptop-build}
ADB=$T/sdk/platform-tools/adb
for d in $($ADB devices | awk 'NR>1 && /emulator/ {print $1}'); do $ADB -s "$d" emu kill >/dev/null 2>&1 || true; done
command -v pactl >/dev/null && for id in $(pactl list short modules | awk '/sink_name=momo_test/ {print $1}'); do pactl unload-module "$id" || true; done
echo "emulator stopped"
