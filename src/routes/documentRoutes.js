const express = require('express');
const fileUpload = require('express-fileupload');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const env = require('../config/env');
const { getPool } = require('../config/database');
const { applicationAuth } = require('../security/applicationAuth');
const { randomToken, sha256 } = require('../security/crypto');
const storage = require('../storage/localStorage');
const { validateFileType } = require('../documents/fileTypes');
const { audit } = require('../services/auditService');

const router = express.Router();

function parsedJson(value, fallback) {
  if (value == null) return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
}

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

async function extractText(file, extension) {
  try {
    if (extension === '.pdf') {
      const result = await pdfParse(file.data);
      return String(result.text || '').slice(0, 2_000_000);
    }
    if (['.txt', '.csv', '.xml', '.json'].includes(extension)) {
      return file.data.toString('utf8').slice(0, 2_000_000);
    }
  } catch {}
  return null;
}

router.post('/upload-sessions', applicationAuth, async (req, res, next) => {
  try {
    const purpose = String(req.body.purpose || '').trim().toUpperCase();
    const [policies] = await getPool().query(
      `SELECT * FROM file_application_policy
       WHERE application_id = ? AND purpose = ? AND status = 'active' LIMIT 1`,
      [req.fileApplication.id, purpose],
    );
    const policy = policies[0];
    if (!policy) return res.status(403).json({ message: 'Prop?sito no habilitado para esta aplicaci?n' });

    if (req.body.documentId) {
      const [documents] = await getPool().query(
        'SELECT id FROM document WHERE id = ? AND application_id = ? AND status = \'active\'',
        [req.body.documentId, req.fileApplication.id],
      );
      if (!documents.length) fail(404, 'Documento no encontrado');
    }
    if (req.body.folderId) {
      const [folders] = await getPool().query(
        'SELECT id FROM document_folder WHERE id = ? AND application_id = ? AND status = \'active\'',
        [req.body.folderId, req.fileApplication.id],
      );
      if (!folders.length) return res.status(404).json({ message: 'Carpeta no encontrada' });
    }

    const token = randomToken(36);
    const ttl = Math.min(Math.max(Number(req.body.ttlSeconds) || env.uploads.sessionTtlSeconds, 60), 3600);
    const expiresAt = new Date(Date.now() + ttl * 1000);
    await getPool().query(
      `INSERT INTO file_upload_session
       (application_id, token_hash, document_id, folder_id, purpose, visibility, owner_ref, title,
        expected_mime_type, expected_max_bytes, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.fileApplication.id, sha256(token), req.body.documentId || null, req.body.folderId || null,
        purpose, policy.visibility, req.body.ownerRef || null, req.body.title || null,
        req.body.mimeType || null, Math.min(Number(req.body.maxBytes) || Number(policy.max_bytes), Number(policy.max_bytes)),
        expiresAt,
      ],
    );
    await audit(req, 'UPLOAD_SESSION_CREATED', { details: { purpose, ownerRef: req.body.ownerRef || null } });
    res.status(201).json({
      token,
      uploadUrl: `${env.publicUrl}/v1/uploads/${token}`,
      expiresAt: expiresAt.toISOString(),
      maxBytes: Number(policy.max_bytes),
      allowedMimeTypes: parsedJson(policy.allowed_mime_types, []),
    });
  } catch (error) { next(error); }
});

router.post('/uploads/:token',
  fileUpload({ createParentPath: false, abortOnLimit: true, limits: { fileSize: env.uploads.maxBytes } }),
  async (req, res, next) => {
    const connection = await getPool().getConnection();
    let storageKey;
    try {
      const file = req.files?.file;
      if (!file || Array.isArray(file)) return res.status(400).json({ message: 'Debe enviar un solo archivo en el campo file' });

      await connection.beginTransaction();
      const [sessions] = await connection.query(
        `SELECT s.*, a.code application_code, p.allowed_mime_types, p.max_bytes policy_max_bytes
         FROM file_upload_session s
         JOIN file_application a ON a.id = s.application_id
         JOIN file_application_policy p ON p.application_id = s.application_id AND p.purpose = s.purpose
         WHERE s.token_hash = ? AND s.status = 'pending' FOR UPDATE`,
        [sha256(req.params.token)],
      );
      const session = sessions[0];
      if (!session) fail(404, 'Sesión de carga inválida o utilizada');
      if (new Date(session.expires_at) <= new Date()) {
        await connection.query("UPDATE file_upload_session SET status='expired' WHERE id=?", [session.id]);
        await connection.commit();
        return res.status(410).json({ message: 'Sesi?n de carga expirada' });
      }
      const maxBytes = Math.min(Number(session.expected_max_bytes), Number(session.policy_max_bytes), env.uploads.maxBytes);
      if (file.size > maxBytes) fail(413, 'Archivo supera el tamaño permitido');

      const allowed = parsedJson(session.allowed_mime_types, []);
      const extension = validateFileType(file, allowed);
      if (session.expected_mime_type && session.expected_mime_type !== file.mimetype) {
        fail(415, 'El tipo de archivo no coincide con la sesión');
      }

      const documentId = session.document_id || crypto.randomUUID();
      let versionNumber = 1;
      if (session.document_id) {
        const [documents] = await connection.query(
          'SELECT current_version_number FROM document WHERE id=? AND application_id=? FOR UPDATE',
          [documentId, session.application_id],
        );
        if (!documents.length) fail(404, 'Documento no encontrado');
        versionNumber = Number(documents[0].current_version_number) + 1;
      } else {
        await connection.query(
          `INSERT INTO document
           (id, application_id, folder_id, title, purpose, visibility, owner_ref, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            documentId, session.application_id, session.folder_id,
            session.title || path.parse(file.name).name, session.purpose, session.visibility,
            session.owner_ref, JSON.stringify({ sourceIp: clientIp(req) }),
          ],
        );
      }

      const versionId = crypto.randomUUID();
      const date = new Date();
      storageKey = [
        session.application_code.toLowerCase(), session.visibility,
        String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, '0'),
        `${versionId}${extension}`,
      ].join('/');
      await storage.put(storageKey, file.data);
      const contentHash = sha256(file.data);
      const textContent = await extractText(file, extension);

      await connection.query(
        `INSERT INTO document_version
         (id, document_id, version_number, storage_driver, storage_key, original_name, mime_type,
          extension, size_bytes, sha256, text_content, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          versionId, documentId, versionNumber, env.storage.driver, storageKey, file.name,
          file.mimetype, extension, file.size, contentHash, textContent, session.owner_ref,
        ],
      );
      await connection.query(
        'UPDATE document SET current_version_number=?, updated_at=CURRENT_TIMESTAMP(3) WHERE id=?',
        [versionNumber, documentId],
      );
      await connection.query(
        "UPDATE file_upload_session SET status='consumed', consumed_at=CURRENT_TIMESTAMP(3) WHERE id=?",
        [session.id],
      );
      await connection.query(
        `INSERT INTO file_audit
         (application_id, document_id, version_id, event_type, actor_type, actor_ref, ip_address, user_agent, details)
         VALUES (?, ?, ?, 'DOCUMENT_VERSION_UPLOADED', 'upload_token', ?, ?, ?, ?)`,
        [
          session.application_id, documentId, versionId, session.owner_ref, clientIp(req),
          req.get('user-agent') || null, JSON.stringify({ versionNumber, sizeBytes: file.size, sha256: contentHash }),
        ],
      );
      await connection.commit();

      res.status(201).json({
        document: {
          id: documentId, versionId, versionNumber, title: session.title || path.parse(file.name).name,
          purpose: session.purpose, visibility: session.visibility, mimeType: file.mimetype,
          sizeBytes: file.size, sha256: contentHash,
          url: session.visibility === 'public' ? `${env.publicUrl}/v1/public/documents/${documentId}` : null,
        },
      });
    } catch (error) {
      await connection.rollback();
      if (storageKey) await storage.remove(storageKey).catch(() => {});
      next(error);
    } finally { connection.release(); }
  },
);

router.get('/documents', applicationAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const params = [req.fileApplication.id];
    let where = "d.application_id=? AND d.status='active'";
    if (req.query.purpose) { where += ' AND d.purpose=?'; params.push(String(req.query.purpose).toUpperCase()); }
    if (req.query.ownerRef) { where += ' AND d.owner_ref=?'; params.push(req.query.ownerRef); }
    if (req.query.folderId) { where += ' AND d.folder_id=?'; params.push(req.query.folderId); }
    if (req.query.q) {
      where += ' AND MATCH(d.title,d.description) AGAINST(? IN BOOLEAN MODE)';
      params.push(`${String(req.query.q).replace(/[^\p{L}\p{N} _-]/gu, '')}*`);
    }
    params.push(limit);
    const [rows] = await getPool().query(
      `SELECT d.*, v.id version_id, v.original_name, v.mime_type, v.size_bytes, v.sha256
       FROM document d JOIN document_version v
       ON v.document_id=d.id AND v.version_number=d.current_version_number
       WHERE ${where} ORDER BY d.updated_at DESC LIMIT ?`,
      params,
    );
    res.json({ data: rows });
  } catch (error) { next(error); }
});

async function sendVersion(res, row) {
  res.type(row.mime_type);
  res.set('Content-Length', String(row.size_bytes));
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.original_name)}`);
  res.set('ETag', `"${row.sha256}"`);
  res.sendFile(storage.pathFor(row.storage_key));
}

