const crypto = require('crypto');
const { getPool } = require('../config/database');
const env = require('../config/env');
const { decryptSecret, safeEqual, sha256 } = require('./crypto');

const nonces = new Map();

function pruneNonces(now) {
  for (const [key, expires] of nonces) if (expires <= now) nonces.delete(key);
}

async function applicationAuth(req, res, next) {
  try {
    const keyId = req.get('x-file-key');
    const timestamp = req.get('x-file-timestamp');
    const nonce = req.get('x-file-nonce');
    const signature = req.get('x-file-signature');
    const contentHash = req.get('x-file-content-sha256') || sha256('');
    if (!keyId || !timestamp || !nonce || !signature) {
      return res.status(401).json({ message: 'Credenciales de aplicaci?n incompletas' });
    }

    const requestTime = Number(timestamp);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(requestTime) || Math.abs(nowSeconds - requestTime) > env.security.signatureWindowSeconds) {
      return res.status(401).json({ message: 'Firma expirada' });
    }

    const calculatedBodyHash = sha256(req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : '');
    if (!safeEqual(contentHash, calculatedBodyHash)) {
      return res.status(401).json({ message: 'Contenido firmado no coincide' });
    }

    pruneNonces(Date.now());
    const nonceKey = `${keyId}:${nonce}`;
    if (nonces.has(nonceKey)) return res.status(409).json({ message: 'Solicitud repetida' });

    const [rows] = await getPool().query(
      `SELECT c.id credential_id, c.secret_encrypted, c.expires_at, a.*
       FROM file_application_credential c
       JOIN file_application a ON a.id = c.application_id
       WHERE c.key_id = ? AND c.status = 'active' AND a.status = 'active' LIMIT 1`,
      [keyId],
    );
    const credential = rows[0];
    if (!credential || (credential.expires_at && new Date(credential.expires_at) <= new Date())) {
      return res.status(401).json({ message: 'Credencial inv?lida' });
    }

    const canonical = [req.method.toUpperCase(), req.originalUrl, timestamp, nonce, contentHash].join('\n');
    const expected = crypto.createHmac('sha256', decryptSecret(credential.secret_encrypted)).update(canonical).digest('hex');
    if (!safeEqual(expected, signature)) return res.status(401).json({ message: 'Firma inv?lida' });

    nonces.set(nonceKey, Date.now() + env.security.signatureWindowSeconds * 1000);
    req.fileApplication = { id: credential.id, code: credential.code, name: credential.name };
    getPool().query('UPDATE file_application_credential SET last_used_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [credential.credential_id]).catch(() => {});
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { applicationAuth };
