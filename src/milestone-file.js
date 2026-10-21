'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { BlobClient } = require('@azure/storage-blob');
const cfg = require('./config');

function createFilePublicationHandler(options = {}) {
  const settings = options.settings || cfg.milestones;
  const stateDir = options.stateDir || cfg.stateDir;
  const createClient = options.createClient || (uri => new BlobClient(uri));
  const processFile = options.processFile || require('./bst-pipeline').processFile;
  if (!Number.isSafeInteger(settings.maxDownloadBytes) || settings.maxDownloadBytes <= 0
    || !Number.isSafeInteger(settings.downloadTimeoutMs) || settings.downloadTimeoutMs <= 0
    || settings.downloadTimeoutMs > 2147483647) {
    throw new Error('Milestone download size and timeout must be positive integers within supported limits');
  }

  async function processFilePublication(event) {
    if (event?.metadata?.eventName !== 'FilePublished') {
      throw new Error('Expected a FilePublished event');
    }
    const { fileName, blobUri, source } = event.data || {};
    if (typeof fileName !== 'string' || !/^[^\\/\x00-\x1f]+\.csv$/i.test(fileName)
      || fileName === '..' || typeof source !== 'string' || !source.trim()) {
      throw new Error('FilePublished requires a CSV fileName and source');
    }
    let url;
    try {
      url = new URL(blobUri);
    } catch (_) {
      throw new Error('FilePublished requires a valid blobUri');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !settings.allowedHosts.includes(url.hostname)
      || !settings.allowedContainers.includes(url.pathname.split('/')[1])) {
      throw new Error('Milestone blob location is not allowed');
    }

    const identity = createHash('sha256').update(url.origin + url.pathname).digest('hex');
    const completedDir = path.join(stateDir, 'milestone-files');
    const completedPath = path.join(completedDir, identity + '.json');
    if (fs.existsSync(completedPath)) return { duplicate: true };

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'carrierflex-milestone-'));
    const localPath = path.join(tempDir, 'input.csv');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.downloadTimeoutMs);
    try {
      try {
        const response = await createClient(blobUri).download(0, undefined, {
          abortSignal: controller.signal,
        });
        let bytes = 0;
        const limit = new Transform({
          transform(chunk, encoding, callback) {
            bytes += chunk.length;
            callback(bytes > settings.maxDownloadBytes
              ? new Error('Milestone CSV exceeds download size limit') : null, chunk);
          },
        });
        await pipeline(response.readableStreamBody, limit, fs.createWriteStream(localPath), {
          signal: controller.signal,
        });
      } catch (_) {
        throw new Error('Milestone CSV download failed; check access, SAS expiry, size limit and timeout');
      } finally {
        clearTimeout(timer);
      }

      const result = await processFile(localPath, fileName);
      if (!result || !result.processed || result.errors?.length) {
        throw new Error('Milestone CSV processing failed; message will be retried');
      }
      await fs.promises.mkdir(completedDir, { recursive: true });
      await fs.promises.writeFile(completedPath, JSON.stringify({
        fileName, source, completedAt: new Date().toISOString(),
      }), { flag: 'wx' });
      return result;
    } finally {
      clearTimeout(timer);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }

  let pending = Promise.resolve();
  return event => {
    const result = pending.then(() => processFilePublication(event));
    pending = result.catch(() => {});
    return result;
  };
}

module.exports = { createFilePublicationHandler };