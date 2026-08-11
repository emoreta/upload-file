const path = require('path');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '../..');
const nodeEnv = process.env.NODE_ENV || 'development';
dotenv.config({ path: path.join(root, '.env.' + nodeEnv) });
dotenv.config({ path: path.join(root, '.env') });

function bool(name, fallback = false) {
  const value = process.env[name];
  return value == null ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function integer(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) ? value : fallback;
}

function list(name, fallback = []) {
  return (process.env[name] || fallback.join(','))
    .split(',').map((value) => value.trim()).filter(Boolean);
}

module.exports = {
  nodeEnv,
  port: integer('PORT', 3500),
  publicUrl: (process.env.PUBLIC_URL || process.env.URL || 'http://localhost:3500').replace(/\/$/, ''),
  corsOrigins: list('CORS_ORIGINS', ['http://localhost:3000', 'http://localhost:3001']),
  db: {
    host: process.env.DB_HOST || process.env.MYSQLHOST || '127.0.0.1',
    port: integer('DB_PORT', integer('MYSQLPORT', 3306)),
    user: process.env.DB_USER || process.env.MYSQLUSER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS || process.env.MYSQLPASSWORD,
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'guaba_file_service',
    connectionLimit: integer('DB_POOL_SIZE', 10),
  },
  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',
    root: path.resolve(process.env.STORAGE_LOCAL_ROOT || path.join(root, 'storage')),
  },
  security: {
    adminKey: process.env.FILE_ADMIN_KEY || '',
    encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY || '',
    signatureWindowSeconds: integer('SIGNATURE_WINDOW_SECONDS', 300),
  },
  uploads: {
    maxBytes: integer('MAX_UPLOAD_BYTES', 25 * 1024 * 1024),
    sessionTtlSeconds: integer('UPLOAD_SESSION_TTL_SECONDS', 900),
  },
  flags: {
    v1Enabled: bool('FILE_SERVICE_V1_ENABLED', false),
    migrateOnStart: bool('DB_MIGRATE', false),
    legacyEnabled: bool('LEGACY_UPLOAD_ENABLED', true),
  },
};
