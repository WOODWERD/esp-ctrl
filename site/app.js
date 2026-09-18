// ESP Ctrl: flash and monitor ESP boards from the browser, built on esptool-js. (c) 2026 WOODWERD LLC, MIT licence.
import { ESPLoader, Transport, md5 } from "./vendor/esptool.js";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// USB bridge chips we can recognise before the port is opened. baud = fastest rate we trust by default.
const BRIDGES = {
  "1a86:7523": { name: "WCH CH340", baud: 460800 }, // verified: 921600 drops bytes on CYD boards
  "1a86:55d4": { name: "WCH CH9102", baud: 921600 },
  "10c4:ea60": { name: "Silicon Labs CP210x", baud: 921600 },
  "0403:6001": { name: "FTDI FT232", baud: 921600 },
  "0403:6015": { name: "FTDI FT231X", baud: 921600 },
  "303a:1001": { name: "Espressif USB-Serial-JTAG", baud: 921600 },
};
const RATES = [921600, 460800, 230400, 115200];
const DEFAULT_BAUD = 460800;

const store = {   // "flashctrl." is the pre-rename prefix; old settings are still read
  get(k) { try { return localStorage.getItem("espctrl." + k) ?? localStorage.getItem("flashctrl." + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("espctrl." + k, v); } catch { /* storage unavailable */ } },
};

// ---------- state ----------
let port = null, transport = null, loader = null;
let mode = "idle";            // idle | loader | monitor
let busy = false, connecting = false, autoConn = false, lost = false;
let bridgeKey = "", flashBytes = 0x400000, chipName = "";
let view = "flash", boardKnown = false;
let segs = [];                // { off, file }
let ov = {};                  // header state overrides while an error is showing
let monReader = null, monStop = false, lineBuf = "", lineTimer = 0, termBuf = "";
const t0 = Date.now();
const hex = (n) => "0x" + n.toString(16).toUpperCase().padStart(6, "0");
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : Math.round(n / 1024) + " kB");

// ---------- log ----------
function log(text, cls) {
  const el = $("log"), line = document.createElement("div");
  if ($("optTs").checked) {
    const s = document.createElement("span"); s.className = "t";
    s.textContent = ((Date.now() - t0) / 1000).toFixed(3).padStart(8, " ") + "  "; line.appendChild(s);
  }
  const b = document.createElement("span"); if (cls) b.className = cls; b.textContent = text; line.appendChild(b);
  el.appendChild(line);
  while (el.childElementCount > 3000) el.firstElementChild.remove();
  if ($("optScroll").checked) el.scrollTop = el.scrollHeight;
}
const terminal = {
  clean() {},
  write(d) { termBuf += d; },
  writeLine(d) { const t = termBuf + d; termBuf = ""; if (t.trim()) log(t); },
};

// ---------- small UI helpers ----------
function led(id, state, blink) { $(id).className = "led" + (state ? " on-" + state : "") + (blink ? " blink" : ""); }
function alertIn(t, title, msg) {
  const e = $("alert" + t); e.textContent = "";
  const b = document.createElement("b"); b.textContent = title;
  const m = document.createElement("span"); m.textContent = msg;
  e.append(b, m); e.hidden = false;
}
function clearAlerts() { ov = {}; ["t1", "t2"].forEach((t) => { $("alert" + t).hidden = true; }); }
function failConn(state, title, msg) { ov.t1 = state; alertIn("t1", title, msg); sync(); }
function failWrite(title, msg) {
  $("sStage").textContent = "Failed"; led("ledBusy", "fault"); ov.t2 = title; alertIn("t2", title, msg); sync();
}

