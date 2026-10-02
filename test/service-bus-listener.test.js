'use strict';

const assert = require('assert');
const { normalizeCancellationRequest } = require('../src/service-bus-listener');

assert.deepStrictEqual(
  normalizeCancellationRequest({ PoId: '10200375991', AsnIds: ['42152201407698'] }),
  { poRefs: ['10200375991'], asnRefs: ['42152201407698'] }
);
assert.deepStrictEqual(
  normalizeCancellationRequest('{"PoId":"10200375991","AsnIds":["42152201407698"]}'),
  { poRefs: ['10200375991'], asnRefs: ['42152201407698'] }
);
assert.deepStrictEqual(
  normalizeCancellationRequest({ poRefs: ['PO-1'], asnRefs: ['ASN-1'] }),
  { poRefs: ['PO-1'], asnRefs: ['ASN-1'] }
);
assert.deepStrictEqual(
  normalizeCancellationRequest(['PO-1', 'PO-2']),
  { poRefs: ['PO-1', 'PO-2'], asnRefs: [] }
);
assert.deepStrictEqual(
  normalizeCancellationRequest({ PoId: ' ', AsnIds: [] }),
  { poRefs: [], asnRefs: [] }
);

console.log('service-bus-listener tests passed');