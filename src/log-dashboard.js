'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const cfg = require('./config');

const PORT = Number.parseInt(process.env.LOG_DASHBOARD_PORT || '3100', 10);
const HOST = process.env.LOG_DASHBOARD_HOST || '127.0.0.1';
const DASHBOARD_FILE = path.join(__dirname, '..', 'public', 'index.html');

function readLog(fileName) {
  const filePath = path.join(cfg.stateDir, fileName);
  try {
    const entries = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Could not read ${fileName}: ${error.message}`);
  }
}

function normalizeEntry(entry, type, index) {
  const errors = Array.isArray(entry.errors) ? entry.errors : [];
  const isCancel = type === 'cancel';
  let status = 'info';
  let detail = '';

  if (entry.skipped) {
    status = 'skipped';
    detail = entry.skipReason || 'Skipped by pipeline';
  } else if (errors.length) {
    status = 'failed';
    detail = errors.join(' | ');
  } else if (entry.filename || entry.xmlName) {
    status = entry.local ? 'local' : 'submitted';
    detail = entry.remotePath || (entry.local ? 'Saved locally' : 'Uploaded');
  } else if (Number(entry.processed) > 0) {
    status = 'submitted';
    detail = `${entry.processed} item(s) processed`;
  } else {
    detail = 'No output recorded';
  }

  return {
    id: `${type}-${index}`,
    type,
    timestamp: entry.timestamp || '',
    status,
    asn: entry.asnRef || entry.asn || '',
    poRefs: Array.isArray(entry.poRefs) ? entry.poRefs : [],
    asnRefs: Array.isArray(entry.asnRefs) ? entry.asnRefs : [],
    bookingRef: entry.bookingRef || '',
    fileName: entry.filename || entry.xmlName || entry.fileName || entry.sourceFile || '',
    detail,
    local: Boolean(entry.local),
    processed: Number(entry.processed) || 0,
    skipped: Number(entry.skipped) || 0,
    otherAsns: Array.isArray(entry.sameDayOtherAsns) ? entry.sameDayOtherAsns : [],
    resultLabel: status === 'submitted'
      ? (isCancel ? 'Cancel submitted' : 'BST submitted')
      : '',
    kindLabel: isCancel ? 'VB cancellation' : 'Bulk status',
  };
}

function getLogEntries() {
  const cancellations = readLog('cancel-log.json').map((entry, index) => normalizeEntry(entry, 'cancel', index));
  const bst = readLog('bst-log.json').map((entry, index) => normalizeEntry(entry, 'bst', index));
  return [...cancellations, ...bst].sort(
    (left, right) => Date.parse(right.timestamp || 0) - Date.parse(left.timestamp || 0)
  );
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && requestUrl.pathname === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/logs') {
    try {
      sendJson(response, 200, { entries: getLogEntries(), updatedAt: new Date().toISOString() });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html')) {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    });
    fs.createReadStream(DASHBOARD_FILE).pipe(response);
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`[Log Dashboard] Listening at http://${HOST}:${PORT}`);
  });
}

module.exports = { getLogEntries, normalizeEntry, server };