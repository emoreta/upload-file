const path = require('path');

const types = {
  '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'],
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword', 'application/octet-stream'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
  '.xls': ['application/vnd.ms-excel', 'application/octet-stream'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'],
  '.txt': ['text/plain'], '.csv': ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
  '.xml': ['application/xml', 'text/xml', 'text/plain'], '.json': ['application/json', 'text/plain'],
};

const allDocumentMimes = [...new Set(Object.values(types).flat())];

function extensionOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function validateFileType(file, allowedMimeTypes) {
  const extension = extensionOf(file.name);
  const expected = types[extension];
  if (!expected) throw Object.assign(new Error('Extensi?n de archivo no permitida'), { status: 415 });
  const declared = String(file.mimetype || '').toLowerCase();
  if (!expected.includes(declared)) throw Object.assign(new Error('El tipo MIME no coincide con la extensi?n'), { status: 415 });
  if (!allowedMimeTypes.includes(declared) && !allowedMimeTypes.includes('*/*')) {
    throw Object.assign(new Error('Tipo de archivo no permitido para este prop?sito'), { status: 415 });
  }
  return extension;
}

module.exports = { allDocumentMimes, extensionOf, validateFileType };
