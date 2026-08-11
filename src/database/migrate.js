const { getPool } = require('../config/database');

const statements = [
  `CREATE TABLE IF NOT EXISTS file_application (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(160) NOT NULL,
    environment ENUM('development','staging','production') NOT NULL DEFAULT 'development',
    status ENUM('active','suspended') NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id), UNIQUE KEY uq_file_application_code (code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS file_application_credential (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    application_id BIGINT UNSIGNED NOT NULL,
    key_id CHAR(36) NOT NULL,
    secret_hash CHAR(64) NOT NULL,
    secret_encrypted TEXT NULL,
    status ENUM('active','revoked') NOT NULL DEFAULT 'active',
    last_used_at DATETIME(3) NULL,
    expires_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id), UNIQUE KEY uq_file_credential_key (key_id),
    KEY ix_file_credential_application (application_id),
    CONSTRAINT fk_file_credential_application FOREIGN KEY (application_id) REFERENCES file_application(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS file_application_policy (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    application_id BIGINT UNSIGNED NOT NULL,
    purpose VARCHAR(60) NOT NULL,
    visibility ENUM('public','private') NOT NULL DEFAULT 'private',
    max_bytes BIGINT UNSIGNED NOT NULL,
    allowed_mime_types JSON NOT NULL,
    retention_days INT UNSIGNED NULL,
    status ENUM('active','disabled') NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id), UNIQUE KEY uq_file_policy_app_purpose (application_id, purpose),
    CONSTRAINT fk_file_policy_application FOREIGN KEY (application_id) REFERENCES file_application(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS document_folder (
    id CHAR(36) NOT NULL,
    application_id BIGINT UNSIGNED NOT NULL,
    parent_id CHAR(36) NULL,
    name VARCHAR(180) NOT NULL,
    slug VARCHAR(180) NOT NULL,
    description VARCHAR(500) NULL,
    status ENUM('active','archived','deleted') NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id), UNIQUE KEY uq_document_folder_path (application_id, parent_id, slug),
    KEY ix_document_folder_parent (parent_id),
    CONSTRAINT fk_document_folder_application FOREIGN KEY (application_id) REFERENCES file_application(id),
    CONSTRAINT fk_document_folder_parent FOREIGN KEY (parent_id) REFERENCES document_folder(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS document (
    id CHAR(36) NOT NULL,
    application_id BIGINT UNSIGNED NOT NULL,
    folder_id CHAR(36) NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    purpose VARCHAR(60) NOT NULL,
    visibility ENUM('public','private') NOT NULL DEFAULT 'private',
    owner_ref VARCHAR(160) NULL,
    status ENUM('active','archived','deleted') NOT NULL DEFAULT 'active',
    current_version_number INT UNSIGNED NOT NULL DEFAULT 0,
    metadata JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    deleted_at DATETIME(3) NULL,
    PRIMARY KEY (id), KEY ix_document_app_purpose (application_id, purpose, created_at),
    KEY ix_document_folder (folder_id),
    FULLTEXT KEY fx_document_title_description (title, description),
    CONSTRAINT fk_document_application FOREIGN KEY (application_id) REFERENCES file_application(id),
    CONSTRAINT fk_document_folder FOREIGN KEY (folder_id) REFERENCES document_folder(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS document_version (
    id CHAR(36) NOT NULL,
    document_id CHAR(36) NOT NULL,
    version_number INT UNSIGNED NOT NULL,
    storage_driver VARCHAR(30) NOT NULL,
    storage_key VARCHAR(500) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(160) NOT NULL,
    extension VARCHAR(20) NULL,
    size_bytes BIGINT UNSIGNED NOT NULL,
    sha256 CHAR(64) NOT NULL,
    text_content MEDIUMTEXT NULL,
    metadata JSON NULL,
    scan_status ENUM('pending','clean','infected','failed','skipped') NOT NULL DEFAULT 'skipped',
    scanned_at DATETIME(3) NULL,
    scan_details JSON NULL,
    created_by VARCHAR(160) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id), UNIQUE KEY uq_document_version_number (document_id, version_number),
    UNIQUE KEY uq_document_storage_key (storage_driver, storage_key),
    KEY ix_document_version_sha (sha256),
    FULLTEXT KEY fx_document_version_text (text_content),
    CONSTRAINT fk_document_version_document FOREIGN KEY (document_id) REFERENCES document(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS document_tag (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    application_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(80) NOT NULL,
    color CHAR(7) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id), UNIQUE KEY uq_document_tag_name (application_id, name),
    CONSTRAINT fk_document_tag_application FOREIGN KEY (application_id) REFERENCES file_application(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS document_tag_link (
    document_id CHAR(36) NOT NULL,
    tag_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (document_id, tag_id),
    CONSTRAINT fk_document_tag_link_document FOREIGN KEY (document_id) REFERENCES document(id),
    CONSTRAINT fk_document_tag_link_tag FOREIGN KEY (tag_id) REFERENCES document_tag(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS file_upload_session (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    application_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    document_id CHAR(36) NULL,
    folder_id CHAR(36) NULL,
    purpose VARCHAR(60) NOT NULL,
    visibility ENUM('public','private') NOT NULL DEFAULT 'private',
    owner_ref VARCHAR(160) NULL,
    title VARCHAR(255) NULL,
    expected_mime_type VARCHAR(160) NULL,
    expected_max_bytes BIGINT UNSIGNED NOT NULL,
    status ENUM('pending','consumed','expired','revoked') NOT NULL DEFAULT 'pending',
    expires_at DATETIME(3) NOT NULL,
    consumed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id), UNIQUE KEY uq_upload_session_token (token_hash),
    KEY ix_upload_session_app_status (application_id, status),
    CONSTRAINT fk_upload_session_application FOREIGN KEY (application_id) REFERENCES file_application(id),
    CONSTRAINT fk_upload_session_document FOREIGN KEY (document_id) REFERENCES document(id),
    CONSTRAINT fk_upload_session_folder FOREIGN KEY (folder_id) REFERENCES document_folder(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS file_download_session (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    version_id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    consumed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id), UNIQUE KEY uq_download_session_token (token_hash),
    CONSTRAINT fk_download_session_version FOREIGN KEY (version_id) REFERENCES document_version(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS file_audit (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    application_id BIGINT UNSIGNED NULL,
    document_id CHAR(36) NULL,
    version_id CHAR(36) NULL,
    event_type VARCHAR(60) NOT NULL,
    actor_type VARCHAR(30) NOT NULL,
    actor_ref VARCHAR(160) NULL,
    ip_address VARCHAR(64) NULL,
    user_agent VARCHAR(500) NULL,
    details JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id), KEY ix_file_audit_app_created (application_id, created_at),
    KEY ix_file_audit_document_created (document_id, created_at),
    CONSTRAINT fk_file_audit_application FOREIGN KEY (application_id) REFERENCES file_application(id),
    CONSTRAINT fk_file_audit_document FOREIGN KEY (document_id) REFERENCES document(id),
    CONSTRAINT fk_file_audit_version FOREIGN KEY (version_id) REFERENCES document_version(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function ensureColumn(pool, table, column, definition) {
  const [[result]] = await pool.query(
    `SELECT COUNT(*) total FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [table, column],
  );
  if (!Number(result.total)) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

async function migrate() {
  const pool = getPool();
  for (const statement of statements) await pool.query(statement);
  await ensureColumn(pool, 'document_version', 'scan_status',
    `ENUM('pending','clean','infected','failed','skipped') NOT NULL DEFAULT 'skipped' AFTER metadata`);
  await ensureColumn(pool, 'document_version', 'scanned_at',
    'DATETIME(3) NULL AFTER scan_status');
  await ensureColumn(pool, 'document_version', 'scan_details',
    'JSON NULL AFTER scanned_at');
}

module.exports = { migrate };
