'use strict';

/**
 * index.js — CarrierFlex VB Cancel + BST entry point
 *
 * Starts Service Bus listeners for cancellations and milestone CSV publications,
 * plus the optional carrier SFTP poller for BST generation.
 */

const cfg = require('./config');

const sbListener      = require('./service-bus-listener');
const { processCancelEvent } = require('./vb-cancel-pipeline');
const { startPoller } = require('./bst-pipeline');
const { startDashboard, stopDashboard } = require('./log-dashboard');
const { createFilePublicationHandler } = require('./milestone-file');

async function main() {
  console.log('=== CarrierFlex VB Cancel + BST service starting ===');

  await startDashboard();

  // 1. Start Azure Service Bus listeners.
  const processFilePublication = createFilePublicationHandler();
  sbListener.start(processCancelEvent, processFilePublication);
  if (cfg.milestones.serviceBus.subscriptionName) {
    sbListener.start(null, processFilePublication, cfg.milestones.serviceBus);
  }

  // 2. Start carrier SFTP poller for BST source files.
  if (cfg.sftpCarrier.enabled) startPoller();

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
