const { getPool } = require('../config/database');

async function audit(req, eventType, values = {}) {
  await getPool().query(
    `INSERT INTO file_audit
      (application_id, document_id, version_id, event_type, actor_type, actor_ref, ip_address, user_agent, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.applicationId || req.fileApplication?.id || null,
      values.documentId || null,
      values.versionId || null,
      eventType,
      values.actorType || (req.fileApplication ? 'application' : 'admin'),
      values.actorRef || req.fileApplication?.code || null,
      req.ip || null,
      req.get('user-agent') || null,
      JSON.stringify(values.details || {}),
    ],
  );
}

module.exports = { audit };
