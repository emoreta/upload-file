const fs = require('fs');
const express = require("express");
const fileUpload = require("express-fileupload");
const path = require("path");
var cors = require('cors');
const sharp = require('sharp');

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
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

app.get("/", (req, res) => {
    const indexPath = path.join(__dirname, "index.html");
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.json({ status: 'ok', service: 'upload-file', version: '2.0' });
    }
});

app.post('/upload',
    fileUpload({ createParentPath: true }),
    filesPayloadExists,
    fileExtLimiter(['.png', '.jpg', '.jpeg', '.webp']),
    fileSizeLimiter,
    async (req, res) => {
        if (!req.files || !req.files.file) {
            return res.status(400).json({ status: "error", message: "No file uploaded" });
        }

        try {
            const file = req.files.file;
            const currentDate = new Date();
            const year = currentDate.getFullYear();
            const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            const day = String(currentDate.getDate()).padStart(2, '0');
            const hours = String(currentDate.getHours()).padStart(2, '0');
            const minutes = String(currentDate.getMinutes()).padStart(2, '0');
            const seconds = String(currentDate.getSeconds()).padStart(2, '0');

            const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}`;
            const ext = file.name.split('.').pop().toLowerCase();
            const filename = `${file.name.split('.')[0]}_${timestamp}.jpg`;
            const filepath = path.join(FILES_DIR, filename);

            let buffer = file.data;

            if (ext === 'png' || ext === 'webp' || ext === 'jpg' || ext === 'jpeg') {
                buffer = await sharp(buffer)
                    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 75, mozjpeg: true })
                    .toBuffer();
            }

            fs.writeFileSync(filepath, buffer);

            const originalKB = (file.size / 1024).toFixed(1);
            const compressedKB = (buffer.length / 1024).toFixed(1);

            return res.json({
                status: 'success',
                archivo: {
                    nombreArchivo: filename,
                    urlArchivo: `${URL_BASE}/files/${filename}`,
                    tamañoOriginalKB: parseFloat(originalKB),
                    tamañoFinalKB: parseFloat(compressedKB)
                }
            });
        } catch (err) {
            return res.status(500).json({ status: "error", message: err.message });
        }
    }
);

app.post('/save-json', (req, res) => {
    const { jsonString, fileName, pathFile } = req.body || {};

    if (!jsonString || !fileName || !pathFile) {
        return res.status(400).json({ status: "error", message: "jsonString y fileName son obligatorios." });
    }

    try {
        const jsonData = JSON.parse(jsonString);
        const filePath = path.join(__dirname, pathFile, `${fileName}`);
        fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2), 'utf8');
        res.json({
            status: "success",
            url: `${URL_BASE}/${pathFile}/${fileName}`,
            message: `Archivo ${fileName} guardado correctamente.`
        });
    } catch (error) {
        res.status(500).json({ status: "error", message: "Error al procesar el JSON.", details: error.message });
    }
});

app.use('/files', express.static(FILES_DIR));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
