> 🇪🇸 **Español** · [🇬🇧 Read in English](README.md)

# DrunkBetter Profile Manager

Aplicación de escritorio en Electron para gestionar perfiles del teclado magnético **DrunkDeer A75 Pro** (`VID 1452` / `PID 591`) directamente por USB HID sin depender del navegador.

## Características principales

- **Gestión de perfiles:** creación, renombrado (clic derecho), eliminación, importación y exportación en formato `.json` compatible con el esquema oficial (`keys_array`, `rtp`, `features`).
- **Actuación y Rapid Trigger por tecla:** selección individual o por arrastre rectangular con ajuste independiente de *Punto de actuación* (`0.2–3.3 mm`), *Press to activate* (`0.1–3.1 mm`) y *Release Reset* (`0.1–3.1 mm`).
- **Modos de rendimiento:**
  - *Rapid Trigger Mode*
  - *Last Win Mode* (grupos de 2 teclas con prioridad a la última pulsación)
  - *Release Dual-Trigger* (grupos tecla principal + disparo con activación y reset propios)
  - *Turbo Mode* (con gestión de `Turbo mode light` y restauración de iluminación previa al desactivarlo)
  - *Keystroke Tracking*
- **Detección automática de aplicaciones:** cambia automáticamente de perfil cuando un `.exe` configurado pasa a primer plano.
- **Iluminación (`Colour`):** control de efectos integrados, `Custom light` por tecla, `Turbo mode light`, brillo (`0–9`), velocidad (`0–9`) y protección de 3 pulsaciones mientras Turbo Mode está activo.
- **Remapeo (`Remap`):** editor de 3 capas (`Default`, `Fn`, `Fn2`), acciones de función (`SP+`, `SP-`, `BR+`, `BR-`, etc.), multimedia y ratón, con opción de aplicar un remap global o asociarlo a un perfil concreto.
- **Integración con Windows y multiidioma:** icono en la bandeja del sistema (*tray*), inicio opcional con Windows en segundo plano, 5 temas visuales (`Azul`, `Dark`, `White`, `Tierra`, `IBM`), configuración del perfil al cerrar e interfaz en **Español / English** (automática según el idioma del sistema, con selector manual en Ajustes).

## Descarga e instalación (usuarios)

Desde la pestaña **Releases** del repositorio puedes descargar cualquiera de las dos versiones compiladas para Windows:

- **`DrunkBetter Profile Manager Setup 1.0.0.exe`**: instalador estándar para Windows (recomendado si quieres usar la opción *"Iniciar con Windows"*).
- **`DrunkBetter Profile Manager Portable 1.0.0.exe`**: ejecutable directo sin instalación.

> **Nota:** Al no contar con firma digital comercial, Windows SmartScreen puede mostrar *"Windows protegió su PC"* la primera vez. Pulsa **Más información → Ejecutar de todas formas**. Se recomienda cerrar la web/app oficial de DrunkDeer mientras se usa este gestor para evitar conflictos en la interfaz USB HID.

## Desarrollo

Requiere **Node.js 20 o superior**:

```powershell
npm install
npm run rebuild:native
npm start
```

> `npm run rebuild:native` recompila el módulo nativo `node-hid` para la versión de Electron instalada.

### Scripts disponibles

- `npm start`: inicia la aplicación en modo desarrollo.
- `npm test`: ejecuta las pruebas de verificación de tramas (`scripts/selftest.js`).
- `npm run list`: lista las interfaces HID de DrunkDeer detectadas.
- `npm run build:win`: genera el instalador NSIS y el ejecutable portable en `release/`.

## Estructura del proyecto

```text
├── main.js               # Proceso principal de Electron, bandeja e IPC
├── preload.js            # Puente seguro (contextBridge) hacia la interfaz
├── public/               # Interfaz web (HTML, CSS, app.js, i18n.js e iconos)
├── src/
│   ├── autoMode.js       # Detección de ventana/proceso en primer plano
│   ├── config.js         # Constantes HID (VID/PID, tiempos, flags)
│   ├── configStore.js    # Persistencia y normalización de config.json
│   ├── keyboard.js       # Cola de escritura HID con confirmación por eco
│   ├── profiles.js       # Perfiles integrados por defecto
│   ├── protocol.js       # Codificación de tramas binarias USB HID
│   ├── remap.js          # Validación y construcción de capas de remapeo
│   └── remapBaseline.js  # Tabla de fábrica (Reset all keys) del A75 Pro
└── scripts/
    ├── selftest.js       # Suite de pruebas contra capturas oficiales
    └── probe-hid.js      # Utilidad de inspección HID
```

## Avisos de uso, hardware y privacidad

- **Políticas Anti-Cheat:** funciones como **Last Win Mode** (*SOCD / Snap Tap*) o **Release Dual-Trigger** (macros 2-en-1) pueden estar restringidas o prohibidas por normativas de títulos y plataformas competitivas (como Valve en *Counter-Strike 2* o *Valorant*). El usuario final asume toda la responsabilidad por su uso.
- **Compatibilidad de hardware y protocolo USB HID:** este proyecto utiliza tramas binarias obtenidas mediante capturas sobre el **DrunkDeer A75 Pro** (`VID 1452` / `PID 591`), sin usar un SDK oficial. No se garantiza el funcionamiento en otros modelos de DrunkDeer ni tras futuras actualizaciones de firmware. En caso de cualquier desajuste, siempre puedes restablecer el teclado desde el software o configurador web oficial de DrunkDeer.
- **Privacidad 100 % local:** tanto la detección de ventana en primer plano (`active-win`) como el modo *Keystroke Tracking* se ejecutan exclusivamente de forma local en tu equipo, sin conexión a internet ni telemetría.

### Disclaimer & Trademark Notice

DrunkBetter Profile Manager is an independent, open-source community tool developed solely for hardware interoperability purposes.

- This project is **not** affiliated, associated, authorized, endorsed by, or in any way officially connected with DrunkDeer, or any of its subsidiaries or affiliates.
- The official DrunkDeer website can be found at https://drunkdeer.com.
- "DrunkDeer" and any related names, marks, emblems, and images are registered trademarks of their respective owners. The use of any trade name or trademark is strictly for identification and reference purposes and does not imply any association with the trademark holder.
- The software is provided "as is", without warranty of any kind, express or implied. See the [LICENSE](LICENSE) file for details.

## Licencia

Este proyecto se distribuye bajo la licencia [ISC](LICENSE).
