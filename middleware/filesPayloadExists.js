const filesPayloadExists = (req, res, next) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ status: 'error', message: 'No se envió ningún archivo.' });
  }
  next();
};

module.exports = filesPayloadExists;
