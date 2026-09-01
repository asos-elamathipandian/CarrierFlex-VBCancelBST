'use strict';

/**
 * vb-cancel-pipeline.js
 *
 * Orchestrates the VB Cancellation flow:
 *   1. Receive PO refs (from service-bus-listener)
 *   2. Query Databricks serve tables for active booked ASNs
 *   3. Build a VBKREQ XML per ASN (PurposeCd="01")
 *   4. Write XML to output/
 *   5. Upload to E2open SFTP vbkreq remote dir
 *   6. Log results to state/cancel-log.json
 */

const path = require('path');
const fs   = require('fs');
const cfg  = require('./config');
const { fetchCancelDataByPoRefs } = require('./databricks-cancel-reader');
const { buildCancelXml }         = require('./vbkreq-cancel-builder');
const { uploadVbkreq }           = require('./sftp-e2open');
const { getCarrierProfile }      = require('./carrier-profile');

const LOG_FILE = path.join(cfg.stateDir, 'cancel-log.json');

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
 * Process a PO cancel event — the main entry point called by service-bus-listener.
 *
 * @param {string[]} poRefs - list of PO numbers to cancel bookings for
 * @returns {Promise<{ processed: number, skipped: number, errors: string[] }>}
 */
async function processCancelEvent(poRefs) {
  const startTime = new Date().toISOString();
  console.log(`[VB Cancel] Processing ${poRefs.length} PO ref(s): ${poRefs.join(', ')}`);

  const { bookingRows, errors: fetchErrors } = await fetchCancelDataByPoRefs(poRefs);

  if (fetchErrors.length) {
    console.warn('[VB Cancel] Databricks fetch warnings:', fetchErrors.join('; '));
  }

  if (!bookingRows.length) {
    const msg = `No active bookings found for PO(s): ${poRefs.join(', ')}`;
    console.warn(`[VB Cancel] ${msg}`);
    appendLog({ timestamp: startTime, poRefs, processed: 0, skipped: 0, errors: [msg, ...fetchErrors] });
    return { processed: 0, skipped: 0, errors: [msg, ...fetchErrors] };
  }

  const profile = getCarrierProfile(cfg.carrier);
  fs.mkdirSync(cfg.outputDir, { recursive: true });

  let processed = 0;
  let skipped   = 0;
  const errors  = [...fetchErrors];

  for (const row of bookingRows) {
    try {
      const { xml, filename, bookingRef } = buildCancelXml(row, profile.vbkreqSenderId);

      const outPath = path.join(cfg.outputDir, filename);
      fs.writeFileSync(outPath, xml, 'utf8');
      console.log(`[VB Cancel] Written: ${filename}`);

      const { remotePath, local } = await uploadVbkreq(outPath);
      console.log(`[VB Cancel] Uploaded (${local ? 'LOCAL' : 'SFTP'}): ${remotePath}`);

      appendLog({
        timestamp:  new Date().toISOString(),
        poRefs,
        asnRef:     row.ASN_Ref,
        bookingRef,
        filename,
        remotePath,
        local,
      });

      processed++;
    } catch (err) {
      const msg = `ASN ${row.ASN_Ref}: ${err.message}`;
      console.error(`[VB Cancel] ${msg}`);
      errors.push(msg);
      skipped++;
    }
  }

  console.log(`[VB Cancel] Done — processed: ${processed}, skipped: ${skipped}`);
  return { processed, skipped, errors };
}

module.exports = { processCancelEvent };
