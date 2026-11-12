'use strict';

module.exports = {
  // Identificadores del dispositivo (decimal, como espera node-hid)
  VENDOR_ID: 1452,
  PRODUCT_ID: 591,
  REPORT_ID: 4,

  // El informe mide 64 bytes EN TOTAL (Report ID + 63 de payload). Ver src/protocol.js.
  REPORT_PAYLOAD_LENGTH: 63,
  REPORT_LENGTH: 64,

  // Tramas opcionales (ver src/protocol.js). El oficial no envía a0 02 al aplicar un perfil,
  // pero sí envía b6 04 después de b6 01. Pon SEND_SENSITIVITY a true si la sonda demuestra que hace falta.
  SEND_INIT_QUERY: false,
  SEND_SENSITIVITY: true, // el oficial envía SIEMPRE b6 01 + b6 04 + b6 05 (9 tramas); 0 = Rapid Trigger apagado

  // Release Dual-Trigger: tramas a7/a8 descifradas con la captura de 3 grupos (ver protocol.js).
  DUAL_TRIGGER_READY: true,

  // Pausa entre tramas de un mismo perfil (ms)
  FRAME_DELAY_MS: 20,

  // Tras cada trama b6 el teclado devuelve un eco (informe de entrada idéntico) si la acepta.
  // Se espera ese eco antes de enviar la siguiente; si no llega en este tiempo se avisa y se sigue.
  ECHO_TIMEOUT_MS: 300,

  // Reintento de conexión si el teclado no está disponible (ms)
  RECONNECT_INTERVAL_MS: 5000,

  // Servidor local. Solo escucha en loopback (no accesible desde la red).
  HOST: '127.0.0.1',
  PORT: 8000,

  // Modo automático
  POLL_INTERVAL_MS: 2000,
};