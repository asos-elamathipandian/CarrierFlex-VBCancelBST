'use strict';

/**
 * run-cancel-once.js
 *
 * Triggers the VB cancellation pipeline from a local input file instead of
 * the Azure Service Bus.  Useful during dev/test before the Service Bus is wired up.
 *
 * PO refs are read from (in priority order):
 *   1. Command-line args:  node src/run-cancel-once.js 1234567 2345678
 *   2. config/inputs.json  { "poRefs": ["1234567", "2345678"] }
 */

require('./config');

const fs   = require('fs');
const path = require('path');
const { processCancelEvent } = require('./vb-cancel-pipeline');

function loadInputs() {
  const inputsPath = path.resolve(process.cwd(), 'config/inputs.json');
  if (fs.existsSync(inputsPath)) {
    try { return JSON.parse(fs.readFileSync(inputsPath, 'utf8')); } catch (_) {}
  }
  return {};
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const cliAsnRefs = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if ((arg === '--asn' || arg === '-asn') && rawArgs[i + 1]) {
      cliAsnRefs.push(String(rawArgs[i + 1]).trim());
      i++;
    }
  }

  const cliRefs = rawArgs.filter(a => /^\d+$/.test(a));
  const inputs = loadInputs();
  const asnRefs = cliAsnRefs.length ? cliAsnRefs : (inputs.asnRefs || []).map(String);
  const poRefs = cliRefs.length ? cliRefs : (inputs.poRefs || []).map(String);

  if (asnRefs.length) {
    console.log(`Running VB cancel for ASN(s): ${asnRefs.join(', ')}`);
    const result = await processCancelEvent({ asnRefs });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!poRefs.length) {
    console.error(
      'Usage: node src/run-cancel-once.js <PO1> [PO2 ...]\n' +
      '  Or: node src/run-cancel-once.js --asn 49870000005277\n' +
      '  Or add { "poRefs": ["1234567"] } or { "asnRefs": ["49870000005277"] } to config/inputs.json'
    );
    process.exit(1);
  }

  console.log(`Running VB cancel for PO(s): ${poRefs.join(', ')}`);
  const result = await processCancelEvent(poRefs);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => { console.error(err.message); process.exit(1); });