router.get('/public/documents/:id', async (req, res, next) => {
  try {
    const [rows] = await getPool().query(
      `SELECT v.* FROM document d JOIN document_version v
       ON v.document_id=d.id AND v.version_number=d.current_version_number
       JOIN file_application a ON a.id=d.application_id
       WHERE d.id=? AND d.visibility='public' AND d.status='active' AND a.status='active' LIMIT 1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ message: 'Documento no encontrado' });
    await sendVersion(res, rows[0]);
  } catch (error) { next(error); }
});

router.get('/documents/:id', applicationAuth, async (req, res, next) => {
  try {
    const sql = [
      'SELECT d.id, d.title, d.description, d.purpose, d.visibility, d.owner_ref, d.folder_id,',
      'd.status, d.current_version_number, d.metadata, d.created_at, d.updated_at,',
      'v.id version_id, v.original_name, v.mime_type, v.extension, v.size_bytes, v.sha256,',
      'v.scan_status, v.scanned_at FROM document d JOIN document_version v',
      'ON v.document_id=d.id AND v.version_number=d.current_version_number',
      "WHERE d.id=? AND d.application_id=? AND d.status='active' LIMIT 1",
    ].join(' ');
    const [rows] = await getPool().query(sql, [req.params.id, req.fileApplication.id]);
    if (!rows.length) return res.status(404).json({ message: 'Documento no encontrado' });
    res.json({ data: rows[0] });
  } catch (error) { next(error); }
});
router.post('/documents/:id/download-sessions', applicationAuth, async (req, res, next) => {
  try {
    const [rows] = await getPool().query(
      `SELECT v.id version_id FROM document d JOIN document_version v
       ON v.document_id=d.id AND v.version_number=d.current_version_number
       WHERE d.id=? AND d.application_id=? AND d.status='active' LIMIT 1`,
      [req.params.id, req.fileApplication.id],
    );
    if (!rows.length) return res.status(404).json({ message: 'Documento no encontrado' });
    const token = randomToken(36);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await getPool().query(
      'INSERT INTO file_download_session (version_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [rows[0].version_id, sha256(token), expiresAt],
    );
    res.status(201).json({ url: `${env.publicUrl}/v1/downloads/${token}`, expiresAt: expiresAt.toISOString() });
  } catch (error) { next(error); }
});

router.get('/downloads/:token', async (req, res, next) => {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT ds.id session_id, ds.expires_at, ds.consumed_at, v.*
       FROM file_download_session ds JOIN document_version v ON v.id=ds.version_id
       JOIN document d ON d.id=v.document_id
       WHERE ds.token_hash=? AND d.status='active' FOR UPDATE`,
      [sha256(req.params.token)],
    );
    const row = rows[0];
    if (!row || row.consumed_at || new Date(row.expires_at) <= new Date()) {
      await connection.rollback();
      return res.status(410).json({ message: 'Enlace de descarga inv?lido o expirado' });
    }
    await connection.query('UPDATE file_download_session SET consumed_at=CURRENT_TIMESTAMP(3) WHERE id=?', [row.session_id]);
    await connection.commit();
    await sendVersion(res, row);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

module.exports = { documentRoutes: router };
