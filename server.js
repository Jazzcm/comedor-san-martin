require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const XLSX = require('xlsx');
const path = require('path');

// Configuración inicial
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? 'https://tudominio.com' 
    : '*',
  methods: ['GET', 'POST']
}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend/build')));

// Conexión a PostgreSQL (Neon.tech)
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: process.env.NODE_ENV !== 'development'
  }
};

const pool = new Pool(poolConfig);

// Verificar conexión a la base de datos
const testConnection = async () => {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Conectado a PostgreSQL en Neon.tech');
  } catch (err) {
    console.error('❌ Error de conexión a PostgreSQL:', err.message);
    process.exit(1);
  }
};

// Funciones de utilidad
const handleDatabaseError = (res, err) => {
  console.error('Error en PostgreSQL:', err);
  return res.status(500).json({ 
    error: 'Error en la base de datos',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
};

// Rutas
app.post('/registrar', async (req, res) => {
  try {
    const { codigo, turno } = req.body;
    
    if (!codigo || !turno) {
      return res.status(400).json({ error: 'Código y turno son requeridos' });
    }

    // Verificar duplicados
    const duplicateCheck = await pool.query(
      `SELECT id FROM registros 
       WHERE codigo = $1 AND turno = $2 AND DATE(fecha) = CURRENT_DATE`,
      [codigo, turno]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Este empleado ya está registrado hoy' });
    }

    // Insertar registro
    const result = await pool.query(
      `INSERT INTO registros (codigo, turno) 
       VALUES ($1, $2) 
       RETURNING id, codigo, turno, 
       TO_CHAR(fecha, 'HH24:MI:SS') as hora`,
      [codigo, turno]
    );

    return res.json({ 
      message: 'Registro exitoso',
      registro: result.rows[0]
    });

  } catch (err) {
    return handleDatabaseError(res, err);
  }
});

app.get('/registros', async (req, res) => {
  try {
    const { turno } = req.query;
    
    if (!turno) {
      return res.status(400).json({ error: 'El parámetro turno es requerido' });
    }

    const result = await pool.query(
      `SELECT id, codigo, turno, 
       TO_CHAR(fecha, 'HH24:MI:SS') as hora 
       FROM registros 
       WHERE turno = $1 AND DATE(fecha) = CURRENT_DATE 
       ORDER BY fecha DESC`,
      [turno]
    );

    return res.json(result.rows);

  } catch (err) {
    return handleDatabaseError(res, err);
  }
});

app.get('/exportar', async (req, res) => {
  try {
    const { turno } = req.query;
    
    if (!turno) {
      return res.status(400).json({ error: 'El parámetro turno es requerido' });
    }

    const result = await pool.query(
      `SELECT codigo, turno, 
       TO_CHAR(fecha, 'YYYY-MM-DD HH24:MI:SS') as fecha 
       FROM registros 
       WHERE turno = $1 AND DATE(fecha) = CURRENT_DATE`,
      [turno]
    );

    // Generar Excel
    const ws = XLSX.utils.json_to_sheet(result.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registros");
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Configurar headers
    res.setHeader('Content-Disposition', `attachment; filename=registros_${turno}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buffer);

  } catch (err) {
    return handleDatabaseError(res, err);
  }
});

// Health Check
app.get('/status', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ 
      status: 'OK', 
      database: 'Connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ 
      status: 'Error',
      database: 'Disconnected',
      error: err.message
    });
  }
});

// Manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejo centralizado de errores
app.use((err, req, res, next) => {
  console.error('Error global:', err.stack);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Iniciar servidor con manejo de EADDRINUSE
const startServer = async () => {
  await testConnection();
  
  const server = app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Error: El puerto ${PORT} está en uso. Soluciones:
      1. Cambia el puerto modificando la variable PORT en .env
      2. Espera 60 segundos o mata el proceso:
         - Windows: 'netstat -ano | findstr :${PORT}' → 'taskkill /PID <ID> /F'
         - Linux/Mac: 'lsof -i :${PORT}' → 'kill -9 <PID>'\n`);
    } else {
      console.error('❌ Error al iniciar el servidor:', err);
    }
    process.exit(1);
  });
};

startServer();

// Exportar para testing
module.exports = { app, pool };