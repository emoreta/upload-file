const fs = require('fs');  // IMPORTANTE: Aquí se importa fs
const express = require("express");
const fileUpload = require("express-fileupload");
const path = require("path");
var cors = require('cors');

const filesPayloadExists = require('./middleware/filesPayloadExists');
const fileExtLimiter = require('./middleware/fileExtLimiter');
const fileSizeLimiter = require('./middleware/fileSizeLimiter');

const PORT = process.env.PORT || 3500;
const url = process.env.URL

const app = express();
app.use(express.json({ limit: '50mb' }));   // Para datos JSON
app.use(express.urlencoded({ limit: '50mb', extended: true }));  // Para formularios

app.use(cors({
    origin: '*'
  }));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.post('/upload',
    fileUpload({ createParentPath: true }),
    filesPayloadExists,
    fileExtLimiter(['.png', '.jpg', '.jpeg']),
    fileSizeLimiter,
    (req, res) => {
        const files = req.files
        console.log(files)

        Object.keys(files).forEach(key => {
            const filepath = path.join(__dirname, 'files', files[key].name)
            files[key].mv(filepath, (err) => {
                if (err) return res.status(500).json({ status: "error", message: err })
            })
        })

        return res.json({ status: 'success', message: Object.keys(files).toString() })
    }
)

// Endpoint para recibir un string JSON y guardarlo en un archivo .json
app.post('/save-json', (req, res) => {
    
    const { jsonString, fileName,pathFile } = req.body || {};

    if (!jsonString || !fileName || !pathFile) {
        return res.status(400).json({ status: "error", message: "jsonString y fileName son obligatorios." });
    }

    try {
        const jsonData = JSON.parse(jsonString);
        const filePath = path.join(__dirname, pathFile, `${fileName}`);
        fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2), 'utf8');
        res.json({ status: "success",url:"https://upload.guabastudio.site/"+pathFile+"/"+fileName, message: `Archivo ${fileName} guardado correctamente.` });
    } catch (error) {
        res.status(500).json({ status: "error", message: "Error al procesar el JSON.", details: error.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));