'use strict';

// Cada perfil es una lista de tramas; cada trama es un array de bytes.
// La clave ('default', 'game', ...) se usa en la API y en la interfaz.
// Puedes añadir todos los perfiles que quieras y aparecerán como botones.

module.exports = {
  default: {
    name: 'Escritura estándar',
    frames: [
      // [0x04, 0x00, 0x00, /* ... pega aquí tu captura ... */],
    ],
  },
  game: {
    name: 'Juego (Rapid Trigger)',
    frames: [
      // [0x04, 0x00, 0x00, /* ... pega aquí tu captura ... */],
    ],
  },
};