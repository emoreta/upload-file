# Guaba File Service

Servicio transversal de archivos y base de gestor documental para m?ltiples aplicaciones. Conserva el endpoint legado durante la migraci?n, pero la API `/v1` usa aplicaciones aisladas, pol?ticas, HMAC, sesiones de carga/descarga, documentos versionados y auditor?a.

## Capacidades

- Im?genes JPG, PNG y WebP.
- PDF, Word (DOC/DOCX), Excel (XLS/XLSX), TXT, CSV, XML y JSON.
- Pol?ticas configurables por aplicaci?n y prop?sito.
- Documentos p?blicos y privados.
- Carpetas jer?rquicas, etiquetas y metadatos en el modelo.
- Versiones inmutables con SHA-256.
- Extracci?n inicial de texto para PDF, TXT, CSV, XML y JSON.
- Enlaces privados de descarga de un solo uso.
- Consola administrativa en `/admin`.
- Almacenamiento local compatible con Spaceship y contrato preparado para otros drivers.

## Configuraci?n local

1. Copiar `.env.example` a `.env.development` y completar valores.
2. Crear la base `guaba_file_service`.
3. Ejecutar `npm run db:migrate`.
4. Activar `FILE_SERVICE_V1_ENABLED=true`.
5. Iniciar con `npm start`.

Las migraciones son idempotentes. `DB_MIGRATE=true` puede utilizarse durante el primer despliegue; despu?s conviene desactivarlo y ejecutar migraciones como una tarea controlada.

## Autenticaci?n entre servicios

El secreto de una aplicaci?n vive ?nicamente en su backend. El frontend solicita a su propio API una sesi?n temporal y luego carga el archivo usando el token recibido.

Encabezados HMAC:

- `x-file-key`
- `x-file-timestamp` (Unix en segundos)
- `x-file-nonce` (UUID nuevo por solicitud)
- `x-file-content-sha256`
- `x-file-signature`

Cadena can?nica:

```text
METHOD
/original/path?query
TIMESTAMP
NONCE
SHA256(JSON.stringify(body) o cadena vac?a)
```

La firma es el HMAC-SHA256 hexadecimal de esa cadena.

## Flujo de carga

1. El backend consumidor firma `POST /v1/upload-sessions`.
2. File Service devuelve un token temporal y `uploadUrl`.
3. El navegador env?a `multipart/form-data` con el archivo en el campo `file`.
4. Se crea el documento (o una versi?n nueva) y se devuelve su identificador estable.
5. Para documentos privados, el backend firma `POST /v1/documents/:id/download-sessions`.

## Spaceship

Configure todas las variables del ejemplo en la aplicaci?n Node. Para datos persistentes use una ruta absoluta fuera del directorio reemplazado por cada despliegue, por ejemplo `/home/CPANEL_USER/guaba-file-storage`.

Durante la transici?n mantenga:

```env
FILE_SERVICE_V1_ENABLED=true
LEGACY_UPLOAD_ENABLED=true
```

Cuando Guaba Market, Fiscal EC y los dem?s consumidores usen sesiones v1, cambie `LEGACY_UPLOAD_ENABLED=false`.

Healthchecks:

- `GET /health/live`
- `GET /health/ready`

## Seguridad pendiente antes de producci?n masiva

El servicio valida extensi?n, MIME declarado, tama?o y pol?tica. Para un gestor documental expuesto a usuarios externos debe agregarse an?lisis antivirus (ClamAV o proveedor administrado) y, para Office, detecci?n de macros/archivos cifrados. El esquema ya contempla el estado `quarantined` mediante el flujo de evoluci?n del servicio.
