'use strict';

/**
 * csv-parser.js
 *
 * Parses CSV or Excel files downloaded from the carrier SFTP.
 * Extracts rows into a normalised structure for the BST pipeline.
 *
 * Expected columns (case-insensitive, flexible naming):
 *   ASN / ASN_Number / ShipmentRef / Shipment_ID → asn
 *   Carrier / Carrier_Code                        → carrier  (optional, defaults to CARRIER_CODE env)
 *   HandoverLocation / Handover_Location / LOCODE → handoverLocation (optional, defaults to TRIST)
 *
 * Supports:
 *   .csv  — parsed with csv-parse
 *   .xlsx / .xls — parsed with exceljs
 */

const fs      = require('fs');
const path    = require('path');
const { parse } = require('csv-parse/sync');
const ExcelJS   = require('exceljs');
const cfg       = require('./config');

// Column name aliases (lower-cased header → canonical field)
const ASN_ALIASES = ['asn', 'asn_number', 'asnnumber', 'shipmentref', 'shipment_id', 'shipmentid', 'shipment_ref'];
const CARRIER_ALIASES = ['carrier', 'carrier_code', 'carriercode'];
const LOCATION_ALIASES = ['handoverlocation', 'handover_location', 'locode', 'location'];

function normaliseHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[\s-]/g, '_');
}

function pick(row, aliases) {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== '') return String(row[alias]).trim();
  }
  return null;
}

function normaliseRow(rawRow) {
  // Build a lower-cased keyed copy
  const row = {};
  for (const [k, v] of Object.entries(rawRow)) {
    row[normaliseHeader(k)] = v;
  }

  const asn             = pick(row, ASN_ALIASES);
  const carrier         = pick(row, CARRIER_ALIASES) || cfg.carrier;
  const handoverLocation = pick(row, LOCATION_ALIASES) || 'TRIST';

  return asn ? { asn, carrier, handoverLocation } : null;
}

/** Parse a CSV file and return normalised rows. */
function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const records = parse(content, {
    columns:          true,
    skip_empty_lines: true,
    trim:             true,
  });
  return records.map(normaliseRow).filter(Boolean);
}

/** Parse an Excel file (.xlsx / .xls) and return normalised rows. */
async function parseExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.xlsx') {
    await workbook.xlsx.readFile(filePath);
  } else {
    // .xls — ExcelJS reads via xlsx internally
    await workbook.xlsx.readFile(filePath);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  // First row = headers
  const headers = [];
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col - 1] = String(cell.value || '').trim();
  });

  const rows = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header
    const obj = {};
    row.eachCell((cell, col) => {
      const header = headers[col - 1];
      if (header) obj[header] = cell.value !== null && cell.value !== undefined ? String(cell.value).trim() : '';
    });
    const normalised = normaliseRow(obj);
    if (normalised) rows.push(normalised);
  });

  return rows;
}

/**
 * Parse a carrier SFTP file (CSV or Excel) into normalised BST input rows.
 * Returns [{ asn, carrier, handoverLocation }]
 */
async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') {
    return parseCsv(filePath);
  }
  if (ext === '.xlsx' || ext === '.xls') {
    return parseExcel(filePath);
  }
  throw new Error(`Unsupported file extension: ${ext}`);
}

module.exports = { parseFile };
