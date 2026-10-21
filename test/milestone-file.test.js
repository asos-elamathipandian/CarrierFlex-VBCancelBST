'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { createFilePublicationHandler } = require('../src/milestone-file');
const { parseFile } = require('../src/csv-parser');

async function main() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'milestone-test-'));
  const event = {
    metadata: { eventName: 'FilePublished' },
    data: {
      fileName: 'milestones.csv', source: 'DHL',
      blobUri: 'https://example.blob.core.windows.net/cfs/DHL/milestones.csv?sig=secret',
    },
  };
  const settings = {
    allowedHosts: ['example.blob.core.windows.net'], allowedContainers: ['cfs'],
    maxDownloadBytes: 1024, downloadTimeoutMs: 1000,
  };
  let downloads = 0;
  let downloadedPath;
  const options = {
    settings, stateDir,
    createClient: uri => ({
      download: async () => {
        assert.strictEqual(new URL(uri).hostname, 'example.blob.core.windows.net');
        assert.strictEqual(new URL(uri).search, '?sig=secret');
        downloads++;
        return { readableStreamBody: Readable.from(['ASN,Status\n123,Delivered\n']) };
      },
    }),
    processFile: async (localPath, fileName) => {
      downloadedPath = localPath;
      assert.strictEqual(fileName, 'milestones.csv');
      assert.strictEqual(fs.readFileSync(localPath, 'utf8'), 'ASN,Status\n123,Delivered\n');
      const rows = await parseFile(localPath);
      assert.strictEqual(rows[0].asn, '123');
      return { processed: 1, errors: [] };
    },
  };
  try {
    const handler = createFilePublicationHandler(options);
    assert.throws(() => createFilePublicationHandler({
      ...options, settings: { ...settings, maxDownloadBytes: NaN },
    }), /positive integers/);
    await assert.rejects(handler({ ...event, metadata: {} }), /FilePublished/);
    await assert.rejects(handler({ ...event, data: { ...event.data, blobUri: 'not-a-url' } }), /valid blobUri/);
    await assert.rejects(handler({ ...event, data: { ...event.data, blobUri: 'https://evil.test/cfs/a.csv' } }), /not allowed/);
    await assert.rejects(handler({ ...event, data: {
      ...event.data, blobUri: event.data.blobUri.replace('/cfs/', '/other/'),
    } }), /not allowed/);
    await assert.rejects(handler({ ...event, data: {
      ...event.data, blobUri: event.data.blobUri.replace('https:', 'http:'),
    } }), /not allowed/);
    await assert.rejects(handler({ ...event, data: { ...event.data, fileName: '../bad.csv' } }), /fileName/);
    const failedHandler = createFilePublicationHandler({
      ...options, processFile: async localPath => {
        downloadedPath = localPath;
        return { processed: 1, errors: ['upload failed'] };
      },
    });
    await assert.rejects(failedHandler(event), /processing failed/);
    assert(!fs.existsSync(downloadedPath));
    const results = await Promise.all([handler(event), handler(event)]);
    assert.deepStrictEqual(results, [{ processed: 1, errors: [] }, { duplicate: true }]);
    assert(!fs.existsSync(downloadedPath));
    assert.deepStrictEqual(await handler({ ...event, data: {
      ...event.data, blobUri: event.data.blobUri.replace('secret', 'renewed'),
    } }), { duplicate: true });
    assert.strictEqual(downloads, 2);

    const anotherEvent = { ...event, data: {
      ...event.data, blobUri: event.data.blobUri.replace('milestones.csv?', 'another.csv?'),
    } };
    const downloadFailure = createFilePublicationHandler({
      ...options, createClient: () => ({ download: async () => { throw new Error('sig=secret'); } }),
    });
    await assert.rejects(downloadFailure(anotherEvent), error =>
      /download failed/.test(error.message) && !error.message.includes('secret'));
    const tooLarge = createFilePublicationHandler({
      ...options, settings: { ...settings, maxDownloadBytes: 1 },
    });
    await assert.rejects(tooLarge(anotherEvent), /download failed/);
    const emptyFile = createFilePublicationHandler({
      ...options, processFile: async () => ({ processed: 0, errors: [] }),
    });
    await assert.rejects(emptyFile(anotherEvent), /processing failed/);
    const timeout = createFilePublicationHandler({
      ...options, settings: { ...settings, downloadTimeoutMs: 5 },
      createClient: () => ({ download: async () => ({
        readableStreamBody: new Readable({ read() {} }),
      }) }),
    });
    await assert.rejects(timeout(anotherEvent), /download failed/);
    console.log('milestone-file tests passed');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });