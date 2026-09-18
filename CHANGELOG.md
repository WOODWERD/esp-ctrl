# Changelog

## 0.9.0 — public beta

First public release.

- FLASH view: connect, read the chip (type, features, crystal, flash size and ID, MAC), write one or more
  `.bin` files at chosen offsets with a flash map, optional full erase, MD5 verify, reset into the monitor.
- MONITOR view: serial monitor with baud choice, timestamps, follow, reset, clear and a send line.
- Listen-first connecting: opening the port never restarts the board.
- Board health from serial output: running, quiet, crashing, restart loop, brownout, download mode,
  no firmware; `#alive` heartbeat support for alive / not responding.
- Auto-connect to known boards on page load and on plug-in.
- Automatic flash baud from the USB bridge chip, with step-down, retry and per-bridge memory.
- Plain-language error states for port in use, chip not responding, unplugged, interrupted or failed
  writes, failed verify, oversized images and unsupported browsers.
- Three colour themes chosen by icon: follow the computer (default), light, dark. The choice is remembered.
- A visible User guide link in the top bar, next to the theme switch.
- Fully offline-capable: no network requests, no analytics.