function sync() {
  const connected = mode !== "idle";
  $("btnWrite").disabled = busy || !segs.length || !port || !connected || !segsValid();
  $("btnReset").disabled = busy || !connected;
  $("send").disabled = $("btnSend").disabled = busy || mode !== "monitor";
  $("btnConnect").disabled = busy || !("serial" in navigator);
  $("btnConnect").textContent = connected ? "Disconnect" : "Connect";
  $("btnConnect").classList.toggle("connect", !connected); $("btnConnect").classList.toggle("stop", connected);
  const hk = mode === "monitor" && health ? health.kind : null;
  const hLabel = { alive: "Board alive", hung: "Not responding", ok: "Board running", crash: "Board crashing", loop: "Restart loop", brownout: "Power problem", download: "Download mode", empty: "No firmware", quiet: "Connected · quiet" }[hk];
  $("t1State").textContent = connected ? (hLabel || (autoConn ? "Auto-connected" : "Connected")) : connecting ? "Connecting" : "Not connected";
  $("t2State").textContent = !segs.length ? "No image loaded" : !connected ? "Waiting for a connection" : busy ? "Working" : "Ready to write";
  $("btnRead").hidden = !(mode === "monitor" && !boardKnown && view === "flash"); $("btnRead").disabled = busy;
  if (mode === "monitor" && !boardKnown) { $("matchChip").className = "chip none"; $("matchChip").textContent = "Not read yet"; $("matchText").textContent = "Listening only. Reading the chip restarts the board; Write flash does it for you."; }
  $("t3State").textContent = mode === "monitor" ? "Listening at " + $("monBaud").value : mode === "loader" ? "Paused · chip is in its bootloader" : "Idle";
  // header status colour: ok = green, warn = orange (needs you), busy = orange pulsing, idle = grey, bad = red (errors only)
  const tone = {
    t1: connected ? (hk && HEALTH[hk][0] !== "idle" ? HEALTH[hk][0] : "ok") : connecting ? "busy" : "warn",
    t2: !connected ? "idle" : !segs.length ? "warn" : busy ? "busy" : "ok",
    t3: mode === "monitor" ? "ok" : "idle",
  };
  ["t1", "t2", "t3"].forEach((k) => { const e = $(k + "State"); if (ov[k]) e.textContent = ov[k]; e.className = "tier-s " + (ov[k] ? "bad" : tone[k]); });
}

// ---------- baud ----------
function bridgeOf(p) {
  const i = p.getInfo(), v = i.usbVendorId, d = i.usbProductId;
  return v == null ? "" : v.toString(16).padStart(4, "0") + ":" + d.toString(16).padStart(4, "0");
}
function autoBaud() {
  const remembered = +store.get("baud." + bridgeKey);
  return remembered || (BRIDGES[bridgeKey] && BRIDGES[bridgeKey].baud) || DEFAULT_BAUD;
}
function flashBaud() { return $("baud").value === "auto" ? autoBaud() : +$("baud").value; }
function hint() {
  const v = $("baud").value, b = BRIDGES[bridgeKey];
  $("baud").options[0].textContent = port ? "Auto · " + autoBaud() + (b ? " (" + b.name.replace(/^.* /, "") + ")" : "") : "Auto";
  $("baudHint").textContent = v === "auto"
    ? "Chosen from the USB bridge. If a write fails it steps down a rate, retries, and remembers what worked."
    : "Manual rate. If a write fails it still steps down and retries. Switch back to Auto to let the bridge decide.";
}

// ---------- board readout ----------
function showPort() {
  const b = BRIDGES[bridgeKey];
  $("portName").textContent = port ? (bridgeKey ? "USB " + bridgeKey.toUpperCase() : "Serial port") : "—";
  $("portBridge").textContent = port ? (b ? b.name : bridgeKey ? "Unrecognised bridge" : "Not a USB device") : "—";
}
function showBoard(d) {
  boardKnown = !!d;
  const v = d ? [d.chip, d.feat, d.xtal + " MHz", fmtSize(flashBytes).replace(".00", "") + " · ID " + d.fid, d.mac.toUpperCase()] : ["—", "—", "—", "—", "—"];
  ["bChip", "bFeat", "bXtal", "bFlash", "bMac"].forEach((id, i) => { $(id).textContent = v[i]; });
  const chip = $("matchChip"), text = $("matchText");
  if (!d) { chip.className = "chip none"; chip.textContent = "No board"; text.textContent = "Connect to read the chip."; return; }
  chip.className = "chip";
  const cyd = /^ESP32-D0WD/.test(d.chip) && flashBytes === 0x400000 && bridgeKey === "1a86:7523";
  chip.textContent = cyd ? "Likely match" : "Detected";
  text.textContent = cyd
    ? "ESP32 with 4 MB flash behind a CH340: consistent with the Cheap Yellow Display family. Merged images go at 0x0."
    : d.chip + " with " + fmtSize(flashBytes).replace(".00", "") + " flash. Merged images go at 0x0.";
  renderMap();
}

