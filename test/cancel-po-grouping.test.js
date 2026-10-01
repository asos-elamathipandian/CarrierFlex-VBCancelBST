'use strict';

const assert = require('assert');
const { groupBookingRows } = require('../src/databricks-cancel-reader');

const { bookingRows } = groupBookingRows([
  { asn_id: 'ASN-1', poId: 'PO-1', bookedQty: 2 },
  { asn_id: 'ASN-1', poId: 'PO-2', bookedQty: 3 },
  { asn_id: 'ASN-1', poId: 'PO-1', bookedQty: 1 },
  { asn_id: 'ASN-2', poId: 'PO-3', bookedQty: 4 },
]);

assert.deepStrictEqual(bookingRows.map(row => row.PO_Refs), [['PO-1', 'PO-2'], ['PO-3']]);
console.log('cancel-po-grouping tests passed');