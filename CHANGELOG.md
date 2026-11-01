# Changelog

## Site — 2026-11-01

- A GitHub button beside All tools and in the footer links to the WOODWERD page on GitHub.
- The lead screenshot no longer shows the old toolkit strip, and the README states the current version.
- The toolkit strip now reads WOODWERD Toolkit, Tools for everyday makers, and All tools lists Cable Ctrl under Print.
- All tools now lists File Ctrl under Print.

## 1.0.0 — WOODWERD Digital

First stable release. The interface is rebuilt on the WOODWERD Digital design system; nothing about
flashing or monitoring changed.

- Amber is now the brand accent, and green is status-only. Previously the mint green was doing both
  jobs at once, which stopped the green status from reading as a status.
- Connect is filled in the semantic green, and Disconnect remains a red outline that fills on hover.
- Warm cream ground in light, warm near-black in dark. Both themes defined together, as before.
- Type on exact steps of the square root of the golden ratio from a 15px body; spacing on Fibonacci
  pixels. The stylesheet is consolidated — it had accreted into layered override blocks.
- New `--accent-tint` token shades the written extent on the flash map without implying a status.
- New toolkit strip above the header: the Ctrl tools grouped by stage (build, load, run, phone), each
  with a line saying what it does. Unreleased tools are listed but not linked and marked honestly.
  It is a disclosure element and works with JavaScript disabled.
- The WOODWERD mark now signs the footer, with the Think · Design · Style line. It is deliberately not
  in the header: the product leads, the brand signs.
- The user guide is retrofitted to match.

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