// ---------- connection ----------
async function openLoader(baud) {
  transport = new Transport(port, false);
  transport.setDeviceLostCallback(onLost);
  loader = new ESPLoader({ transport, baudrate: baud, terminal, debugLogging: false });
  const chip = await loader.main();
  const fid = await loader.readFlashId();
  const sizeId = (fid >> 16) & 0xff;
  flashBytes = sizeId >= 18 && sizeId <= 28 ? 2 ** sizeId : 0x400000;
  chipName = chip;
  return {
    chip, fid: fid.toString(16).padStart(6, "0"),
    feat: [].concat(await loader.chip.getChipFeatures(loader)).filter((f) => !/VRef|Coding Scheme/i.test(f)).join(" · "),
    xtal: await loader.chip.getCrystalFreq(loader),
    mac: await loader.chip.readMac(loader),
  };
}
async function closePort() {
  await stopMonitor();
  try { if (transport && port && port.readable) await transport.disconnect(); } catch { /* already closed */ }
  try { if (port && port.readable) await port.close(); } catch { /* already closed */ }
}

// Listen-first connect: open the port and stream output. No bootloader, no reset.
async function connectListen(p, auto) {
  if (busy) return;
  clearAlerts(); busy = true; connecting = true; lost = false; autoConn = auto; port = p; bridgeKey = bridgeOf(p);
  showPort(); hint(); showBoard(null); led("ledLink", "busy", true); led("ledSync"); led("ledBusy"); sync();
  log((auto ? "Known board found. " : "") + "Listening at " + $("monBaud").value + " without restarting the board", "sys");
  try { await startMonitor(); led("ledLink", "ok"); }
  catch (e) {
    log(String(e && e.message ? e.message : e), "bad"); mode = "idle"; led("ledLink", "fault");
    failConn("Port in use", "Port in use", "The port would not open. Another program is probably holding it. Close the Arduino IDE, a PlatformIO monitor, or another flasher tab, then click Connect.");
  }
  busy = false; connecting = false; sync();
}
async function readBoard() {
  if (busy || !port) return;
  clearAlerts(); busy = true; sync(); log("Reading the chip. This restarts the board into its bootloader.", "sys");
  try { await stopMonitor(); const d = await openLoader(flashBaud()); mode = "loader"; led("ledLink", "ok"); led("ledSync", "ok"); showBoard(d); renderHealth(); }
  catch (e) {
    log(String(e && e.message ? e.message : e), "bad"); await closePort(); mode = "idle"; led("ledSync", "fault"); stopHealth();
    failConn("Chip not responding", "Chip not responding", "The chip never entered its bootloader. Hold BOOT, tap RST, release BOOT, then click Connect.");
  }
  busy = false; sync();
}

// Connecting never interrupts the board. Only Read board and Write flash put the chip into its bootloader.
const connect = (p, auto) => connectListen(p, auto);

async function disconnect() {
  busy = true; sync(); clearAlerts();
  await closePort();
  mode = "idle"; port = null; loader = null; transport = null; bridgeKey = ""; stopHealth();
  ["ledLink", "ledSync", "ledBusy"].forEach((l) => led(l));
  showPort(); showBoard(null); hint(); log("Port closed.", "sys");
  busy = false; sync();
}

function onLost() {
  if (lost || !port) return; lost = true;
  monStop = true; mode = "idle"; loader = null; transport = null; port = null; stopHealth();
  led("ledLink", "fault"); led("ledSync"); showPort(); showBoard(null);
  log("The device has been lost.", "bad");
  if (busy && $("sStage").textContent !== "Idle" && $("sStage").textContent !== "Done") {
    failWrite("Write interrupted", "The board disappeared part-way through. Its flash is now half written, so it will not boot until a write completes. Plug it back in and write again.");
  }
  failConn("Disconnected", "Board unplugged", "The USB device disappeared. Plug it back in" + ($("optAuto").checked ? " and it will reconnect by itself." : ", then click Connect."));
}

