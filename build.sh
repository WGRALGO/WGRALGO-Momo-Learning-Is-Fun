#!/usr/bin/env bash
# The public "The Momma Lewis Momo Learning Is FUN" (ages 2-7). Builds dist/WGRALGO-Momo-Learning-Is-Fun-<ver>.apk and
# dist/momo-learning_<ver>_all.deb from web/ (the app), android/ and linux/. Signed with the WGRALGO key in keystore/
# (keep it: every update needs the same key; copies on the 1TB disk and in ~/MomoLearningPublic-savepoints).
# Old versions in dist/ are never touched. Before a build, refresh the questions if source/ changed:
#   .venv/bin/python -I tools/build_content.py     (and tools/make_assets.py if the logo or the characters changed,
#                                                   tools/make_intro.py if the intro changed)
#   ./build.sh             APK + deb (+ a copy of both on the Desktop)
#   ./build.sh --apk-only
#   ./build.sh --test      a debuggable APK for the emulator checks: build-test/test.apk (never dist/)
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$PWD VER=1.2.0 CODE=3
TOOLS=${UPTOP_TOOLS:-$HOME/.local/share/uptop-build}
export JAVA_HOME=$TOOLS/jdk PATH=$TOOLS/jdk/bin:$PATH
BT=$TOOLS/sdk/build-tools/34.0.0 JAR=$TOOLS/sdk/platforms/android-34/android.jar
SRC=android/src/com/wgra/momolearning
MODE=${1:-}

grep -q "android:versionName=\"$VER\"" android/AndroidManifest.xml || { echo "manifest versionName != $VER"; exit 1; }
grep -q "android:versionCode=\"$CODE\"" android/AndroidManifest.xml || { echo "manifest versionCode != $CODE"; exit 1; }
grep -q "var VERSION = '$VER'" web/js/app.js || { echo "web/js/app.js VERSION != $VER"; exit 1; }
grep -q "VERSION = \"$VER\"" $SRC/MainActivity.java || { echo "MainActivity VERSION != $VER"; exit 1; }
grep -q "VERSION = '$VER'" linux/momo-learning || { echo "linux/momo-learning VERSION != $VER"; exit 1; }
[ -s web/js/voice-env.js ] && [ -s web/media/intro.mp4 ] || { echo "web/js/voice-env.js or web/media/intro.mp4 missing"; exit 1; }
[ -s web/js/content.js ] || { echo "web/js/content.js missing: run tools/build_content.py"; exit 1; }
APK=dist/WGRALGO-Momo-Learning-Is-Fun-$VER.apk DEB=dist/momo-learning_${VER}_all.deb
mkdir -p dist
if [ "$MODE" != --test ]; then
  for f in "$APK" "$DEB"; do [ -e "$f" ] && [ -z "${MOMO_REBUILD:-}" ] && { echo "$f exists: bump VER (or MOMO_REBUILD=1 to replace this same version)"; exit 1; }; done
fi
B=$ROOT/build/pkg; [ "$MODE" = --test ] && B=$ROOT/build-test
rm -rf "$B"; mkdir -p "$B"

# the app as shipped: everything in web/ except backups
copy_web() { mkdir -p "$1"; (cd web && find . -type f ! -name '*.bak*' -print0 | xargs -0 -I{} install -Dm644 {} "$1/{}"); }

# ───── Android ─────
KS=keystore/wgralgo-momo.jks PW=$(sed -n 's/^storePassword=//p' keystore/keystore.properties)
mkdir -p "$B/apk/assets" "$B/res" "$B/classes" "$B/gen"
copy_web "$B/apk/assets/web"
"$BT/aapt2" compile --dir android/res -o "$B/res/res.zip"
DEBUG=(); [ "$MODE" = --test ] && DEBUG=(--debug-mode)
# videos, voice clips and pictures stay uncompressed in the APK: the app streams them with byte ranges
"$BT/aapt2" link -o "$B/unaligned.apk" -I "$JAR" --manifest android/AndroidManifest.xml \
  -A "$B/apk/assets" --java "$B/gen" --min-sdk-version 24 --target-sdk-version 34 \
  --version-code $CODE --version-name "$VER" -0 mp4 -0 mp3 -0 jpg -0 webp -0 ttf "${DEBUG[@]}" "$B/res/res.zip"
