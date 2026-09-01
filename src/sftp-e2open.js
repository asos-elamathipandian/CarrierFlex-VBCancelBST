'use strict';

/**
 * sftp-e2open.js
 *
 * Uploads a local file to the E2open SFTP server.
 * Supports both password and private-key (file or inline base64/PEM) auth.
 * Falls back to saving the file locally when SFTP is not configured.
 *
 * Adapted from CarrierBookingStub/backend/sftp-uploader.js and
 * QAsupportKit-Azure/src/sftp.js.
 */

const SftpClient = require('ssh2-sftp-client');
const fs   = require('fs');
const path = require('path');
const cfg  = require('./config');

function resolveKey(content, keyPath) {
  if (content) {
    // Accept raw PEM/PPK or base64-encoded
    const isPem = content.startsWith('-----') || content.startsWith('PuTTY-User-Key-File');
    return isPem ? content.replace(/\\n/g, '\n') : Buffer.from(content, 'base64').toString('utf8');
  }
  if (keyPath) {
    const abs = path.resolve(keyPath);
    if (!fs.existsSync(abs)) throw new Error(`SFTP private key not found: ${abs}`);
    return fs.readFileSync(abs, 'utf8');
  }
  return null;
}

function buildConnectOptions() {
  const { host, port, username, password, privateKeyPath, privateKeyContent, passphrase } = cfg.sftpE2open;

  if (!host || !username) return null; // not configured

  const opts = { host, port, username, readyTimeout: 30000 };
  const key  = resolveKey(privateKeyContent, privateKeyPath);

  if (key) {
    opts.privateKey = key;
    if (passphrase) opts.passphrase = passphrase;
  } else if (password) {
    opts.password = password;
  } else {
    return null; // no auth material
  }
  return opts;
}

/** Save file locally when E2open SFTP is not configured (dev/test mode). */
function saveLocally(localFilePath, remoteDir) {
  const dest = path.join(cfg.outputDir, path.basename(localFilePath));
  if (path.resolve(localFilePath) !== path.resolve(dest)) {
    fs.mkdirSync(cfg.outputDir, { recursive: true });
    fs.copyFileSync(localFilePath, dest);
  }
  console.log(`[SFTP E2open] LOCAL mode — saved to ${dest}`);
  return { remotePath: dest, local: true };
}

/**
 * Upload a file to the E2open SFTP.
 *
 * @param {string} localFilePath  - absolute path of the file to upload
 * @param {string} remoteDir      - remote directory (vbkreqRemoteDir or bstRemoteDir)
 */
async function upload(localFilePath, remoteDir) {
  const opts = buildConnectOptions();
  if (!opts) return saveLocally(localFilePath, remoteDir);

  const sftp       = new SftpClient();
  const remotePath = `${remoteDir.replace(/\/$/, '')}/${path.basename(localFilePath)}`;

  try {
    await sftp.connect(opts);
    await sftp.put(localFilePath, remotePath);
    console.log(`[SFTP E2open] uploaded → ${remotePath}`);
    return { remotePath, local: false };
  } finally {
    await sftp.end();
  }
}

/** Convenience wrappers for each message type. */
async function uploadVbkreq(localFilePath) {
  return upload(localFilePath, cfg.sftpE2open.vbkreqRemoteDir);
}

async function uploadBst(localFilePath) {
  return upload(localFilePath, cfg.sftpE2open.bstRemoteDir);
}

module.exports = { upload, uploadVbkreq, uploadBst };