// ---------- board health: judged passively from what the board prints ----------
const CRASH = /Guru Meditation|Backtrace:|abort\(\) was called|assert failed|LoadProhibited|StoreProhibited|InstrFetchProhibited|IllegalInstruction|stack overflow|Stack canary|watchdog got triggered|panic'ed|Rebooting\.\.\./i;
const RESET_BAD = { "0x7": "watchdog", "0x8": "watchdog", "0x9": "watchdog", "0xc": "crash", "0xf": "brownout" };
let health = null, hLines = 0, hResets = [], hTimer = 0, hBadAt = 0;
// Heartbeat convention: firmware prints a line containing "#alive", optionally with up=<seconds> heap=<bytes>.
let hbLast = 0, hbGap = 5000, hbWatch = 0;
const fmtUp = (sec) => (sec >= 3600 ? Math.floor(sec / 3600) + " h " + Math.floor((sec % 3600) / 60) + " m" : sec >= 60 ? Math.floor(sec / 60) + " m" : sec + " s");
function heartbeat(line) {
  const now = Date.now(); if (hbLast) hbGap = Math.max(1000, Math.round(hbGap * 0.5 + (now - hbLast) * 0.5)); hbLast = now;
  const up = line.match(/up=(\d+)/), heap = line.match(/heap=(\d+)/);
  setHealth("alive", "Heartbeat about every " + Math.round(hbGap / 1000) + " s" + (up ? " · up " + fmtUp(+up[1]) : "") + (heap ? " · " + Math.round(+heap[1] / 1024) + " kB free" : "") + ".");
  clearInterval(hbWatch);
  hbWatch = setInterval(() => {
    const late = Date.now() - hbLast;
    if (mode === "monitor" && health && health.kind === "alive" && late > Math.max(3 * hbGap, 6000)) { clearInterval(hbWatch); setHealth("hung", "Last heartbeat " + Math.round(late / 1000) + " s ago."); }
  }, 1000);
}
function setHealth(kind, detail) { if (kind === "crash" || kind === "loop" || kind === "brownout") hBadAt = Date.now(); health = { kind, detail: detail || "" }; renderHealth(); }
function startHealth() {
  hLines = 0; hResets = []; hbLast = 0; hbGap = 5000; hBadAt = 0; clearTimeout(hTimer); clearInterval(hbWatch); setHealth("listening");
  hTimer = setTimeout(() => { if (health && health.kind === "listening") setHealth("quiet"); }, 4000);
}
function stopHealth() { clearTimeout(hTimer); clearInterval(hbWatch); health = null; renderHealth(); }
function judge(line) {
  if (!health) return;
  // a bad verdict holds for 20 s after the last bad event, then normal output can clear it
  const bad = (health.kind === "crash" || health.kind === "loop" || health.kind === "brownout") && Date.now() - hBadAt < 20000;
  const rst = line.match(/rst:(0x[0-9a-f]+)/i);
  if (rst) {
    const now = Date.now(); hResets = hResets.filter((t) => now - t < 15000); hResets.push(now);
    const why = RESET_BAD[rst[1].toLowerCase()];
    if (hResets.length >= 3) return setHealth("loop", hResets.length + " restarts in the last 15 seconds.");
    if (why === "brownout") return setHealth("brownout");
    if (why) return setHealth("crash", line.trim());
    return;
  }
  if (/Brownout detector was triggered/i.test(line)) return setHealth("brownout");
  if (CRASH.test(line)) { if (!bad) setHealth("crash", line.trim()); return; }   // keep the first crash line: it names the cause
  if (/#alive\b/.test(line)) { if (!bad) heartbeat(line); return; }
  if (/waiting for download/i.test(line)) return setHealth("download");
  if (/invalid header: 0xffffffff|flash read err/i.test(line)) { if (health.kind !== "empty") setHealth("empty"); return; }
  if (line.trim() && !/^(ets |configsip|clk_drv|mode:|load:|entry |ho \d|ESP-ROM)/.test(line)) { hLines++; if (!bad && ["listening", "quiet", "crash", "loop", "brownout", "hung"].includes(health.kind)) setHealth("ok"); }
}
const HEALTH = {
  listening: ["idle", "Board connected", "Listening for output. Connecting did not restart it."],
  ok:        ["ok", "Board is running", "Its firmware is printing normally. Connecting did not interrupt it."],
  alive:     ["ok", "Board is alive", "Its firmware is sending heartbeats."],
  hung:      ["bad", "Board stopped responding", "Its heartbeat has stopped, so the firmware has probably hung. Reset board restarts it."],
  quiet:     ["idle", "Board connected, no output yet", "Many firmwares print nothing while idle, so this is not a fault. Press Reset board to watch it boot."],
  crash:     ["bad", "Board is crashing", "The firmware hit an error and restarted. The monitor has the details. Writing known-good firmware fixes it."],
  loop:      ["bad", "Board is stuck in a restart loop", "Usual causes: broken firmware, or not enough power from this USB port or cable."],
  brownout:  ["bad", "Power problem (brownout)", "The supply voltage dipped and the chip reset itself. Try another cable, a powered hub, or a different port."],
  download:  ["warn", "Board is in download mode", "It is waiting for firmware, so nothing is running to interrupt."],
  empty:     ["warn", "No valid firmware on the board", "The chip starts but finds nothing to run. It is ready to flash."],
  loader:    ["idle", "Board is paused in its bootloader", "Ready to write. Reset board starts its firmware again."],
};
function renderHealth() {
  const e = $("health"), k = mode === "loader" ? "loader" : health && mode === "monitor" ? health.kind : null;
  if (!k) { e.hidden = true; sync(); return; }
  const [tone, title, msg] = HEALTH[k];
  e.className = "health " + tone; e.textContent = "";
  const b = document.createElement("b"); b.textContent = title;
  const m = document.createElement("span"); m.textContent = (health && health.detail && k !== "loader" ? health.detail + " " : "") + msg;
  e.append(b, m); e.hidden = false; sync();
  // nothing is running in these two cases, so reading the chip interrupts nothing
  if ((k === "download" || k === "empty") && view === "flash" && !boardKnown && !busy) setTimeout(() => { if (!busy && mode === "monitor") readBoard(); }, 300);
}

// ---------- serial monitor ----------
function onSerial(text) {
  lineBuf += text.replace(/\x1b\[[0-9;]*m/g, "");
  const parts = lineBuf.split("\n"); lineBuf = parts.pop();
  parts.forEach((l) => judge(l));
  parts.forEach((l) => log(l.replace(/\r/g, ""), /^(ets |rst:|configsip|clk_drv|mode:|load:|entry |ho \d|ESP-ROM)/.test(l) || /#alive\b/.test(l) ? "rom" : ""));
  clearTimeout(lineTimer);
  if (lineBuf) lineTimer = setTimeout(() => { if (lineBuf) { log(lineBuf.replace(/\r/g, "")); lineBuf = ""; } }, 300);
}
async function startMonitor() {
  if (!port) return;
  if (port.readable) { try { await transport.disconnect(); } catch { try { await port.close(); } catch { /* closed */ } } }
  loader = null;
  await port.open({ baudRate: +$("monBaud").value });
  try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch { /* not all ports support it */ }
  monStop = false; mode = "monitor"; startHealth();
  const dec = new TextDecoder();
  (async () => {
    while (port && port.readable && !monStop) {
      monReader = port.readable.getReader();
      try {
        for (;;) { const { value, done } = await monReader.read(); if (done) break; if (value) onSerial(dec.decode(value, { stream: true })); }
      } catch (e) {
        if (e && e.name === "NetworkError") { onLost(); break; }
        // framing / overrun errors are recoverable: loop round and take a new reader
      } finally { try { monReader.releaseLock(); } catch { /* released */ } monReader = null; }
      if (monStop) break;
    }
  })();
}
async function stopMonitor() {
  if (mode !== "monitor") return;
  monStop = true;
  try { if (monReader) await monReader.cancel(); } catch { /* gone */ }
  await sleep(50);
  try { if (port && port.readable) await port.close(); } catch { /* closed */ }
  mode = "idle";
}
async function resetBoard() {
  if (!port || busy) return;
  busy = true; sync();
  try {
    if (mode !== "monitor") await startMonitor();   // open the monitor first so the boot log is not missed
    log("Resetting the board (RTS pulse)", "sys");
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await sleep(120);
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch (e) { log("Reset failed: " + (e.message || e), "bad"); }
  busy = false; sync();
}
async function sendLine() {
  const v = $("send").value; if (!v || mode !== "monitor" || !port.writable) return;
  const w = port.writable.getWriter();
  try { await w.write(new TextEncoder().encode(v + "\r\n")); log("> " + v, "tx"); $("send").value = ""; }
  catch (e) { log("Send failed: " + (e.message || e), "bad"); }
  finally { w.releaseLock(); }
}

// ---------- image segments ----------
const parseOff = (s) => (/^0x[0-9a-f]+$/i.test(s.trim()) ? parseInt(s, 16) : /^\d+$/.test(s.trim()) ? parseInt(s, 10) : NaN);
function segsValid() { return segs.every((s) => !Number.isNaN(parseOff(s.off))) && (!extent() || extent().hi <= flashBytes); }
function extent() {
  let lo = Infinity, hi = 0;
  segs.forEach((s) => { const o = parseOff(s.off); if (!Number.isNaN(o)) { lo = Math.min(lo, o); hi = Math.max(hi, o + s.file.size); } });
  return hi ? { lo, hi } : null;
}
function renderSegs() {
  const box = $("segs"); box.textContent = "";
  segs.forEach((s, i) => {
    const r = document.createElement("div"); r.className = "seg";
    const off = document.createElement("input"); off.className = "off"; off.id = "off" + i; off.value = s.off; off.spellcheck = false;
    off.setAttribute("aria-label", "Flash offset for " + s.file.name);
    off.oninput = () => { s.off = off.value; off.style.borderColor = Number.isNaN(parseOff(s.off)) ? "var(--fault)" : ""; renderMap(); sync(); };
    const f = document.createElement("div"); f.className = "seg-file mono"; f.textContent = s.file.name; f.title = s.file.name;
    const z = document.createElement("span"); z.className = "seg-size"; z.textContent = s.file.size.toLocaleString() + " B";
    const x = document.createElement("button"); x.className = "x"; x.textContent = "×"; x.setAttribute("aria-label", "Remove " + s.file.name);
    x.onclick = () => { if (busy) return; segs.splice(i, 1); renderSegs(); };
    r.append(off, f, z, x); box.appendChild(r);
  });
  $("btnAdd").textContent = segs.length ? "Add another file" : "Choose file";
  $("dropText").textContent = segs.length ? "Firmware split into several files? Drop the next .bin here, or" : "Drop a firmware .bin here, or";
  renderMap(); sync();
}
function renderMap() {
  const e = extent(), ex = $("extent");
  $("mapSize").textContent = fmtSize(flashBytes).replace(".00", "");
  const ticks = $("ticks"); ticks.textContent = "";
  for (let i = 0; i <= 4; i++) { const s = document.createElement("span"); s.textContent = hex((flashBytes / 4) * i); ticks.appendChild(s); }
  if (!e) { ex.style.width = "0"; $("fill").style.width = "0"; $("mapRange").textContent = "—"; return; }
  const over = e.hi > flashBytes;
  ex.style.left = (e.lo / flashBytes) * 100 + "%"; ex.style.width = Math.min(100, ((e.hi - e.lo) / flashBytes) * 100) + "%";
  $("fill").style.left = ex.style.left;
  $("mapRange").textContent = hex(e.lo) + " – " + hex(e.hi) + " · " + fmtSize(e.hi - e.lo);
  if (over) alertIn("t2", "Image too large", "This image ends at " + hex(e.hi) + " but the flash is only " + fmtSize(flashBytes) + ". Check the offset, or pick the right file for this board.");
  else if ($("alertt2").firstChild && $("alertt2").firstChild.textContent === "Image too large") $("alertt2").hidden = true;
}
function addFile(f) {
  if (busy) return;
  const merged = /merged|factory|full/i.test(f.name) || !segs.length;
  segs.push({ off: merged ? "0x0" : "0x10000", file: f });
  renderSegs(); log("Loaded " + f.name + " (" + f.size.toLocaleString() + " bytes)", "sys");
}

// ---------- write ----------
async function write() {
  const e = extent(); if (!e || busy || !port) return;
  clearAlerts(); busy = true; led("ledBusy", "busy", true); sync();
  const total = segs.reduce((n, s) => n + s.file.size, 0), sizes = segs.map((s) => s.file.size), start = Date.now();
  const span = ((e.hi - e.lo) / flashBytes) * 100;
  $("fill").style.width = "0"; $("sPct").textContent = "0 %"; $("sRate").textContent = "—";
  const clock = setInterval(() => { $("sTime").textContent = ((Date.now() - start) / 1000).toFixed(1) + " s"; }, 100);
  let writeStart = 0;
  const reportProgress = (i, written, tot) => {
    if (!writeStart) writeStart = Date.now();
    const doneBytes = sizes.slice(0, i).reduce((a, b) => a + b, 0) + sizes[i] * (written / tot), p = doneBytes / total;
    $("sStage").textContent = p >= 1 && $("optVerify").checked ? "Verifying" : "Writing";
    $("fill").style.width = span * p + "%"; $("sPct").textContent = Math.floor(p * 100) + " %";
    const secs = (Date.now() - writeStart) / 1000; if (secs > 0.3) $("sRate").textContent = Math.round(doneBytes / 1024 / secs) + " kB/s";
  };
  try {
    const fileArray = await Promise.all(segs.map(async (s) => ({ data: new Uint8Array(await s.file.arrayBuffer()), address: parseOff(s.off) })));
    let baud = flashBaud(), steppedDown = false;
    if (mode !== "loader") { $("sStage").textContent = "Connecting"; await stopMonitor(); const d = await openLoader(baud); mode = "loader"; showBoard(d); led("ledSync", "ok"); renderHealth(); }
    for (;;) {
      try {
        $("sStage").textContent = "Erasing"; writeStart = 0;
        await loader.writeFlash({
          fileArray, flashMode: "keep", flashFreq: "keep", flashSize: "keep",
          eraseAll: $("optErase").checked, compress: true, reportProgress,
          calculateMD5Hash: $("optVerify").checked ? md5 : undefined,
        });
        break;
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        if (lost || /MD5/.test(msg)) throw err;
        const next = RATES.find((r) => r < baud);
        if (!next) throw err;
        log(msg, "bad"); log("Write failed at " + baud + ". Stepping down to " + next + " and writing again.", "sys");
        $("sStage").textContent = "Retrying"; baud = next; steppedDown = true;
        try { await transport.disconnect(); } catch { /* closed */ }
        await sleep(300);
        const d = await openLoader(baud); showBoard(d);
      }
    }
    if (steppedDown && bridgeKey) { store.set("baud." + bridgeKey, String(baud)); log("Remembered " + baud + " for this kind of USB bridge.", "sys"); $("baud").value = "auto"; hint(); }
    $("fill").style.width = span + "%"; $("sPct").textContent = "100 %"; $("sStage").textContent = "Done"; led("ledBusy", "ok");
    log("Wrote " + total.toLocaleString() + " bytes in " + ((Date.now() - start) / 1000).toFixed(1) + " s" + ($("optVerify").checked ? ", verified." : "."), "good");
    clearInterval(clock); busy = false;
    if ($("optReset").checked) await resetBoard();
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    log(msg, "bad");
    if (lost) { /* onLost has already explained it */ }
    else if (/MD5/.test(msg)) failWrite("Verify failed", "The data read back from flash does not match the image. Tick Erase entire flash first and write again. If it keeps failing, suspect unstable USB power or a worn flash chip.");
    else if (/Failed to connect/.test(msg)) failWrite("Chip not responding", "Could not get the chip back into its bootloader. Hold BOOT, tap RST, release BOOT, then write again.");
    else failWrite("Write failed", "The write stopped at " + $("sPct").textContent + " even at the slowest rate. The flash may be half written, so the board will not boot until a write completes. Check the cable and power, then write again. Detail: " + msg);
  }
  clearInterval(clock); busy = false; sync();
}

// ---------- wiring ----------
$("btnConnect").onclick = async () => {
  if (mode !== "idle") return disconnect();
  try { const p = await navigator.serial.requestPort(); await connect(p, false); }
  catch (e) { if (!e || e.name !== "NotFoundError") log("Could not choose a port: " + (e.message || e), "bad"); }
};
$("btnWrite").onclick = write;
$("btnReset").onclick = resetBoard;
$("btnClear").onclick = () => { $("log").textContent = ""; };
$("btnAdd").onclick = () => $("file").click();
$("file").onchange = (ev) => { [...ev.target.files].forEach(addFile); ev.target.value = ""; };
const drop = $("drop");
["dragenter", "dragover"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => [...e.dataTransfer.files].filter((f) => /\.bin$/i.test(f.name)).forEach(addFile));
window.addEventListener("dragover", (e) => e.preventDefault()); window.addEventListener("drop", (e) => e.preventDefault());
$("baud").onchange = hint;
$("optAuto").onchange = () => store.set("auto", $("optAuto").checked ? "1" : "0");
$("btnSend").onclick = sendLine;
$("send").addEventListener("keydown", (e) => { if (e.key === "Enter") sendLine(); });
$("monBaud").onchange = async () => { if (mode === "monitor" && !busy) { busy = true; await stopMonitor(); await startMonitor(); busy = false; } sync(); };

// ---------- theme: auto follows the system setting, light / dark pin it ----------
function setTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; else { t = "auto"; delete document.documentElement.dataset.theme; }
  store.set("theme", t);
  document.querySelectorAll("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === t)));
}
document.querySelectorAll("[data-theme-set]").forEach((b) => { b.onclick = () => setTheme(b.dataset.themeSet); });
setTheme(store.get("theme") || "auto");

// ---------- views: FLASH shows everything; MONITOR shows the port and a tall monitor, and never touches the chip ----------
async function setView(v) {
  view = v === "monitor" ? "monitor" : "flash"; document.body.dataset.view = view; store.set("view", view);
  document.querySelectorAll("[data-view-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.viewSet === view)));
  $("t3Num").textContent = view === "monitor" ? "2" : "3";
  $("t1Desc").textContent = "Open the port and listen";
  // leaving FLASH with the chip parked in its bootloader: restart it so there is something to watch
  if (view === "monitor" && mode === "loader" && !busy) await resetBoard();
  sync(); if ($("optScroll").checked) $("log").scrollTop = $("log").scrollHeight;
}
document.querySelectorAll("[data-view-set]").forEach((b) => { b.onclick = () => setView(b.dataset.viewSet); });
$("btnRead").onclick = readBoard;

async function tryAuto() {
  if (!$("optAuto").checked || mode !== "idle" || busy) return;
  const ports = await navigator.serial.getPorts();
  if (ports.length) await connect(ports[0], true);
}

(async function init() {
  if (store.get("auto") === "0") $("optAuto").checked = false;
  await setView(store.get("view") || "flash");
  renderSegs(); hint(); showPort(); sync();
  if (!("serial" in navigator)) {
    failConn("Not supported", "This browser cannot reach serial ports", "ESP Ctrl needs Web Serial, which is in Chrome and Edge on a computer. Safari, Firefox and phones do not have it. The page must also be served from https or localhost.");
    return;
  }
  navigator.serial.addEventListener("connect", () => { log("A known USB serial device was plugged in.", "sys"); tryAuto(); });
  navigator.serial.addEventListener("disconnect", (e) => { if (port && (e.target === port || e.port === port)) onLost(); });
  log("Click Connect and choose your board's serial port. After the first time, it connects by itself.", "sys");
  await tryAuto();
})();
