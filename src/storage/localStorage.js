const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');

function absolute(storageKey) {
  const resolved = path.resolve(env.storage.root, storageKey);
  const prefix = env.storage.root.endsWith(path.sep) ? env.storage.root : env.storage.root + path.sep;
  if (!resolved.startsWith(prefix)) throw new Error('Ruta de almacenamiento inv?lida');
  return resolved;
}

async function put(storageKey, buffer) {
  const target = absolute(storageKey);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer, { flag: 'wx' });
}

async function remove(storageKey) {
  await fs.rm(absolute(storageKey), { force: true });
}

function pathFor(storageKey) {
  return absolute(storageKey);
}

module.exports = { put, remove, pathFor };
