'use strict';

/**
 * vbkreq-cancel-builder.js
 *
 * Builds VBKREQ XML with PurposeCd="01" (cancellation) from rows returned
 * by databricks-cancel-reader.js.
 *
 * Booking version tracking:  persists in state/booking-versions.json so
 * that the cancel message carries the same version as the original booking.
 * If no prior version is found, defaults to "1.0".
 *
 * Adapted from CarrierBookingStub/backend/vbkreq-builder.js.
 */

const { create }  = require('xmlbuilder2');
const fs          = require('fs');
const path        = require('path');
const cfg         = require('./config');

const VERSIONS_FILE = path.join(cfg.stateDir, 'booking-versions.json');
const COUNTER_FILE  = path.join(cfg.stateDir, 'ctrl-counter.json');

// FC → UN/LOCODE destination
const FC_LOCODE = {
  'FC01': 'GBBSY',
  'FC02': 'GBLIC',
  'FC03': 'GBHEM',
  'FC04': 'DEBER',
  'FC05': 'USPHL',
  'P005': 'GBBSY',
};

const FC_ADDRESS = {
  'FC01': { name: 'FC01 Barnsley', streets: ['Greater London House', 'Hampstead Road', 'London'], city: 'London', stateProvinceCd: 'Yorkshire', postalCd: 'NW1 7FB', countryCd: 'GB' },
};

const MODE_MAP = {
  '10': '10', '30': '30', '40': '40', '50': '50', '60': '60', '70': '70',
  'SEA': '10', 'OCEAN': '10', 'FCL': '10', 'LCL': '10',
  'ROAD': '30', 'TRUCK': '30',
  'AIR': '40',
  'RAIL': '50',
  'ECO': '70',
};

function resolveBookingRef(row) {
  const raw = row && row.Booking_Ref;
  const val = String(raw || '').trim();
  if (/^VB-\d+$/i.test(val)) return val.toUpperCase();
  throw new Error('Missing valid VB booking reference from the outbound 856 ACE reference');
}

function resolveMode(val) {
  if (!val) return '30';
  return MODE_MAP[String(val).toUpperCase().trim()] || String(val).trim() || '30';
}

function pad(v) { return String(v).padStart(2, '0'); }

function nowStr() {
  const n = new Date();
  return `${n.getFullYear()}${pad(n.getMonth()+1)}${pad(n.getDate())} ${pad(n.getHours())}${pad(n.getMinutes())}${pad(n.getSeconds())}`;
}

// Strip hyphens from YYYY-MM-DD to YYYYMMDD for E2open date fields.
function ymd(val) {
  return String(val || '').replace(/-/g, '');
}

function nowFilenameStr() {
  return nowStr().replace(' ', '');
}

function filenameSuffixFromCtrlNumber(ctrlNumber) {
  const digits = String(ctrlNumber || '').replace(/\D+/g, '');
  if (!digits) return '000000000';
  return digits.slice(-9).padStart(9, '0');
}

function ensureStateDir() {
  fs.mkdirSync(cfg.stateDir, { recursive: true });
}

function loadJson(file, defaultVal) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {}
  return defaultVal;
}

