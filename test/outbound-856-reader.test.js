'use strict';

const assert = require('assert');
const { extractVbReference, extractOtherAsnsForVbReference } = require('../src/outbound-856-reader');
const { buildCancelXml } = require('../src/vbkreq-cancel-builder');

const xml = `
  <XMLBundle>
    <BpMessage MessageType="856" PurposeCd="04">
      <Reference SourceRefTypeCd="128" RefTypeCd="ACE">vb-0000002186</Reference>
      <Document DocType="SHIP" Key="49870000005277"><DocumentID>49870000005277</DocumentID></Document>
    </BpMessage>
    <BpMessage MessageType="999">
      <Reference SourceRefTypeCd="128" RefTypeCd="ACE">VB-999</Reference>
    </BpMessage>
  </XMLBundle>`;

assert.strictEqual(extractVbReference(xml, '49870000005277'), 'VB-0000002186');
assert.strictEqual(extractVbReference(xml, 'other-asn'), '');
const otherAsnXml = `
  <XMLBundle>
    <BpMessage MessageType="856">
      <Reference SourceRefTypeCd="128" RefTypeCd="ACE">VB-0000002186</Reference>
      <Document DocType="SHIP" Key="49870000005278"><DocumentID>49870000005278</DocumentID></Document>
    </BpMessage>
    <BpMessage MessageType="856">
      <Reference SourceRefTypeCd="128" RefTypeCd="ACE">VB-0000002186</Reference>
      <Document DocType="SHIP" Key="49870000005277"><DocumentID>49870000005277</DocumentID></Document>
    </BpMessage>
    <BpMessage MessageType="856">
      <Reference SourceRefTypeCd="128" RefTypeCd="ACE">VB-OTHER</Reference>
      <Document DocType="SHIP" Key="49870000005279"><DocumentID>49870000005279</DocumentID></Document>
    </BpMessage>
    <BpMessage MessageType="999">
      <Reference SourceRefTypeCd="128" RefTypeCd="ACE">VB-0000002186</Reference>
      <Document DocType="SHIP" Key="49870000005280"><DocumentID>49870000005280</DocumentID></Document>
    </BpMessage>
  </XMLBundle>`;
assert.deepStrictEqual(
  extractOtherAsnsForVbReference(otherAsnXml, 'VB-0000002186', '49870000005277'),
  ['49870000005278']
);
assert.throws(
  () => buildCancelXml({ ASN_Ref: '49870000005277' }),
  /Missing valid VB booking reference/
);

console.log('outbound-856-reader tests passed');