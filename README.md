> 🇬🇧 **English** · [🇪🇸 Leer en español](README.es.md)

# DrunkBetter Profile Manager

Electron desktop application to manage profiles for the **DrunkDeer A75 Pro** magnetic keyboard (`VID 1452` / `PID 591`) directly over USB HID without relying on a browser.

## Main Features

- **Profile management:** create, rename (right-click), delete, import, and export profiles in `.json` format compatible with the official schema (`keys_array`, `rtp`, `features`).
- **Per-key actuation & Rapid Trigger:** single-key or drag-box selection with independent adjustment of *Actuation point* (`0.2–3.3 mm`), *Press to activate* (`0.1–3.1 mm`), and *Release Reset* (`0.1–3.1 mm`).
- **Performance modes:**
  - *Rapid Trigger Mode*
  - *Last Win Mode* (2-key groups prioritizing the last key pressed)
  - *Release Dual-Trigger* (main + trigger key pairs with independent actuation and reset)
  - *Turbo Mode* (manages `Turbo mode light` and restores previous lighting on disable)
  - *Keystroke Tracking*
- **Auto application detection:** automatically switches profiles when a linked `.exe` process comes into focus.
- **Lighting (`Colour`):** built-in effects, per-key `Custom light`, `Turbo mode light`, brightness (`0–9`), speed (`0–9`), and 3-click protection while Turbo Mode is active.
- **Remapping (`Remap`):** 3-layer editor (`Default`, `Fn`, `Fn2`) with function actions (`SP+`, `SP-`, `BR+`, `BR-`, etc.), media keys, and mouse clicks, assignable globally or bound to a specific profile.
- **Windows integration & multi-language UI:** system tray icon, optional background launch at Windows startup, 5 visual themes (`Blue`, `Dark`, `White`, `Earth`, `IBM`), customizable exit profile behavior, and automatic **English / Español** UI (follows system locale, with manual selector in Settings).

## Download & Installation (Users)

From the repository's **Releases** tab you can download either compiled Windows build:

- **`DrunkBetter Profile Manager Setup 1.0.0.exe`**: standard Windows installer (recommended if you want to use *"Launch at Windows startup"*).
- **`DrunkBetter Profile Manager Portable 1.0.0.exe`**: standalone portable executable with no installation required.

> **Note:** Because this release is not signed with a commercial certificate, Windows SmartScreen may show *"Windows protected your PC"* on first launch. Click **More info → Run anyway** (and verify the SHA-256 checksums published in the Release). Please close the official DrunkDeer web/desktop software while using this manager to avoid USB HID conflicts.

## Development

Requires **Node.js 20 or higher**:

```powershell
npm install
npm run rebuild:native
npm start
```

> `npm run rebuild:native` rebuilds the native `node-hid` module for the installed Electron version.

### Available Scripts

- `npm start`: launches the application in development mode.
- `npm test`: runs the HID frame verification test suite (`scripts/selftest.js`).
- `npm run list`: lists detected DrunkDeer HID interfaces.
- `npm run build:win`: builds the NSIS installer and portable executable into `release/`.

## Project Structure

```text
├── main.js               # Electron main process, system tray, and IPC
├── preload.js            # Secure contextBridge preload script
├── public/               # Web UI (HTML, CSS, app.js, i18n.js, and icons)
├── src/
│   ├── autoMode.js       # Foreground window/process detection
│   ├── config.js         # HID constants (VID/PID, timings, flags)
│   ├── configStore.js    # config.json persistence and normalization
│   ├── keyboard.js       # HID write queue with echo verification
│   ├── profiles.js       # Built-in default profiles
│   ├── protocol.js       # USB HID binary frame encoder
│   ├── remap.js          # Remap layer validation and builder
│   └── remapBaseline.js  # Factory remap baseline (Reset all keys) for A75 Pro
└── scripts/
    ├── selftest.js       # Test suite against official captures
    └── probe-hid.js      # HID inspection utility
```

## Usage, Hardware & Privacy Notices

- **Anti-Cheat Policies:** features such as **Last Win Mode** (*SOCD / Snap Tap*) or **Release Dual-Trigger** (2-in-1 macros) may be restricted or prohibited by competitive game rules and platforms (such as Valve in *Counter-Strike 2* or *Valorant*). Use of these features is solely at the end user's responsibility.
- **Hardware & USB HID Protocol Compatibility:** this project sends binary USB HID frames derived from protocol captures of the **DrunkDeer A75 Pro** (`VID 1452` / `PID 591`), without an official SDK. Compatibility with other DrunkDeer models or future official firmware updates is not guaranteed. If anything goes wrong, you can always reset your keyboard using official DrunkDeer software or web configurator.
- **100% Local Privacy:** both foreground window detection (`active-win`) and *Keystroke Tracking* run strictly locally on your machine, with zero internet connection or telemetry.

### Disclaimer & Trademark Notice

DrunkBetter Profile Manager is an independent, open-source community tool developed solely for hardware interoperability purposes.

- This project is **not** affiliated, associated, authorized, endorsed by, or in any way officially connected with DrunkDeer, or any of its subsidiaries or affiliates.
- The official DrunkDeer website can be found at https://drunkdeer.com.
- "DrunkDeer" and any related names, marks, emblems, and images are registered trademarks of their respective owners. The use of any trade name or trademark is strictly for identification and reference purposes and does not imply any association with the trademark holder.
- The software is provided "as is", without warranty of any kind, express or implied. See the [LICENSE](LICENSE) file for details.

## License

This project is distributed under the [ISC](LICENSE) License.