function saveJson(file, data) {
  ensureStateDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/** Get the control number (ASOSCXL-NNNNNNNNN) and increment the counter. */
function nextCtrlNumber() {
  const data = loadJson(COUNTER_FILE, { counter: 400000001 });
  if (!data.counter) data.counter = 400000001;
  const current = data.counter;
  data.counter = current + 1;
  saveJson(COUNTER_FILE, data);
  return `ASOSCXL-${current}`;
}

/**
 * Look up the stored version for a booking ref.
 * For cancellations purposeCd='01' the version is NOT incremented.
 * Defaults to "1.0" if no prior version found.
 */
function getBookingVersion(bookingRef) {
  const data = loadJson(VERSIONS_FILE, {});
  return `${data[bookingRef] || 1}.0`;
}

/**
 * Store a new booking version (used by booking creation flows elsewhere).
 * Exposed so external pipelines can register versions when they create bookings.
 */
function setBookingVersion(bookingRef, version) {
  const data = loadJson(VERSIONS_FILE, {});
  data[bookingRef] = version;
  saveJson(VERSIONS_FILE, data);
}

// Carton type dimensions (same master as CarrierBookingStub).
const CARTON_TYPES = {
  'BDCM1': { weight: 1.40, L: 60.00, W: 30.00, H: 40.00 },
  'BDCM3': { weight: 1.00, L: 45.00, W: 29.50, H: 18.80 },
  'C5':    { weight: 1.00, L: 60.00, W: 30.00, H: 20.00 },
  'A1':    { weight: 1.00, L: 59.50, W: 28.50, H: 37.50 },
  'B1':    { weight: 1.00, L: 52.00, W: 25.50, H: 37.50 },
  'C1':    { weight: 1.00, L: 45.00, W: 28.50, H: 37.50 },
};

/**
 * Build a VBKREQ cancellation XML string from a single booking row
 * (as returned by databricks-cancel-reader).
 *
 * @param {object} row       - booking row (vbkreq field names)
 * @param {string} carrierSenderId - SFTP/EDI sender ID for the XML header
 * @returns {{ xml: string, filename: string, bookingRef: string }}
 */
function buildCancelXml(row, carrierSenderId = 'DAVIESTN') {
  const now        = nowStr();
  const ctrlNumber = nextCtrlNumber();
  const bookingRef = resolveBookingRef(row);
  const version    = getBookingVersion(bookingRef);
  const filename   = `${carrierSenderId}_E2ASOS_VBKREQ_1.0_${nowFilenameStr()}${filenameSuffixFromCtrlNumber(ctrlNumber)}.xml`;

  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('XMLBundle');

  const tx = root.ele('XMLTransmission', {
    CtrlNumber: ctrlNumber,
    Receiver:   carrierSenderId,
    Sender:     'E2ASOS',
    Timestamp:  now,
  });

  const grp = tx.ele('XMLGroup', { CtrlNumber: ctrlNumber, GroupType: 'BP', IncludedMessages: '1' });
  const trx = grp.ele('XMLTransaction', { CtrlNumber: ctrlNumber, TransactionType: 'BPM-VBKREQ' });
  const msg = trx.ele('BpMessage', { MessageType: 'VBKREQ', PurposeCd: '01' });

  if (row.Supplier_Name || row.Supplier_ID) {
    const su = msg.ele('TradePartner', { RoleCd: 'SU' });
    if (row.Supplier_Name) su.ele('TradePartnerName').txt(row.Supplier_Name);
    if (row.Supplier_ID)   su.ele('TradePartnerID', { Qualifier: '93' }).txt(row.Supplier_ID);
  }

  const ca = msg.ele('TradePartner', { RoleCd: 'CA' });
  ca.ele('TradePartnerID', { Qualifier: '93' }).txt(row.Carrier_ID || '3');

  msg.ele('Status').ele('Date', { DateTypeCd: '177', TimeZone: 'LT' }).txt(now);

  const doc = msg.ele('Document', { DocType: 'BOOK', Key: bookingRef });
  doc.ele('Reference', { RefTypeCd: 'ACE', SourceRefTypeCd: '128' }).txt(bookingRef);
  doc.ele('Reference', { RefTypeCd: 'V0', SourceRefTypeCd: '128' }).txt(version);

  const poNum = row.PO_Number || '';
  const asnRef = row.ASN_Ref || '';
  const order = doc.ele('Order', { Key: poNum, OrderType: 'PO' });
  order.ele('OrderID').txt(poNum);

  const skuLines = row._skuLines || [];
  for (const line of skuLines) {
    const lineKey = `${line.poId}_${line.sku}_${line.asnId || asnRef}`;
    const li = order.ele('LineItem', { Key: lineKey });
    li.ele('Attribute', { AttributeTypeCd: 'SI' }).txt(line.asnId || asnRef);
  }

  return {
    xml:        root.end({ prettyPrint: false }),
    filename,
    bookingRef,
  };
}

module.exports = { buildCancelXml, setBookingVersion, getBookingVersion };
