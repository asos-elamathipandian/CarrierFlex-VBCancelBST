'use strict';

/**
 * bulk-status-builder.js
 *
 * Builds BST (Bulk Status) XML for a given ASN and writes it to the output
 * directory.  Adapted from QAsupportKit-Azure/src/bulk-status.js.
 *
 * Input: ASN number + optional carrier code.
 * Output: XML file ready for upload to E2open SFTP.
 */

const path = require('path');
const fs   = require('fs');
const { getCarrierProfile } = require('./carrier-profile');
const cfg = require('./config');

function pad(n, size = 2) {
  return String(n).padStart(size, '0');
}

function formatCtrl(d) {
  return [d.getUTCFullYear(), pad(d.getUTCMonth()+1), pad(d.getUTCDate()),
          pad(d.getUTCHours()), pad(d.getUTCMinutes()), pad(d.getUTCSeconds())].join('');
}

function formatTimestamp(d) {
  return [d.getUTCFullYear(), pad(d.getUTCMonth()+1), pad(d.getUTCDate()), ' ',
          pad(d.getUTCHours()), pad(d.getUTCMinutes()), pad(d.getUTCSeconds())].join('');
}

function addSeconds(d, s) {
  return new Date(d.getTime() + s * 1000);
}

function formatDateTimeUtc(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const isoLike = trimmed.replace(/\s+/g, ' ').replace(/\./g, ':');
  const d = new Date(isoLike);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const m = pad(d.getUTCMonth() + 1);
    const day = pad(d.getUTCDate());
    const hh = pad(d.getUTCHours());
    const mi = pad(d.getUTCMinutes());
    const ss = pad(d.getUTCSeconds());
    return `${y}${m}${day} ${hh}${mi}${ss}`;
  }

  const m = trimmed.match(/^(\d{4})(\d{2})(\d{2})(?:\s+(\d{2})(\d{2})(\d{2}))?$/);
  if (m) {
    const [, y, mo, d2, hh = '00', mi = '00', ss = '00'] = m;
    return `${y}${mo}${d2} ${hh}${mi}${ss}`;
  }

  const m2 = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m2) {
    const [, y, mo, d2, hh, mi, ss] = m2;
    return `${y}${mo}${d2} ${hh}${mi}${ss}`;
  }

  return null;
}

function buildEventDates(dateEvents = {}) {
  const entries = [];
  const orderedCodes = ['VBKC', 'HNDOVR', 'SO', 'A', 'RLSC', 'QARD'];

  for (const code of orderedCodes) {
    const value = dateEvents[code];
    const formatted = formatDateTimeUtc(value);
    if (formatted) {
      entries.push(`<Date DateTypeCd="${code}" TimeZone="UTC">${formatted}</Date>`);
    }
  }

  return entries.join('\n');
}

/**
 * Build BST XML string for the given ASN.
 * handoverLocation: UN/LOCODE for the handover point (defaults to TRIST — Istanbul).
 */
function buildBstXml({ asn, carrier = 'DT', handoverLocation = 'TRIST', now = new Date(), dateEvents = {} }) {
  const profile   = getCarrierProfile(carrier);
  const ctrl      = formatCtrl(now);
  const timestamp = formatTimestamp(now);
  const handover  = formatTimestamp(addSeconds(now, 3));
  const eventDates = buildEventDates(dateEvents);

  return (
    `<XMLBundle>\n` +
    `<XMLTransmission CtrlNumber="${ctrl}" Receiver="${profile.receiver}" Sender="${profile.sender}" Timestamp="${timestamp}">\n` +
    `<XMLGroup CtrlNumber="${ctrl}" GroupType="BP" IncludedMessages="1">\n` +
    `<XMLTransaction CtrlNumber="${asn}" TransactionType="BPM-BST">\n` +
    `<BpMessage MessageType="BST">\n` +
    `<Mode>30</Mode>\n` +
    `<Status>\n` +
    `${eventDates || `<Date DateTypeCd="HNDOVR" TimeZone="UTC">${handover}</Date>`}\n` +
    `<Location LocTypeCd="EA">\n` +
    `<LocationID Qualifier="UN">${handoverLocation}</LocationID>\n` +
    `</Location>\n` +
    `</Status>\n` +
    `<Document DocType="SHIP" Key="${asn}">\n` +
    `<DocumentID>${asn}</DocumentID>\n` +
    `</Document>\n` +
    `</BpMessage>\n` +
    `</XMLTransaction>\n` +
    `</XMLGroup>\n` +
    `</XMLTransmission>\n` +
    `</XMLBundle>\n`
  );
}

/**
 * Build BST XML and write it to outputDir.
 * Returns { fileName, filePath, xmlContent }.
 */
function writeBstFile({ asn, carrier = 'DT', handoverLocation = 'TRIST', outputDir, dateEvents = {} }) {
  const now     = new Date();
  const profile = getCarrierProfile(carrier);
  const xml     = buildBstXml({ asn, carrier, handoverLocation, now, dateEvents });
  const ts      = formatCtrl(now);
  const fileName = `${profile.filePrefix}_E2ASOS_BulkStatus_1.0_${ts}_${asn}.xml`;
  const dir     = path.resolve(outputDir || cfg.outputDir);
  const filePath = path.join(dir, fileName);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, xml, 'utf8');

  return { fileName, filePath, xmlContent: xml };
}

module.exports = { buildBstXml, writeBstFile };
