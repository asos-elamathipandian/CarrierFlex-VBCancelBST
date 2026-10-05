'use strict';

const assert = require('assert');
const { getServerOptions, normalizeEntry } = require('../src/log-dashboard');

assert.deepStrictEqual(
  getServerOptions({ PORT: '8080', WEBSITE_HOSTNAME: 'carrierflex.azurewebsites.net' }),
  { port: 8080, host: '0.0.0.0' }
);
assert.deepStrictEqual(
  getServerOptions({ PORT: '\\\\.\\pipe\\iisnode-test', WEBSITE_HOSTNAME: 'carrierflex.azurewebsites.net' }),
  { port: '\\\\.\\pipe\\iisnode-test', host: undefined }
);
assert.deepStrictEqual(getServerOptions({}), { port: 3100, host: '127.0.0.1' });

const submittedCancel = normalizeEntry({
  timestamp: '2026-10-01T08:00:00.000Z',
  asnRef: 'ASN-1',
  poRefs: ['PO-1', 'PO-2'],
  bookingRef: 'VB-100',
  filename: 'cancel.xml',
  remotePath: '/out/cancel.xml',
  local: false,
}, 'cancel', 0);
assert.strictEqual(submittedCancel.status, 'submitted');
assert.strictEqual(submittedCancel.kindLabel, 'VB cancellation');
assert.strictEqual(submittedCancel.resultLabel, 'Cancel submitted');
assert.deepStrictEqual(submittedCancel.poRefs, ['PO-1', 'PO-2']);

const skippedCancel = normalizeEntry({
  skipped: true,
  skipReason: 'Shared VB booking',
  sameDayOtherAsns: [{ asns: ['ASN-2'] }],
}, 'cancel', 1);
assert.strictEqual(skippedCancel.status, 'skipped');
assert.strictEqual(skippedCancel.detail, 'Shared VB booking');
assert.deepStrictEqual(skippedCancel.otherAsns[0].asns, ['ASN-2']);

const failedCancel = normalizeEntry({ errors: ['Upload failed'] }, 'cancel', 2);
assert.strictEqual(failedCancel.status, 'failed');

const localBst = normalizeEntry({ xmlName: 'bst.xml', local: true }, 'bst', 0);
assert.strictEqual(localBst.status, 'local');
assert.strictEqual(localBst.kindLabel, 'Bulk status');

const submittedBst = normalizeEntry({ asn: 'ASN-3', poRefs: ['PO-3'], xmlName: 'bst.xml' }, 'bst', 1);
assert.strictEqual(submittedBst.resultLabel, 'BST submitted');
assert.deepStrictEqual(submittedBst.poRefs, ['PO-3']);

console.log('log-dashboard tests passed');