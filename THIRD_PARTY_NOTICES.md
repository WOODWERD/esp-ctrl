# Third-party notices

ESP Ctrl itself is © 2026 WOODWERD LLC, MIT-licensed (see `LICENSE`). It distributes the following.

| Component | Licence | Where |
|---|---|---|
| [esptool-js](https://github.com/espressif/esptool-js) 0.6.1, © Espressif Systems | Apache-2.0 | bundled in `site/vendor/esptool.js` (includes its flasher stubs and the pako and atob-lite dependencies it pulls in) |
| [SparkMD5](https://github.com/satazor/js-spark-md5) 3.0.2 | MIT (dual WTFPL) | bundled in `site/vendor/esptool.js`, used to verify writes |
| [Inter](https://github.com/rsms/inter) 400/500/600 | SIL Open Font License 1.1 | `site/fonts/`, licence alongside |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) 400/500 | SIL Open Font License 1.1 | `site/fonts/`, licence alongside |

`site/vendor/esptool.js` is rebuilt with `cd build && npm install && npm run vendor`.
