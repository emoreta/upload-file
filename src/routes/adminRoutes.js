const express = require('express');
const crypto = require('crypto');
const { getPool } = require('../config/database');
const { adminAuth } = require('../security/adminAuth');
const { randomToken, sha256, encryptSecret } = require('../security/crypto');
const { allDocumentMimes } = require('../documents/fileTypes');
const { audit } = require('../services/auditService');

const router = express.Router();
router.use(adminAuth);

const imageMimes = ['image/jpeg', 'image/png', 'image/webp'];
const defaults = [
  ['PRODUCT_IMAGE', 'public', 10 * 1024 * 1024, imageMimes],
  ['PROFILE_IMAGE', 'public', 5 * 1024 * 1024, imageMimes],
  ['VEHICLE_IMAGE', 'public', 10 * 1024 * 1024, imageMimes],
  ['GENERAL_DOCUMENT', 'private', 25 * 1024 * 1024, allDocumentMimes],
  ['IDENTITY_DOCUMENT', 'private', 15 * 1024 * 1024, [...imageMimes, 'application/pdf']],
  ['PAYMENT_RECEIPT', 'private', 15 * 1024 * 1024, [...imageMimes, 'application/pdf']],
  ['FISCAL_XML', 'private', 10 * 1024 * 1024, ['application/xml', 'text/xml', 'text/plain']],
  ['FISCAL_PDF', 'private', 15 * 1024 * 1024, ['application/pdf']],
];

router.get('/summary', async (_req, res, next) => {
  try {
    const [[summary]] = await getPool().query(
      `SELECT
       (SELECT COUNT(*) FROM file_application WHERE status='active') applications,
       (SELECT COUNT(*) FROM document WHERE status='active') documents,
       (SELECT COUNT(*) FROM document_version) versions,
       (SELECT COALESCE(SUM(size_bytes),0) FROM document_version) storage_bytes`,
    );
    res.json({ data: summary });
  } catch (error) { next(error); }
});

