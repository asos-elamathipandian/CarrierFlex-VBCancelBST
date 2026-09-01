'use strict';

/**
 * run-bst-once.js
 *
 * Triggers the BST pipeline from a local CSV/Excel file instead of the
 * carrier SFTP.  Useful during dev/test before the carrier SFTP is available.
 *
 * File is resolved from (in priority order):
 *   1. Command-line arg:   node src/run-bst-once.js input/bst-input.csv
 *   2. config/inputs.json  { "bstFile": "input/bst-input.csv" }
 *   3. Auto-detect first .csv/.xlsx file under input/
 */

require('./config');

const fs   = require('fs');
const path = require('path');
const { processFile } = require('./bst-pipeline');

function loadInputs() {
  const inputsPath = path.resolve(process.cwd(), 'config/inputs.json');
  if (fs.existsSync(inputsPath)) {
    try { return JSON.parse(fs.readFileSync(inputsPath, 'utf8')); } catch (_) {}
  }
  return {};
}

function autoDetectFile() {
  const inputDir = path.resolve(process.cwd(), 'input');
  if (!fs.existsSync(inputDir)) return null;
  const exts = ['.csv', '.xlsx', '.xls'];
  const file  = fs.readdirSync(inputDir).find(f => exts.includes(path.extname(f).toLowerCase()));
  return file ? path.join(inputDir, file) : null;
}

async function main() {
  const cliFile = process.argv[2];
  const inputs  = loadInputs();

  let filePath;
  if (cliFile) {
    filePath = path.resolve(cliFile);
  } else if (inputs.bstFile) {
    filePath = path.resolve(inputs.bstFile);
  } else {
    filePath = autoDetectFile();
  }

  if (!filePath || !fs.existsSync(filePath)) {
    console.error(
      'Usage: node src/run-bst-once.js <path/to/file.csv>\n' +
      '  Or add { "bstFile": "input/bst-input.csv" } to config/inputs.json\n' +
      '  Or place a .csv/.xlsx file in the input/ folder'
    );
    process.exit(1);
  }

  console.log(`Processing BST from: ${filePath}`);
  const result = await processFile(filePath, path.basename(filePath));
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => { console.error(err.message); process.exit(1); });
