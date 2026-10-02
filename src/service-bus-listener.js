'use strict';

/**
 * service-bus-listener.js
 *
 * Subscribes to an Azure Service Bus queue or topic subscription that
 * publishes PO/ASN cancellation events. Supported message bodies include:
 *
 *   { "poRefs": ["1234567", "2345678", ...] }
 *   { "PoId": "1234567", "AsnIds": ["49870000005277"] }
 *
 * or a plain JSON array:
 *
 *   ["1234567", "2345678"]
 *
 * For every message received the supplied handler function is called:
 *   handler({ poRefs: string[], asnRefs: string[] }) => Promise<void>
 *
 * On success the message is completed (removed from the queue).
 * On handler error the message is abandoned (returned to the queue for retry).
 */

const { ServiceBusClient } = require('@azure/service-bus');
const cfg = require('./config');

let sbClient   = null;
let receiver   = null;
let isRunning  = false;

function normalizeCancellationRequest(body) {
  let decoded = body;
  if (typeof decoded === 'string') decoded = JSON.parse(decoded);

  if (Array.isArray(decoded)) {
    return { poRefs: decoded.map(String), asnRefs: [] };
  }
  if (!decoded || typeof decoded !== 'object') {
    throw new Error(`Unexpected message format: ${JSON.stringify(body)}`);
  }

  const fields = new Map(Object.entries(decoded).map(([key, value]) => [key.toLowerCase(), value]));
  const poValue = fields.get('porefs') ?? fields.get('poids') ?? fields.get('poid');
  const asnValue = fields.get('asnrefs') ?? fields.get('asnids') ?? fields.get('asnid');
  const toRefs = value => (value === undefined ? [] : (Array.isArray(value) ? value : [value]))
    .map(item => String(item).trim())
    .filter(Boolean);

  return { poRefs: toRefs(poValue), asnRefs: toRefs(asnValue) };
}

/**
 * Start the Service Bus listener.
 *
 * @param {function} handler - async (poRefs: string[]) => void
 */
function start(handler) {
  const { connectionString, queueName, topicName, subscriptionName } = cfg.serviceBus;

  if (!connectionString || connectionString.startsWith('Endpoint=sb://your-namespace')) {
    console.warn('[Service Bus] Connection string not configured — listener disabled.');
    return;
  }

  sbClient = new ServiceBusClient(connectionString);
  const isTopicSubscription = Boolean(subscriptionName);
  receiver = isTopicSubscription
    ? sbClient.createReceiver(topicName, subscriptionName, { receiveMode: 'peekLock' })
    : sbClient.createReceiver(queueName, { receiveMode: 'peekLock' });

  const messageHandler = async (message) => {
    try {
      const request = normalizeCancellationRequest(message.body);

      if (!request.poRefs.length && !request.asnRefs.length) {
        console.warn('[Service Bus] Message contained no PO or ASN refs — completing without processing.');
        await receiver.completeMessage(message);
        return;
      }

      console.log(
        `[Service Bus] Received cancel event: PO(s) [${request.poRefs.join(', ')}], ASN(s) [${request.asnRefs.join(', ')}]`
      );
      await handler(request);
      await receiver.completeMessage(message);
    } catch (err) {
      console.error('[Service Bus] Handler error:', err.message);
      try {
        await receiver.abandonMessage(message);
      } catch (abandonErr) {
        console.error('[Service Bus] Could not abandon message:', abandonErr.message);
      }
    }
  };

  const errorHandler = async (err) => {
    console.error('[Service Bus] Receiver error:', err.message || err);
  };

  receiver.subscribe({ processMessage: messageHandler, processError: errorHandler }, {
    maxConcurrentCalls:     1,     // process one PO cancel event at a time
    autoCompleteMessages:   false, // we complete/abandon manually
  });

  isRunning = true;
  console.log(isTopicSubscription
    ? `[Service Bus] Listening on topic "${topicName}" subscription "${subscriptionName}"…`
    : `[Service Bus] Listening on queue "${queueName}"…`);
}

async function stop() {
  if (receiver) {
    await receiver.close().catch(() => {});
    receiver = null;
  }
  if (sbClient) {
    await sbClient.close().catch(() => {});
    sbClient = null;
  }
  isRunning = false;
  console.log('[Service Bus] Listener stopped.');
}

module.exports = { normalizeCancellationRequest, start, stop, isRunning: () => isRunning };
