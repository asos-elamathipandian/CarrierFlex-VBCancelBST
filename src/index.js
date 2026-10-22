'use strict';

/**
 * index.js — CarrierFlex VB Cancel + BST entry point
 *
 * Starts the VB cancellation listener and optional milestone Service Bus
 * subscription.
 */

const cfg = require('./config');

const sbListener      = require('./service-bus-listener');
const { processCancelEvent } = require('./vb-cancel-pipeline');
const { startDashboard, stopDashboard } = require('./log-dashboard');
const { createFilePublicationHandler } = require('./milestone-file');

async function main() {
  console.log('=== CarrierFlex VB Cancel + BST service starting ===');

  await startDashboard();

  // Start the cancellation listener; opt in before routing file publications.
  const milestonesEnabled = cfg.milestones.enabled;
  const processFilePublication = milestonesEnabled ? createFilePublicationHandler() : null;
  sbListener.start(processCancelEvent, processFilePublication);
  if (milestonesEnabled && cfg.milestones.serviceBus.subscriptionName) {
    sbListener.start(null, processFilePublication, cfg.milestones.serviceBus);
  }
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
