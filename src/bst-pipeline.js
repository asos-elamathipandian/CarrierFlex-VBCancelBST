'use strict';

/**
 * bst-pipeline.js
 *
 * Orchestrates the BST (Bulk Status) flow:
 *   1. Poll carrier SFTP for new CSV/Excel files
 *   2. Parse each file to extract ASN rows
 *   3. Build BST XML for every ASN
 *   4. Write XML to output/
 *   5. Upload to E2open SFTP bst remote dir
 *   6. Log results to state/bst-log.json
 *
 * The poller is driven by node-cron at the interval set by
 * CARRIER_SFTP_POLL_MINUTES (default: 15 min).
 */

const path = require('path');
const fs   = require('fs');
const cron = require('node-cron');
const cfg  = require('./config');
const { pollAndProcess }  = require('./sftp-carrier');
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

/**
 * Run one poll cycle: download all new files from carrier SFTP and process them.
 */
async function runPollCycle() {
  console.log('[BST] Poll cycle started.');
  try {
    await pollAndProcess(async (localPath, fileName) => {
      await processFile(localPath, fileName);
    });
  } catch (err) {
    console.error('[BST] Poll cycle error:', err.message);
  }
  console.log('[BST] Poll cycle complete.');
}

/**
 * Start the BST poller using node-cron.
 * Runs immediately on start, then at every configured interval.
 */
function startPoller() {
  const minutes = cfg.sftpCarrier.pollMinutes;
  const cronExpr = `*/${minutes} * * * *`;

  // Run once immediately on startup, then on schedule.
  runPollCycle();

  cron.schedule(cronExpr, runPollCycle);
  console.log(`[BST] Carrier SFTP poller scheduled every ${minutes} minute(s).`);
}

module.exports = { startPoller, runPollCycle, processFile };
