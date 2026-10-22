'use strict';

/**
 * bst-pipeline.js
 *
 * Processes BST input files from Service Bus downloads or the local one-off
 * workflow, then builds, uploads, and logs one BST XML per ASN row.
 */

const path = require('path');
const fs   = require('fs');
const cfg  = require('./config');
const { parseFile }       = require('./csv-parser');
const { writeBstFile }    = require('./bulk-status-builder');
const { uploadBst }       = require('./sftp-e2open');

const LOG_FILE = path.join(cfg.stateDir, 'bst-log.json');

function readLog() {
  try {
    if (fs.existsSync(LOG_FILE)) return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch (_) {}
  return [];
}

function appendLog(entry) {
  const log = readLog();
  log.push(entry);
  fs.mkdirSync(cfg.stateDir, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

/**
 * Process a single carrier file (already downloaded to localPath).
 * Builds and uploads a BST XML for each ASN row inside the file.
 *
 * @param {string} localPath - local path to the downloaded file
 * @param {string} fileName  - original file name (for logging)
 * @returns {{ processed: number, errors: string[] }}
 */
async function processFile(localPath, fileName) {
  const startTime = new Date().toISOString();
  let rows;
  try {
    rows = await parseFile(localPath);
    console.log(`[BST] Parsed ${rows.length} row(s) from "${fileName}"`);
  } catch (parseErr) {
    const msg = `Failed to parse "${fileName}": ${parseErr.message}`;
    console.error(`[BST] ${msg}`);
    appendLog({ timestamp: startTime, fileName, processed: 0, errors: [msg] });
    return { processed: 0, errors: [msg] };
  }

  if (!rows.length) {
    console.warn(`[BST] No valid ASN rows in "${fileName}"`);
    appendLog({ timestamp: startTime, fileName, processed: 0, errors: ['No valid ASN rows found'] });
    return { processed: 0, errors: ['No valid ASN rows found'] };
  }

  let processed = 0;
  const errors  = [];

  for (const row of rows) {
    try {
      const { fileName: xmlName, filePath: xmlPath } = writeBstFile({
        asn:             row.asn,
        carrier:         row.carrier || cfg.carrier,
        handoverLocation: row.handoverLocation,
        dateEvents:      row.dateEvents || {},
        outputDir:       cfg.outputDir,
      });
      console.log(`[BST] Written: ${xmlName}`);

      const { remotePath, local } = await uploadBst(xmlPath);
      console.log(`[BST] Uploaded (${local ? 'LOCAL' : 'SFTP'}): ${remotePath}`);

      appendLog({
        timestamp:  new Date().toISOString(),
        sourceFile: fileName,
        asn:        row.asn,
        poRefs:     row.poRefs || [],
        carrier:    row.carrier || cfg.carrier,
        xmlName,
        remotePath,
        local,
      });

      processed++;
    } catch (err) {
      const msg = `ASN ${row.asn}: ${err.message}`;
      console.error(`[BST] ${msg}`);
      errors.push(msg);
      appendLog({
        timestamp: new Date().toISOString(),
        sourceFile: fileName,
        asn: row.asn,
        poRefs: row.poRefs || [],
        carrier: row.carrier || cfg.carrier,
        errors: [msg],
      });
    }
  }

  console.log(`[BST] File "${fileName}" — processed: ${processed}, errors: ${errors.length}`);
  return { processed, errors };
}

module.exports = { processFile };
