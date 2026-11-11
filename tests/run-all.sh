#!/usr/bin/env bash
# The public Momo app (ages 2-7). Every check: the questions (answer key from the quiz files, the files are there), the voice clips (Whisper, if
# Yip Yappers Pro is on this PC), the UI in WebKitGTK at 9 phone/tablet sizes + real playback, and the packaged deb.
# Android emulator checks are separate: tests/android/setup.sh phone|tablet; node tests/android/check.js phone|tablet;
# tests/android/teardown.sh
set -uo pipefail
cd "$(dirname "$0")/.."
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=${WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS:-1}
rc=0
echo "== questions"; .venv/bin/python -I tools/build_content.py --check | tail -3 || rc=1
echo "== voice clips"; if [ -x "$HOME/YipYappersPro/app/.venv/bin/python" ]; then .venv/bin/python -I tools/verify_audio.py | tail -1 || rc=1; else echo "skipped (no Whisper)"; fi
echo "== launcher selftest"; MOMO_WEB_DIR=web python3 linux/momo-learning --selftest || rc=1
echo "== UI (WebKitGTK, 9 sizes + real playback)"; python3 tests/harness.py --media > build/ui.log 2>&1 || rc=1; tail -1 build/ui.log; grep '^FAIL' build/ui.log | head
DEB=$(ls -t dist/momo-learning_*_all.deb 2>/dev/null | head -1)
if [ -n "$DEB" ]; then
  echo "== packaged deb: $DEB"; D=build/deb-check; rm -rf "$D"; mkdir -p "$D"; dpkg-deb -x "$DEB" "$D"
  MOMO_WEB_DIR=$D/usr/share/momo-learning/web python3 $D/usr/bin/momo-learning --selftest || rc=1
fi
echo; [ $rc = 0 ] && echo "ALL PASS" || echo "SOMETHING FAILED"
exit $rc