router.get('/documents', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const [rows] = await getPool().query(
      `SELECT d.id, d.title, d.purpose, d.visibility, d.owner_ref, d.status, d.updated_at,
       a.code application_code, v.original_name, v.mime_type, v.size_bytes, v.sha256, v.version_number
       FROM document d JOIN file_application a ON a.id=d.application_id
       LEFT JOIN document_version v ON v.document_id=d.id AND v.version_number=d.current_version_number
       ORDER BY d.updated_at DESC LIMIT ?`, [limit],
    );
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/audit', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    const [rows] = await getPool().query(
      `SELECT au.id, au.event_type, au.actor_type, au.actor_ref, au.ip_address, au.created_at,
       a.code application_code, d.title document_title, au.details
       FROM file_audit au
       LEFT JOIN file_application a ON a.id=au.application_id
       LEFT JOIN document d ON d.id=au.document_id
       ORDER BY au.created_at DESC LIMIT ?`, [limit],
    );
    res.json({ data: rows });
  } catch (error) { next(error); }
});
router.get('/applications', async (_req, res, next) => {
  try {
    const [rows] = await getPool().query(
      `SELECT a.*, COUNT(DISTINCT c.id) credential_count, COUNT(DISTINCT p.id) policy_count
       FROM file_application a
       LEFT JOIN file_application_credential c ON c.application_id = a.id AND c.status = 'active'
       LEFT JOIN file_application_policy p ON p.application_id = a.id AND p.status = 'active'
       GROUP BY a.id ORDER BY a.created_at DESC`,
    );
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.post('/applications', async (req, res, next) => {
  const connection = await getPool().getConnection();
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const name = String(req.body.name || '').trim();
    const environment = String(req.body.environment || 'development');
    if (!/^[A-Z0-9][A-Z0-9_-]{2,79}$/.test(code) || !name) {
      return res.status(400).json({ message: 'C?digo o nombre inv?lido' });
    }
    if (!['development', 'staging', 'production'].includes(environment)) {
      return res.status(400).json({ message: 'Entorno inv?lido' });
    }

    const secret = randomToken(48);
    const keyId = crypto.randomUUID();
    await connection.beginTransaction();
    const [result] = await connection.query(
      'INSERT INTO file_application (code, name, environment) VALUES (?, ?, ?)',
      [code, name, environment],
    );
    await connection.query(
      `INSERT INTO file_application_credential
       (application_id, key_id, secret_hash, secret_encrypted) VALUES (?, ?, ?, ?)`,
      [result.insertId, keyId, sha256(secret), encryptSecret(secret)],
    );
    for (const [purpose, visibility, maxBytes, mimes] of defaults) {
      await connection.query(
        `INSERT INTO file_application_policy
         (application_id, purpose, visibility, max_bytes, allowed_mime_types)
         VALUES (?, ?, ?, ?, ?)`,
        [result.insertId, purpose, visibility, maxBytes, JSON.stringify(mimes)],
      );
    }
    await connection.commit();
    await audit(req, 'APPLICATION_CREATED', {
      applicationId: result.insertId, actorRef: 'admin', details: { code, environment },
    }).catch((auditError) => console.error('Application audit failed', { errorMessage: auditError.message }));
    res.status(201).json({
      application: { id: result.insertId, code, name, environment },
      credential: { keyId, secret },
      warning: 'El secreto se muestra una sola vez. Gu?rdalo en el backend consumidor.',
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'El c?digo de aplicaci?n ya existe' });
    next(error);
  } finally { connection.release(); }
});

router.post('/applications/:id/credentials', async (req, res, next) => {
  const connection = await getPool().getConnection();
  try {
    const applicationId = Number(req.params.id);
    const [applications] = await connection.query(
      'SELECT id, code FROM file_application WHERE id=? AND status=\'active\' LIMIT 1',
      [applicationId],
    );
    if (!applications.length) return res.status(404).json({ message: 'Aplicación no encontrada' });

    const secret = randomToken(48);
    const keyId = crypto.randomUUID();
    await connection.beginTransaction();
    if (req.body.revokePrevious !== false) {
      await connection.query(
        "UPDATE file_application_credential SET status='revoked' WHERE application_id=? AND status='active'",
        [applicationId],
      );
    }
    await connection.query(
      'INSERT INTO file_application_credential (application_id, key_id, secret_hash, secret_encrypted) VALUES (?, ?, ?, ?)',
      [applicationId, keyId, sha256(secret), encryptSecret(secret)],
    );
    await connection.commit();
    await audit(req, 'APPLICATION_CREDENTIAL_ROTATED', {
      applicationId, actorRef: 'admin', details: { code: applications[0].code },
    }).catch((auditError) => console.error('Credential audit failed', { errorMessage: auditError.message }));

    res.status(201).json({
      credential: { keyId, secret },
      warning: 'El secreto se muestra una sola vez. Guárdalo en el backend consumidor.',
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});
router.get('/applications/:id/policies', async (req, res, next) => {
  try {
    const [rows] = await getPool().query(
      'SELECT * FROM file_application_policy WHERE application_id = ? ORDER BY purpose',
      [req.params.id],
    );
    res.json({ data: rows.map((row) => ({ ...row, allowed_mime_types: typeof row.allowed_mime_types === 'string' ? JSON.parse(row.allowed_mime_types) : row.allowed_mime_types })) });
  } catch (error) { next(error); }
});

router.put('/applications/:id/policies/:purpose', async (req, res, next) => {
  try {
    const visibility = req.body.visibility;
    const maxBytes = Number(req.body.maxBytes);
    const allowedMimeTypes = req.body.allowedMimeTypes;
    if (!['public', 'private'].includes(visibility) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Array.isArray(allowedMimeTypes) || !allowedMimeTypes.length) {
      return res.status(400).json({ message: 'Pol?tica inv?lida' });
    }
    await getPool().query(
      `INSERT INTO file_application_policy
       (application_id, purpose, visibility, max_bytes, allowed_mime_types, status)
       VALUES (?, ?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE visibility=VALUES(visibility), max_bytes=VALUES(max_bytes),
       allowed_mime_types=VALUES(allowed_mime_types), status='active'`,
      [req.params.id, req.params.purpose.toUpperCase(), visibility, maxBytes, JSON.stringify(allowedMimeTypes)],
    );
    res.json({ message: 'Pol?tica actualizada' });
  } catch (error) { next(error); }
});

module.exports = { adminRoutes: router };
