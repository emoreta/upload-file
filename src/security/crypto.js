const crypto = require('crypto');
const env = require('../config/env');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function encryptionKey() {
  if (!/^[0-9a-f]{64}$/i.test(env.security.encryptionKey)) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY debe contener 64 caracteres hexadecimales');
  }
  return Buffer.from(env.security.encryptionKey, 'hex');
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((item) => item.toString('base64url')).join('.');
}

function decryptSecret(value) {
  const [iv, tag, encrypted] = String(value).split('.').map((item) => Buffer.from(item, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { sha256, randomToken, safeEqual, encryptSecret, decryptSecret };
