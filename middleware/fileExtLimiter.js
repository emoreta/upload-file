const path = require('path');

const fileExtLimiter = (allowedExtArray) => {
  return (req, res, next) => {
    const files = req.files;
    const fileExtensions = Object.keys(files).map((key) =>
      path.extname(files[key].name).toLowerCase()
    );

    const allowed = fileExtensions.every((ext) => allowedExtArray.includes(ext));

    if (!allowed) {
      const message = `Upload failed. Only ${allowedExtArray.join(', ')} files allowed.`;
      return res.status(422).json({ status: 'error', message });
    }

    next();
  };
};

module.exports = fileExtLimiter;
