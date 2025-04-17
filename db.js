const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./usuarios.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nombre TEXT,
      servidor TEXT,
      fechaExp TEXT,
      contrasena TEXT,
      maxDispositivos INTEGER
    )
  `);
});

module.exports = db;
