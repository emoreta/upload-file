const env = require('../config/env');
const { safeEqual } = require('./crypto');

function adminAuth(req, res, next) {
  if (!env.security.adminKey) return res.status(503).json({ message: 'Administraci?n no configurada' });
  if (!safeEqual(req.get('x-admin-key'), env.security.adminKey)) {
    return res.status(401).json({ message: 'Llave administrativa inv?lida' });
  }
  next();
}

module.exports = { adminAuth };