javac -encoding UTF-8 -source 8 -target 8 -nowarn -Xlint:-options -bootclasspath "$JAR" -d "$B/classes" \
  $(find android/src "$B/gen" -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$B" $(find "$B/classes" -name '*.class')
(cd "$B" && zip -qj unaligned.apk classes.dex)
"$BT/zipalign" -f -p 4 "$B/unaligned.apk" "$B/aligned.apk"
OUT=$APK; [ "$MODE" = --test ] && OUT=$B/test.apk
"$BT/apksigner" sign --ks "$KS" --ks-key-alias wgralgo-momo --ks-pass "pass:$PW" --key-pass "pass:$PW" --out "$OUT" "$B/aligned.apk"
rm -f "$OUT.idsig"
"$BT/apksigner" verify "$OUT"
echo "APK: $OUT ($(du -h "$OUT" | cut -f1))"
if [ "$MODE" = --test ] || [ "$MODE" = --apk-only ]; then exit 0; fi

# ───── Debian / Linux Mint ─────
D=$B/deb N=momo-learning
install -Dm755 linux/$N "$D/usr/bin/$N"
copy_web "$D/usr/share/$N/web"
(cd linux/icons && find . -name '*.png' -exec install -Dm644 {} "$D/usr/share/icons/hicolor/{}" \;)
install -Dm644 linux/$N.desktop "$D/usr/share/applications/$N.desktop"
mkdir -p "$D/usr/share/doc/$N"
printf 'The Momma Lewis Momo Learning Is FUN (for ages 2-7)\nCopyright 2026 The Wealth Gap Resolution Algorithm Inc. All rights reserved.\n\nFredoka font (web/fonts/Fredoka.ttf): SIL Open Font License 1.1, see web/fonts/OFL.txt\n' > "$D/usr/share/doc/$N/copyright"
mkdir -p "$D/DEBIAN"
SIZE=$(du -sk "$D/usr" | cut -f1)
cat > "$D/DEBIAN/control" <<CTL
Package: $N
Version: $VER
Section: education
Priority: optional
Architecture: all
Depends: python3, python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.1, gstreamer1.0-plugins-base, gstreamer1.0-plugins-good, gstreamer1.0-libav | gstreamer1.0-plugins-bad
Installed-Size: $SIZE
Maintainer: WGRALGO
Description: The Momma Lewis Momo Learning Is FUN, for ages 2-7
 Momo's learning game for children ages 2 to 7. Pick one of 8
 characters and a level (Easy, Normal, Hard, Expert). Momo reads each
 question aloud while her heart glows, the child taps A, B or C, or the
 answer in the picture, the character cheers or tries again, and Momo
 explains the answer. Words, math and science, in order or mixed up.
 Works offline: no ads, no accounts, no tracking.
CTL
cat > "$D/DEBIAN/postinst" <<'PI'
#!/bin/sh
set -e
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
PI
chmod 755 "$D/DEBIAN/postinst"
dpkg-deb --root-owner-group --build "$D" "$DEB" >/dev/null
echo "DEB: $DEB ($(du -h "$DEB" | cut -f1))"
sha256sum "$APK" "$DEB"

if [ -n "${MOMO_NO_COPY:-}" ]; then echo "Desktop copy skipped (MOMO_NO_COPY)"; exit 0; fi
if [ -d "$HOME/Desktop" ]; then cp --preserve=timestamps "$APK" "$DEB" "$HOME/Desktop/" && echo "copied to ~/Desktop"; fi
