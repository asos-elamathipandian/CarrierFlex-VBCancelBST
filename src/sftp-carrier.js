'use strict';

/**
 * sftp-carrier.js
 *
 * Lists, downloads, and archives CSV/Excel files from the new carrier SFTP
 * that act as the BST source input.
 *
 * Remote layout (configurable via CARRIER_SFTP_REMOTE_DIR):
 *   /outbound/bst/
 *     ├─ shipments_20260901.csv
 *     ├─ shipments_20260901.xlsx
 *     └─ ...
 *
 * After successful processing, each file is moved to an "archive" sub-folder
 * so it is not re-processed on the next poll.
 */

const SftpClient = require('ssh2-sftp-client');
const path = require('path');
const fs   = require('fs');
const cfg  = require('./config');

// Supported file extensions for BST source files.
const SUPPORTED_EXTS = new Set(['.csv', '.xlsx', '.xls']);

function resolveKey(content, keyPath) {
  if (content) {
    const isPem = content.startsWith('-----') || content.startsWith('PuTTY-User-Key-File');
    return isPem ? content.replace(/\\n/g, '\n') : Buffer.from(content, 'base64').toString('utf8');
  }
  if (keyPath) {
    const abs = path.resolve(keyPath);
    if (!fs.existsSync(abs)) throw new Error(`Carrier SFTP private key not found: ${abs}`);
    return fs.readFileSync(abs, 'utf8');
  }
  return null;
}

function buildConnectOptions() {
  const { host, port, username, password, privateKeyPath, privateKeyContent, passphrase } = cfg.sftpCarrier;

  if (!host || !username) return null;

  const opts = { host, port, username, readyTimeout: 30000 };
  const key  = resolveKey(privateKeyContent, privateKeyPath);

  if (key) {
    opts.privateKey = key;
    if (passphrase) opts.passphrase = passphrase;
  } else if (password) {
    opts.password = password;
  } else {
    return null;
  }
  return opts;
}

function isConfigured() {
  return !!(cfg.sftpCarrier.host && cfg.sftpCarrier.username);
}

/**
 * List CSV/Excel files in the carrier SFTP remote directory.
 * Returns [{ name, path, size }]
 */
async function listFiles(sftp, remoteDir) {
  const items = await sftp.list(remoteDir);
  return items
    .filter(item => item.type === '-' && SUPPORTED_EXTS.has(path.extname(item.name).toLowerCase()))
    .map(item => ({
      name: item.name,
      path: `${remoteDir.replace(/\/$/, '')}/${item.name}`,
      size: item.size,
    }));
}

/**
 * Download a remote file to a local temp path.
 * Returns the local file path.
 */
async function downloadFile(sftp, remotePath, localDir) {
  fs.mkdirSync(localDir, { recursive: true });
  const localPath = path.join(localDir, path.basename(remotePath));
  await sftp.get(remotePath, localPath);
  return localPath;
}

/**
 * Move a processed file to an archive sub-folder on the carrier SFTP.
 * Creates the archive folder if it does not exist.
 */
async function archiveFile(sftp, remotePath) {
  const dir     = path.dirname(remotePath).replace(/\\/g, '/');
  const name    = path.basename(remotePath);
  const archDir = `${dir}/archive`;
  try {
    await sftp.mkdir(archDir, true); // true = mkdir -p
  } catch (_) {}
  await sftp.rename(remotePath, `${archDir}/${name}`);
}

/**
 * Poll the carrier SFTP for new BST source files.
 * For each file: download it, invoke onFile(localPath, fileName), then archive.
 *
 * @param {function} onFile - async (localPath: string, fileName: string) => void
 */
async function pollAndProcess(onFile) {
  if (!isConfigured()) {
    console.log('[Carrier SFTP] Not configured — skipping poll.');
    return [];
  }

  const opts      = buildConnectOptions();
  if (!opts) {
    console.warn('[Carrier SFTP] No auth material configured — skipping poll.');
    return [];
  }

  const sftp      = new SftpClient();
  const remoteDir = cfg.sftpCarrier.remoteDir;
  const localTmp  = path.join(cfg.stateDir, 'carrier-sftp-tmp');

  try {
    await sftp.connect(opts);
    const files = await listFiles(sftp, remoteDir);

    if (!files.length) {
      console.log('[Carrier SFTP] No new files found.');
      return [];
    }

    console.log(`[Carrier SFTP] ${files.length} file(s) found: ${files.map(f => f.name).join(', ')}`);
    const processed = [];

    for (const file of files) {
      try {
        const localPath = await downloadFile(sftp, file.path, localTmp);
        console.log(`[Carrier SFTP] Downloaded: ${file.name}`);
        await onFile(localPath, file.name);
        await archiveFile(sftp, file.path);
        console.log(`[Carrier SFTP] Archived: ${file.name}`);
        processed.push(file.name);
      } catch (err) {
        console.error(`[Carrier SFTP] Failed to process "${file.name}": ${err.message}`);
      }
    }

    return processed;
  } finally {
    await sftp.end();
  }
}

module.exports = { pollAndProcess, isConfigured };
