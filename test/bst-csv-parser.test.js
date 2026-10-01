'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFile } = require('../src/csv-parser');

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'carrierflex-bst-test-'));
  const filePath = path.join(directory, 'carrier.csv');
  try {
    fs.writeFileSync(filePath, 'PO Number,ASN,Carrier\nPO-100; PO-200,ASN-1,DT\n', 'utf8');
    const [row] = await parseFile(filePath);
    assert.deepStrictEqual(row.poRefs, ['PO-100', 'PO-200']);
    assert.strictEqual(row.asn, 'ASN-1');
    console.log('bst-csv-parser tests passed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});