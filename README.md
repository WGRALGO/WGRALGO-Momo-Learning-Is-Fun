# The Momma Lewis Momo Learning Is FUN

**A free learning game for children ages 2 to 7.** Momo reads every question aloud while her purple heart glows with
her words. The child picks one of 8 characters and a level, then answers by tapping A, B or C, or the answer drawn in
the picture. The character cheers or tries again, and Momo explains the answer.

- **Ages 2–7.** Four levels: Easy, Normal, Hard and Expert, each marked with rising bars. Normal and Expert are coming soon.
- **Words, math and science**, in order or mixed up. A missed question comes back once at the end of the round.
- **8 characters**: a dove, an elephant, a dog, a sphinx, a cane, an ivy leaf, a duck and a lion, each with its own
  "right" and "try again" videos.
- **The child's name** can be typed (or skipped). It is shown on screen only and is never saved or sent anywhere.
- **Works offline.** No ads, no accounts, no tracking, no internet permission.

## Download

The Android app (Android 7 or newer, phones and tablets) is in [Releases](../../releases): `WGRALGO-Momo-Learning-Is-Fun-<version>.apk`.

## What is in this repository

**The code only.** The pictures, Momo's voice, the characters' videos, the logo and the question wording are **not**
included and are not licensed for any use. This repository cannot build the app without them.

| Folder | What |
| --- | --- |
| `web/` | The app itself (HTML, CSS, JavaScript): the same page runs on Android, Linux and the web |
| `web/js/momo-light.js` | Momo's heart: a canvas light that pulses with every syllable (loudness measured ahead of time) |
| `android/` | The Android shell: a full-screen WebView that serves the app from inside the APK, with byte ranges for media |
| `linux/` | The Linux desktop shell (GTK 3 + WebKit2GTK 4.1) |
| `tools/` | Build scripts: questions, assets, the intro video, the web folder |
| `tests/` | UI tests (WebKitGTK at 9 screen sizes, real playback), Android emulator checks, web folder checks |

## Credits

- **Built by** Claude Code Opus 5.5
- **Content created by** Gemini Plus Flash 3.6, Canva Pro, Grok Premium Expert 4.7, ChatGPT-6, and ElevenLabs Multilingual v2
- **Stand-in voice** (some of the newest questions, until Momo records them): Kokoro-82M (voice am_michael, Apache-2.0)
- **Font:** Fredoka (SIL Open Font License 1.1), not included here

## License

Copyright © 2026 The Wealth Gap Resolution Algorithm™ Inc. **All rights reserved.** See [LICENSE](LICENSE).
