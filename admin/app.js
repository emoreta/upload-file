const state = { key: sessionStorage.getItem('fileAdminKey') || '', view: 'overview' };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const bytes = (value) => {
  const number = Number(value) || 0;
  if (number < 1024) return number + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = number / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return size.toFixed(size >= 10 ? 1 : 2) + ' ' + units[index];
};
const date = (value) => value
  ? new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '?';

async function api(path, options = {}) {
  const response = await fetch('/v1/admin' + path, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-admin-key': state.key, ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    logout();
    throw new Error('Llave administrativa inv?lida');
  }
  if (!response.ok) throw new Error(payload.message || 'No fue posible completar la operaci?n');
  return payload;
}

function table(headers, rows) {
  if (!rows.length) return '<div class="empty">No hay informaci?n para mostrar.</div>';
  return '<table><thead><tr>' + headers.map((header) => '<th>' + header + '</th>').join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
}

function showCredential(credential) {
  $('#created-key').textContent = credential.keyId;
  $('#created-secret').textContent = credential.secret;
  $('#secret-dialog').showModal();
}

async function loadSummary() {
  const [{ data: summary }, { data: documents }] = await Promise.all([
    api('/summary'),
    api('/documents?limit=8'),
  ]);
  $('#summary').innerHTML = [
    ['Aplicaciones', summary.applications],
    ['Documentos', summary.documents],
    ['Versiones', summary.versions],
    ['Almacenamiento', bytes(summary.storage_bytes)],
  ].map(([label, value]) => `<div class="card metric"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`).join('');
  $('#recent-documents').innerHTML = renderDocuments(documents);
}

function renderDocuments(rows) {
  return table(
    ['Documento', 'Aplicaci?n', 'Prop?sito', 'Tipo', 'Tama?o', 'Actualizado'],
    rows.map((row) => `<tr><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.application_code)}</td><td><span class="badge ${row.visibility}">${escapeHtml(row.purpose)}</span></td><td>${escapeHtml(row.mime_type || '?')}</td><td>${bytes(row.size_bytes)}</td><td>${date(row.updated_at)}</td></tr>`),
  );
}

async function loadApplications() {
  const { data } = await api('/applications');
  $('#applications').innerHTML = table(
    ['Aplicaci?n', 'C?digo', 'Entorno', 'Credenciales', 'Pol?ticas', 'Estado', 'Acci?n'],
    data.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td><code>${escapeHtml(row.code)}</code></td><td>${escapeHtml(row.environment)}</td><td>${row.credential_count}</td><td>${row.policy_count}</td><td><span class="badge">${escapeHtml(row.status)}</span></td><td><button class="secondary" data-rotate="${row.id}">Regenerar credencial</button></td></tr>`),
  );
}

async function loadDocuments() {
  const { data } = await api('/documents?limit=100');
  $('#documents').innerHTML = renderDocuments(data);
}

async function loadAudit() {
  const { data } = await api('/audit?limit=150');
  $('#audit').innerHTML = table(
    ['Evento', 'Aplicaci?n', 'Actor', 'Documento', 'IP', 'Fecha'],
    data.map((row) => `<tr><td>${escapeHtml(row.event_type)}</td><td>${escapeHtml(row.application_code || '?')}</td><td>${escapeHtml(row.actor_ref || row.actor_type)}</td><td>${escapeHtml(row.document_title || '?')}</td><td>${escapeHtml(row.ip_address || '?')}</td><td>${date(row.created_at)}</td></tr>`),
  );
}

async function refresh(view = state.view) {
  $('#status').textContent = 'Actualizando?';
  try {
    if (view === 'overview') await loadSummary();
    if (view === 'applications') await loadApplications();
    if (view === 'documents') await loadDocuments();
    if (view === 'audit') await loadAudit();
    $('#status').textContent = 'Conectado';
  } catch (error) {
    $('#status').textContent = error.message;
    throw error;
  }
}

function showWorkspace() {
  $('#login').classList.add('hidden');
  $('#workspace').classList.remove('hidden');
  refresh().catch(() => {});
}

function logout() {
  sessionStorage.removeItem('fileAdminKey');
  state.key = '';
  $('#workspace').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  state.key = $('#admin-key').value.trim();
  try {
    await api('/summary');
    sessionStorage.setItem('fileAdminKey', state.key);
    $('#login-error').textContent = '';
    showWorkspace();
  } catch (error) {
    $('#login-error').textContent = error.message;
  }
});

$('#logout').addEventListener('click', logout);

document.querySelectorAll('nav button').forEach((button) => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  document.querySelectorAll('nav button').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden'));
  $('#view-' + state.view).classList.remove('hidden');
  $('#page-title').textContent = button.textContent;
  refresh().catch(() => {});
}));

document.querySelectorAll('[data-refresh]').forEach((button) => button.addEventListener('click', () => refresh(button.dataset.refresh)));
$('#new-app').addEventListener('click', () => $('#app-dialog').showModal());

$('#app-form').addEventListener('submit', async (event) => {
  const submitter = event.submitter;
  if (submitter?.value === 'cancel') return;
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#create-app');
  button.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(form));
    const created = await api('/applications', { method: 'POST', body: JSON.stringify(body) });
    $('#app-dialog').close();
    form.reset();
    showCredential(created.credential);
    await loadApplications();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

$('#applications').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-rotate]');
  if (!button) return;
  if (!confirm('La credencial anterior ser? revocada. ?Deseas continuar?')) return;
  button.disabled = true;
  try {
    const created = await api(`/applications/${button.dataset.rotate}/credentials`, {
      method: 'POST',
      body: JSON.stringify({ revokePrevious: true }),
    });
    showCredential(created.credential);
    await loadApplications();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
  const text = $('#' + button.dataset.copy).textContent;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    const previous = button.textContent;
    button.textContent = 'Copiado';
    setTimeout(() => { button.textContent = previous; }, 1200);
  } catch {
    alert('No fue posible copiar. Selecciona el valor manualmente.');
  }
}));

$('#close-secret').addEventListener('click', () => $('#secret-dialog').close());
if (state.key) showWorkspace();
