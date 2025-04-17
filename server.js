const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cargar configuración desde config.json
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

// Función para obtener la API Key del servidor
function getApiKey(servidorUrl) {
  const serverEntry = Object.values(config.servers).find(s => s.url === servidorUrl);
  return serverEntry ? serverEntry.apiKey : null;
}

// Función para obtener la política de usuario con el número máximo de dispositivos
function getUserPolicy(maxDispositivos) {
  return { ...config.user_policy, MaxSimultaneousStreams: parseInt(maxDispositivos) };
}

// Función para formatear el ID como GUID
function formatAsGuid(id) {
  if (!id || id.includes('-') || id.length !== 32) return id;
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

// Ruta para crear un nuevo usuario
app.post('/crear-usuario', async (req, res) => {
  const { nombre, contraseña, servidor, fechaExp, maxDispositivos } = req.body;
  const apiKey = getApiKey(servidor);

  if (!apiKey) {
    return res.status(400).json({ error: 'Servidor no válido.' });
  }

  try {
    // Crear usuario en Emby
    const crearUser = await axios.post(`${servidor}/Users/New`, { Name: nombre }, {
      headers: { 'X-Emby-Token': apiKey }
    });
    const userId = crearUser.data.Id;

    // Establecer contraseña
    await axios.post(`${servidor}/Users/${userId}/Password`, {
      CurrentPw: '',
      NewPw: contraseña,
      ConfirmPw: contraseña,
      ResetPassword: false
    }, {
      headers: { 'X-Emby-Token': apiKey }
    });

    // Establecer política de usuario
    const userPolicy = getUserPolicy(maxDispositivos);
	  console.log(userPolicy);
    await axios.post(`${servidor}/Users/${userId}/Policy`, userPolicy, {
      headers: { 'X-Emby-Token': apiKey }
    });

    // Guardar en la base de datos
    db.run(
      'INSERT INTO usuarios (id, nombre, servidor, fechaExp, contrasena, maxDispositivos) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, nombre, servidor, fechaExp, contraseña, maxDispositivos],
      (err) => {
        if (err) {
          console.error('Error al guardar en la base de datos:', err.message);
          return res.status(500).json({ error: 'Error al guardar en la base de datos.' });
        }
        res.json({ status: `Usuario creado: ${nombre}` });
      }
    );
  } catch (error) {
    console.error('Error al crear usuario en Emby:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error al crear usuario en Emby.' });
  }
});

