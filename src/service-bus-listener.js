'use strict';

/**
 * service-bus-listener.js
 *
 * Subscribes to an Azure Service Bus queue or topic subscription that
 * publishes PO/ASN cancellations or FilePublished CSV events. Cancellation bodies include:
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

const listeners = [];

function normalizeCancellationRequest(body) {
  let decoded = body;
  if (Buffer.isBuffer(decoded)) decoded = decoded.toString('utf8');
  if (typeof decoded === 'string') {
    try {
      decoded = JSON.parse(decoded);
    } catch (_) {
      throw new Error('Service Bus message must contain valid JSON');
    }
  }

  if (Array.isArray(decoded)) {
    return { poRefs: decoded.map(String), asnRefs: [] };
  }
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('Unexpected Service Bus message format');
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
 * @param {object} receiver - receiver used to settle the message
 * @param {function} handler - async ({ poRefs, asnRefs }) => void
 * @param {function} fileHandler - async (FilePublished event) => void
 */
function createMessageHandler(receiver, handler, fileHandler) {
  return async (message) => {
    try {
      let body = message.body;
      if (Buffer.isBuffer(body)) body = body.toString('utf8');
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch (_) {
          throw new Error('Service Bus message must contain valid JSON');
        }
      }
      if (body?.metadata?.eventName === 'FilePublished' || body?.data?.blobUri) {
        if (!fileHandler) throw new Error('File publication handler is not configured');
        await fileHandler(body);
        await receiver.completeMessage(message);
        return;
      }
      if (!handler) throw new Error('Expected a FilePublished message on the milestones subscription');
      const request = normalizeCancellationRequest(body);

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
}

function start(handler, fileHandler, settings = cfg.serviceBus) {
  const { connectionString, queueName, topicName, subscriptionName } = settings;

  if (!connectionString || connectionString.startsWith('Endpoint=sb://your-namespace')) {
    console.warn('[Service Bus] Connection string not configured; listener disabled.');
    return;
  }
  if (subscriptionName && !topicName) {
    throw new Error('Service Bus topic name is required with a subscription name');
  }

  const sbClient = new ServiceBusClient(connectionString);
  const isTopicSubscription = Boolean(subscriptionName);
  const receiver = isTopicSubscription
    ? sbClient.createReceiver(topicName, subscriptionName, {
      receiveMode: 'peekLock', maxAutoLockRenewalDurationInMs: 20 * 60 * 1000,
    })
    : sbClient.createReceiver(queueName, {
      receiveMode: 'peekLock', maxAutoLockRenewalDurationInMs: 20 * 60 * 1000,
    });
  listeners.push({ sbClient, receiver });
  const messageHandler = createMessageHandler(receiver, handler, fileHandler);

  const errorHandler = async (err) => {
    console.error('[Service Bus] Receiver error:', err.message || err);
  };

  receiver.subscribe({ processMessage: messageHandler, processError: errorHandler }, {
    maxConcurrentCalls:     1,     // process one event at a time
    autoCompleteMessages:   false, // we complete/abandon manually
  });

  console.log(isTopicSubscription
    ? `[Service Bus] Listening on topic "${topicName}" subscription "${subscriptionName}"…`
    : `[Service Bus] Listening on queue "${queueName}"…`);
}

async function stop() {
  for (const { receiver, sbClient } of listeners.splice(0)) {
    await receiver.close().catch(() => {});
    await sbClient.close().catch(() => {});
  }
  console.log('[Service Bus] Listener stopped.');
}

module.exports = { normalizeCancellationRequest, createMessageHandler, start, stop, isRunning: () => listeners.length > 0 };
