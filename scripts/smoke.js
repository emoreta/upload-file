const crypto = require('crypto');
const fs = require('fs/promises');
const { getPool } = require('../src/config/database');
const storage = require('../src/storage/localStorage');

const baseUrl = process.env.PUBLIC_URL || 'http://127.0.0.1:3610';
const adminKey = process.env.FILE_ADMIN_KEY;
const code = `SMOKE_${Date.now()}`;
let application;
let credential;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function json(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${payload.message || JSON.stringify(payload)}`);
  return payload;
}

async function signed(method, route, body) {
  const serialized = body == null ? '' : JSON.stringify(body);
  const contentHash = sha256(serialized);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const canonical = [method, route, timestamp, nonce, contentHash].join('\n');
  const signature = crypto.createHmac('sha256', credential.secret).update(canonical).digest('hex');
  const headers = {
    'x-file-key': credential.keyId,
    'x-file-timestamp': timestamp,
    'x-file-nonce': nonce,
    'x-file-content-sha256': contentHash,
    'x-file-signature': signature,
  };
  if (body != null) headers['content-type'] = 'application/json';
  return json(await fetch(baseUrl + route, { method, headers, body: body == null ? undefined : serialized }));
}

async function cleanup() {
  if (!application) return;
  const pool = getPool();
  const [versions] = await pool.query(
    `SELECT v.id, v.storage_key FROM document_version v JOIN document d ON d.id=v.document_id
     WHERE d.application_id=?`, [application.id],
  );
  for (const version of versions) await storage.remove(version.storage_key).catch(() => {});
  await pool.query('DELETE FROM file_audit WHERE application_id=?', [application.id]);
  await pool.query('DELETE ds FROM file_download_session ds JOIN document_version v ON v.id=ds.version_id JOIN document d ON d.id=v.document_id WHERE d.application_id=?', [application.id]);
  await pool.query('DELETE v FROM document_version v JOIN document d ON d.id=v.document_id WHERE d.application_id=?', [application.id]);
  await pool.query('DELETE FROM file_upload_session WHERE application_id=?', [application.id]);
  await pool.query('DELETE FROM document WHERE application_id=?', [application.id]);
  await pool.query('DELETE FROM document_folder WHERE application_id=?', [application.id]);
  await pool.query('DELETE FROM file_application_policy WHERE application_id=?', [application.id]);
  await pool.query('DELETE FROM file_application_credential WHERE application_id=?', [application.id]);
  await pool.query('DELETE FROM file_application WHERE id=?', [application.id]);
}

(async () => {
  try {
    const created = await json(await fetch(baseUrl + '/v1/admin/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ code, name: 'Smoke test', environment: 'development' }),
    }));
    application = created.application;
    credential = created.credential;

    const session = await signed('POST', '/v1/upload-sessions', {
      purpose: 'GENERAL_DOCUMENT', title: 'Documento de prueba', ownerRef: 'smoke-test',
      mimeType: 'text/plain',
    });
    const form = new FormData();
    form.append('file', new Blob(['contenido documental de prueba'], { type: 'text/plain' }), 'prueba.txt');
    const uploaded = await json(await fetch(session.uploadUrl, { method: 'POST', body: form }));
    const listed = await signed('GET', '/v1/documents?purpose=GENERAL_DOCUMENT', null);
    if (!listed.data.some((item) => item.id === uploaded.document.id)) throw new Error('El documento cargado no aparece en la consulta');

    const download = await signed('POST', `/v1/documents/${uploaded.document.id}/download-sessions`, null);
    const downloaded = await fetch(download.url);
    if (!downloaded.ok || await downloaded.text() !== 'contenido documental de prueba') throw new Error('La descarga privada no coincide');

    console.log('Document Service smoke test completed');
  } finally {
    await cleanup();
    await getPool().end();
  }
})().catch((error) => {
  console.error(`Document Service smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