// Ruta para obtener todos los usuarios
app.get('/usuarios', (req, res) => {
  db.all('SELECT * FROM usuarios', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Ruta para eliminar un usuario
app.post('/eliminar-usuario', async (req, res) => {
  const { userId, servidor } = req.body;
  const apiKey = getApiKey(servidor);
  const guid = formatAsGuid(userId);

  if (!apiKey) {
    return res.status(400).json({ error: 'Servidor no válido.' });
  }

  try {
    if (guid.includes('-')) {
      await axios.delete(`${servidor}/Users/${guid}`, {
        headers: { 'X-Emby-Token': apiKey }
      });
    }

    db.run('DELETE FROM usuarios WHERE id = ?', [userId], (err) => {
      if (err) return res.status(500).json({ error: 'Error al eliminar en la base de datos.' });
      res.json({ status: 'Usuario eliminado.' });
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar usuario.' });
  }
});

// Ruta para editar la contraseña de un usuario
app.post('/editar-contrasena', async (req, res) => {
  const { userId, servidor, nuevaContrasena } = req.body;
  const apiKey = getApiKey(servidor);
  const guid = formatAsGuid(userId);

  if (!apiKey) {
    return res.status(400).json({ error: 'Servidor no válido.' });
  }

  try {
    await axios.post(`${servidor}/Users/${guid}/Password`, {
      CurrentPw: '',
      NewPw: nuevaContrasena,
      ConfirmPw: nuevaContrasena,
      ResetPassword: false
    }, {
      headers: { 'X-Emby-Token': apiKey }
    });

    db.run('UPDATE usuarios SET contrasena = ? WHERE id = ?', [nuevaContrasena, userId], (err) => {
      if (err) return res.status(500).json({ error: 'Error al actualizar la contraseña en la base de datos.' });
      res.json({ status: 'Contraseña actualizada.' });
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar la contraseña.' });
  }
});

// Ruta para editar el número máximo de dispositivos de un usuario
app.post('/editar-dispositivos', async (req, res) => {
  const { userId, servidor, maxDispositivos } = req.body;
  const apiKey = getApiKey(servidor);
  const guid = formatAsGuid(userId);

  if (!apiKey) {
    return res.status(400).json({ error: 'Servidor no válido.' });
  }

  try {
    const userPolicy = getUserPolicy(maxDispositivos);
	  userPolicy["SimultaneousStreamLimit"]= maxDispositivos;
	  console.log(userPolicy);

    await axios.post(`${servidor}/Users/${guid}/Policy`, userPolicy, {
      headers: { 'X-Emby-Token': apiKey }
    });

    db.run('UPDATE usuarios SET maxDispositivos = ? WHERE id = ?', [maxDispositivos, userId], (err) => {
      if (err) return res.status(500).json({ error: 'Error al actualizar en la base de datos.' });
      res.json({ status: 'Número máximo de transmisiones actualizado.' });
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar las transmisiones en Emby.' });
  }
});

// Servir archivo de log
app.use('/log-expirador.txt', express.static(path.join(__dirname, 'log-expirador.txt')));

// Ruta para verificar credenciales de usuario normal
app.post('/login-usuario', async (req, res) => {
  const { nombre, contrasena } = req.body;
  
  db.get('SELECT * FROM usuarios WHERE nombre = ? AND contrasena = ?', [nombre, contrasena], (err, row) => {
    if (err || !row) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    res.json({ 
      userId: row.id,
      nombre: row.nombre,
      fechaExp: row.fechaExp,
      maxDispositivos: row.maxDispositivos
    });
  });
});

// Ruta para manejar peticiones de contenido
const peticionesDB = new sqlite3.Database('./peticiones.db');

peticionesDB.serialize(() => {
  peticionesDB.run(`
    CREATE TABLE IF NOT EXISTS peticiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      nombreUsuario TEXT,
      tipo TEXT,
      titulo TEXT,
      fecha TEXT,
      estado TEXT DEFAULT 'pendiente'
    )
  `);
});

// Enviar petición
app.post('/enviar-peticion', async (req, res) => {
  const { userId, nombreUsuario, tipo, titulo } = req.body;
  
  peticionesDB.run(
    'INSERT INTO peticiones (userId, nombreUsuario, tipo, titulo, fecha) VALUES (?, ?, ?, ?, ?)',
    [userId, nombreUsuario, tipo, titulo, new Date().toISOString()],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Error al guardar la petición' });
      }
      res.json({ status: 'Petición enviada' });
    }
  );
});

// Obtener peticiones (para admin)
app.get('/peticiones', (req, res) => {
  peticionesDB.all('SELECT * FROM peticiones ORDER BY fecha DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Obtener peticiones de un usuario específico
app.get('/peticiones-usuario/:userId', (req, res) => {
  const { userId } = req.params;
  
  peticionesDB.all('SELECT * FROM peticiones WHERE userId = ? ORDER BY fecha DESC', [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Actualizar estado de petición (admin)
app.post('/actualizar-peticion', async (req, res) => {
  const { id, estado } = req.body;
  
  peticionesDB.run(
    'UPDATE peticiones SET estado = ? WHERE id = ?',
    [estado, id],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Error al actualizar la petición' });
      }
      res.json({ status: 'Petición actualizada' });
    }
  );
});

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

app.listen(3000, () => {
  console.log('🚀 Servidor corriendo en http://localhost:3000');
});
