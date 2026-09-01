'use strict';

/**
 * service-bus-listener.js
 *
 * Subscribes to an Azure Service Bus queue that publishes PO cancellation
 * events.  Each message is expected to be a JSON body of the shape:
 *
 *   { "poRefs": ["1234567", "2345678", ...] }
 *
 * or a plain JSON array:
 *
 *   ["1234567", "2345678"]
 *
 * For every message received the supplied handler function is called:
 *   handler(poRefs: string[]) => Promise<void>
 *
 * On success the message is completed (removed from the queue).
 * On handler error the message is abandoned (returned to the queue for retry).
 */

const { ServiceBusClient } = require('@azure/service-bus');
const cfg = require('./config');

let sbClient   = null;
let receiver   = null;
let isRunning  = false;

/**
 * Start the Service Bus listener.
 *
 * @param {function} handler - async (poRefs: string[]) => void
 */
function start(handler) {
  const { connectionString, queueName, maxMessages } = cfg.serviceBus;

  if (!connectionString || connectionString.startsWith('Endpoint=sb://your-namespace')) {
    console.warn('[Service Bus] Connection string not configured — listener disabled.');
    return;
  }

  sbClient = new ServiceBusClient(connectionString);
  receiver = sbClient.createReceiver(queueName, { receiveMode: 'peekLock' });

  const messageHandler = async (message) => {
    let poRefs;
    try {
      const body = message.body;
      if (Array.isArray(body)) {
        poRefs = body.map(String);
      } else if (body && Array.isArray(body.poRefs)) {
        poRefs = body.poRefs.map(String);
      } else if (typeof body === 'string') {
        const parsed = JSON.parse(body);
        poRefs = Array.isArray(parsed) ? parsed.map(String) : (parsed.poRefs || []).map(String);
      } else {
        throw new Error(`Unexpected message format: ${JSON.stringify(body)}`);
      }

      if (!poRefs.length) {
        console.warn('[Service Bus] Message contained empty poRefs — completing without processing.');
        await receiver.completeMessage(message);
        return;
      }

      console.log(`[Service Bus] Received cancel event for ${poRefs.length} PO(s): ${poRefs.join(', ')}`);
      await handler(poRefs);
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
  console.log(`[Service Bus] Listening on queue "${queueName}"…`);
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

module.exports = { start, stop, isRunning: () => isRunning };
