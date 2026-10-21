'use strict';

const assert = require('assert');
const { normalizeCancellationRequest, createMessageHandler } = require('../src/service-bus-listener');

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

async function runRoutingTests() {
  const settled = [];
  const calls = [];
  const receiver = {
    completeMessage: async message => settled.push(['complete', message.messageId]),
    abandonMessage: async message => settled.push(['abandon', message.messageId]),
  };
  const handler = createMessageHandler(receiver,
    async request => calls.push(['cancel', request]),
    async event => {
      if (event.data.fail) throw new Error('download failed');
      calls.push(['file', event]);
    });
  const event = { metadata: { eventName: 'FilePublished' }, data: { fileName: 'test.csv' } };
  await handler({ messageId: 'file', body: JSON.stringify(event) });
  await handler({ messageId: 'buffer', body: Buffer.from(JSON.stringify(event)) });
  await handler({ messageId: 'cancel', body: { PoId: 'PO-1' } });
  await handler({ messageId: 'failed', body: { ...event, data: { fail: true } } });
  await handler({ messageId: 'invalid', body: '{invalid json' });
  const filesOnly = createMessageHandler(receiver, null, async () => {});
  await filesOnly({ messageId: 'wrong-topic', body: { PoId: 'PO-1' } });
  assert.deepStrictEqual(calls, [
    ['file', event], ['file', event], ['cancel', { poRefs: ['PO-1'], asnRefs: [] }],
  ]);
  assert.deepStrictEqual(settled, [
    ['complete', 'file'], ['complete', 'buffer'], ['complete', 'cancel'],
    ['abandon', 'failed'], ['abandon', 'invalid'], ['abandon', 'wrong-topic'],
  ]);
  console.log('service-bus-listener tests passed');
}

runRoutingTests().catch(error => { console.error(error); process.exitCode = 1; });