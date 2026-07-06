require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const fileUpload = require('express-fileupload');
const cors = require('cors');

const filesPayloadExists = require('./middleware/filesPayloadExists');
const fileExtLimiter = require('./middleware/fileExtLimiter');
const fileSizeLimiter = require('./middleware/fileSizeLimiter');

const PORT = process.env.PORT || 3500;
const URL_BASE = process.env.URL || `http://localhost:${PORT}`;

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: '*' }));

const FILES_DIR = path.join(__dirname, 'files');
const JSON_DIR = path.join(__dirname, 'json_files');

[FILES_DIR, JSON_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ status: 'ok', service: 'upload-file', version: '2.0' });
  }
});

app.post(
  '/upload',
  fileUpload({ createParentPath: true }),
  filesPayloadExists,
  fileExtLimiter(['.png', '.jpg', '.jpeg', '.webp']),
  fileSizeLimiter,
  async (req, res, next) => {
    try {
      const files = req.files;
      const uploaded = [];

      for (const key of Object.keys(files)) {
        const file = files[key];
        const fileName = `${Date.now()}_${file.name}`;
        const filePath = path.join(FILES_DIR, fileName);
        await file.mv(filePath);
        uploaded.push({ originalName: file.name, nombreArchivo: fileName, size: file.size });
      }

      res.json({
        status: 'success',
        archivo: uploaded[0],
        message: `Archivo ${uploaded[0].nombreArchivo} subido correctamente.`,
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post('/save-json', (req, res, next) => {
  const { jsonString, fileName, pathFile } = req.body || {};

  if (!jsonString || !fileName) {
    return res.status(400).json({ status: 'error', message: 'jsonString y fileName son obligatorios.' });
  }

  try {
    const jsonData = JSON.parse(jsonString);
    const targetDir = pathFile ? path.join(__dirname, pathFile) : JSON_DIR;
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const filePath = path.join(targetDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2), 'utf8');
    res.json({
      status: 'success',
      url: `${URL_BASE}/${pathFile || 'json_files'}/${fileName}`,
      message: `Archivo ${fileName} guardado correctamente.`,
    });
  } catch (error) {
    next(error);
  }
});

app.use('/files', express.static(FILES_DIR));

app.use((err, req, res, next) => {
  console.error('[Error]', err.message || err);
  res.status(500).json({ status: 'error', message: err.message || 'Error interno del servidor.' });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en ${URL_BASE}`);
});
