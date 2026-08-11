const mysql = require('mysql2/promise');
const env = require('./env');

let pool;

function getPool() {
  if (!pool) {
    if (!env.db.user) throw new Error('DB_USER es obligatorio');
    pool = mysql.createPool({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.database,
      connectionLimit: env.db.connectionLimit,
      waitForConnections: true,
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: 'Z',
    });
  }
  return pool;
}

async function ping() {
  const connection = await getPool().getConnection();
  try { await connection.ping(); } finally { connection.release(); }
}

module.exports = { getPool, ping };
