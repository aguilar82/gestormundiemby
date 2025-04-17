const axios = require('axios');
const db = require('./db');
const EMBY_API_KEY = 'TU_EMBY_API_KEY';

function eliminarUsuario(id, servidor) {
  return axios.delete(`${servidor}/Users/${id}`, {
    headers: { 'X-Emby-Token': EMBY_API_KEY }
  });
}

function revisarExpirados() {
  const hoy = new Date().toISOString().split('T')[0];

  db.all('SELECT * FROM usuarios WHERE fechaExp <= ?', [hoy], (err, rows) => {
    if (err) return console.error(err);

    rows.forEach(async ({ id, nombre, servidor }) => {
      try {
        await eliminarUsuario(id, servidor);
        console.log(`🗑️ Usuario eliminado: ${nombre}`);
        db.run('DELETE FROM usuarios WHERE id = ?', [id]);
      } catch (e) {
        console.error(`❌ Error al eliminar ${nombre}:`, e.message);
      }
    });
  });
}

revisarExpirados();
