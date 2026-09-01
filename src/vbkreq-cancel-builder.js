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

function resolveMode(val) {
  if (!val) return '30';
  return MODE_MAP[String(val).toUpperCase().trim()] || String(val).trim() || '30';
}

function pad(v) { return String(v).padStart(2, '0'); }

function nowStr() {
  const n = new Date();
  return `${n.getFullYear()}${pad(n.getMonth()+1)}${pad(n.getDate())} ${pad(n.getHours())}${pad(n.getMinutes())}${pad(n.getSeconds())}`;
}

function nowFilenameStr() {
  return nowStr().replace(' ', '');
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

/** Get the control number (ASOSBOOK-NNNNNNNNN) and increment the counter. */
function nextCtrlNumber() {
  const data = loadJson(COUNTER_FILE, { counter: 200000001 });
  if (!data.counter) data.counter = 200000001;
  const current = data.counter;
  data.counter = current + 1;
  saveJson(COUNTER_FILE, data);
  return `ASOSBOOK-${current}`;
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
  const bookingRef = row.Booking_Ref || row.ASN_Ref || `VB-${row.ASN_Ref}`;
  const version    = getBookingVersion(bookingRef);

  const fcId      = row.FC_ID || 'FC01';
  const destLocode = FC_LOCODE[fcId] || 'GBBSY';
  const modeCode   = resolveMode(row.Mode_Of_Transport);
  const filename   = `${carrierSenderId}_E2ASOS_VBKREQ_1.0_${nowFilenameStr()}${ctrlNumber.replace('ASOSBOOK-', '')}.xml`;

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

  msg.ele('Mode').txt(modeCode);
  msg.ele('Reference', { RefTypeCd: 'QY',  SourceRefTypeCd: '128' }).txt(row.Traffic_Mode || 'CFS');
  msg.ele('Reference', { RefTypeCd: '4B',  SourceRefTypeCd: '128' }).txt(row.Country_Of_Origin || row.Factory_CountryCd || 'XX');
  msg.ele('Reference', { RefTypeCd: 'BH',  SourceRefTypeCd: '128' }).txt(row.Hazardous ? 'Y' : 'N');
  msg.ele('Reference', { RefTypeCd: 'CC',  SourceRefTypeCd: '128' }).txt('Green');
  msg.ele('Reference', { RefTypeCd: 'CD',  SourceRefTypeCd: '128' }).txt(row.Collection_Type || 'Delivery');

  // Supplier (SU)
  if (row.Supplier_Name || row.Supplier_ID) {
    const su = msg.ele('TradePartner', { RoleCd: 'SU' });
    if (row.Supplier_Name) su.ele('TradePartnerName').txt(row.Supplier_Name);
    if (row.Supplier_ID)   su.ele('TradePartnerID', { Qualifier: '93' }).txt(row.Supplier_ID);
  }

  // Factory (FA)
  if (row.Factory_Name || row.Factory_ID) {
    const fa = msg.ele('TradePartner', { RoleCd: 'FA' });
    if (row.Factory_Name)    fa.ele('TradePartnerName').txt(row.Factory_Name);
    if (row.Factory_ID)      fa.ele('TradePartnerID', { Qualifier: '93' }).txt(row.Factory_ID);
    if (row.Factory_CountryCd) {
      fa.ele('TradePartnerAddress').ele('CountryCd').txt(row.Factory_CountryCd);
    }
  }

  // Final Destination (FD)
  const fd    = msg.ele('TradePartner', { RoleCd: 'FD' });
  const fcAddr = FC_ADDRESS[fcId];
  fd.ele('TradePartnerName').txt(fcAddr ? fcAddr.name : (row.FC_Name || fcId));
  fd.ele('TradePartnerID', { Qualifier: '93' }).txt(fcId);
  const addrFD = fd.ele('TradePartnerAddress');
  if (fcAddr) {
    fcAddr.streets.forEach(s => addrFD.ele('Street').txt(s));
    addrFD.ele('City').txt(fcAddr.city);
    addrFD.ele('StateProvinceCd').txt(fcAddr.stateProvinceCd);
    addrFD.ele('PostalCd').txt(fcAddr.postalCd);
    addrFD.ele('CountryCd').txt(fcAddr.countryCd);
  } else {
    addrFD.ele('CountryCd').txt(row.FC_CountryCd || 'GB');
  }

  // Carrier (CA)
  const ca = msg.ele('TradePartner', { RoleCd: 'CA' });
  ca.ele('TradePartnerID', { Qualifier: '93' }).txt(row.Carrier_ID || '3');

  // Loading port
  if (row.Loading_Port_LOCODE) {
    msg.ele('Status')
      .ele('Location', { LocTypeCd: 'L' })
      .ele('LocationID', { Qualifier: 'UN' }).txt(row.Loading_Port_LOCODE);
  }

  msg.ele('Status').ele('Location', { LocTypeCd: 'E' }).ele('LocationID', { Qualifier: 'UN' }).txt(destLocode);
  msg.ele('Status').ele('Location', { LocTypeCd: 'D' }).ele('LocationID', { Qualifier: 'UN' }).txt(destLocode);

  msg.ele('Status').ele('Date', { DateTypeCd: '211',  TimeZone: 'LT' }).txt(now);
  msg.ele('Status').ele('Date', { DateTypeCd: 'OSBT', TimeZone: 'LT' }).txt(now);
  if (row.Ship_Date) {
    msg.ele('Status').ele('Date', { DateTypeCd: '238' }).txt(row.Ship_Date);
  }
  if (row.Expected_Delivery_Date) {
    msg.ele('Status').ele('Date', { DateTypeCd: '065' }).txt(row.Expected_Delivery_Date);
  }
  msg.ele('Status').ele('Date', { DateTypeCd: 'OSBK' }).txt(now);
  msg.ele('Status').ele('Date', { DateTypeCd: 'SBK'  }).txt(now);
  // Cancellation date (mandatory for PurposeCd 01)
  msg.ele('Status').ele('Date', { DateTypeCd: '177',  TimeZone: 'LT' }).txt(now);

  // Document
  const bkqTotal = parseFloat(row.Header_Booking_Qty || row.Booking_Qty || 0);
  const doc = msg.ele('Document', { DocType: 'BOOK', Key: bookingRef });
  doc.ele('Reference', { RefTypeCd: 'ACE', SourceRefTypeCd: '128' }).txt(bookingRef);
  doc.ele('Reference', { RefTypeCd: 'V0',  SourceRefTypeCd: '128' }).txt(version);
  if (bkqTotal > 0) {
    doc.ele('Measure', { Qualifier: 'BKQ', SourceQualifier: '738', SourceUOMCd: '355', UOMCd: 'UN' }).txt(bkqTotal.toFixed(6));
  }

  // Order lines
  const poNum  = row.PO_Number || '';
  const order  = doc.ele('Order', { Key: poNum, OrderType: 'PO' });
  order.ele('OrderID').txt(poNum);

  const skuLines = row._skuLines || [];
  for (const line of skuLines) {
    const li = order.ele('LineItem', { Key: line.sku || line.poId });
    li.ele('Reference', { RefTypeCd: 'BV' }).txt(String(row.ASN_Ref || ''));
    li.ele('OrderID').txt(String(line.poId || poNum));
    if (line.sku) li.ele('ProductID', { Qualifier: 'SK' }).txt(line.sku);
    if (line.qty > 0) {
      li.ele('Measure', { Qualifier: 'BKQ', SourceQualifier: '738', SourceUOMCd: '355', UOMCd: 'UN' }).txt(line.qty.toFixed(6));
    }
  }

  return {
    xml:        root.end({ prettyPrint: false }),
    filename,
    bookingRef,
  };
}

module.exports = { buildCancelXml, setBookingVersion, getBookingVersion };
