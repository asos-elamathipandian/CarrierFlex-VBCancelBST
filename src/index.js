'use strict';

/**
 * index.js — CarrierFlex VB Cancel + BST entry point
 *
 * Starts two concurrent processes:
 *   1. Azure Service Bus listener  → triggers VBKREQ cancellation pipeline
 *   2. Carrier SFTP poller (cron)  → triggers BST generation pipeline
 */

require('./config'); // loads .env on require

const sbListener      = require('./service-bus-listener');
const { processCancelEvent } = require('./vb-cancel-pipeline');
const { startPoller } = require('./bst-pipeline');
const { startDashboard, stopDashboard } = require('./log-dashboard');

async function main() {
  console.log('=== CarrierFlex VB Cancel + BST service starting ===');

  await startDashboard();

  // 1. Start Azure Service Bus listener for VB cancellations.
  sbListener.start(processCancelEvent);

  // 2. Start carrier SFTP poller for BST source files.
  startPoller();

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[Shutdown] Signal ${signal} received — stopping…`);
    await Promise.all([sbListener.stop(), stopDashboard()]);
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log('=== Service ready ===');
}

main().catch(err => {
  console.error('Fatal startup error:', err.message);
  process.exit(1);
});
