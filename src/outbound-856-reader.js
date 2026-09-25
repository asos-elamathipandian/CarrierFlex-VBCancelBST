'use strict';

const { BlobServiceClient, ContainerClient } = require('@azure/storage-blob');

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function attributeValue(attributes, name) {
  const match = String(attributes || '').match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? decodeXml(match[2]).trim() : '';
}

function extractVbReference(xml, asn) {
  const messagePattern = /<BpMessage\b([^>]*)>([\s\S]*?)<\/BpMessage>/gi;
  let messageMatch;

  while ((messageMatch = messagePattern.exec(String(xml || '')))) {
    if (attributeValue(messageMatch[1], 'MessageType') !== '856' || !messageMatch[2].includes(String(asn))) {
      continue;
    }

    const referencePattern = /<Reference\b([^>]*)>([\s\S]*?)<\/Reference>/gi;
    let referenceMatch;
    while ((referenceMatch = referencePattern.exec(messageMatch[2]))) {
      if (
        attributeValue(referenceMatch[1], 'RefTypeCd') === 'ACE' &&
        attributeValue(referenceMatch[1], 'SourceRefTypeCd') === '128'
      ) {
        const vbRef = decodeXml(referenceMatch[2]).trim();
        if (/^VB-\d+$/i.test(vbRef)) return vbRef.toUpperCase();
      }
    }
  }

  return '';
}

function datePrefixes(prefix, lookbackDays) {
  const normalizedPrefix = prefix ? `${prefix.replace(/\/?$/, '/')}` : '';
  const prefixes = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);

  for (let day = 0; day <= lookbackDays; day++) {
    const ymd = `${cursor.getUTCFullYear()}/${String(cursor.getUTCMonth() + 1).padStart(2, '0')}/${String(cursor.getUTCDate()).padStart(2, '0')}/`;
    prefixes.push(`${normalizedPrefix}${ymd}`);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return prefixes;
}

async function streamToString(readableStream) {
  const chunks = [];
  for await (const chunk of readableStream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function findLatestVbReferenceByAsn({
  asn,
  connectionString,
  containerSasUrl,
  containerName,
  prefix = 'IN/',
  lookbackDays = 365,
  maxBlobs = 1000,
}) {
  if (!containerSasUrl && !connectionString) {
    throw new Error('Outbound 856 lookup is not configured: set AZURE_BLOB_CONTAINER_SAS_URL or AZURE_BLOB_CONNECTION_STRING');
  }
  if (!containerSasUrl && !containerName) {
    throw new Error('Outbound 856 lookup is not configured: set AZURE_BLOB_CONTAINER');
  }

  const normalizedAsn = String(asn || '').trim();
  if (!normalizedAsn) throw new Error('Cannot find outbound 856 without an ASN reference');

  const containerClient = containerSasUrl
    ? new ContainerClient(containerSasUrl)
    : BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName);
  const blobs = [];

  for (const datePrefix of datePrefixes(prefix, Math.max(0, lookbackDays))) {
    for await (const blob of containerClient.listBlobsFlat({ prefix: datePrefix })) {
      if (/\.xml$/i.test(blob.name)) blobs.push(blob);
    }
  }

  const latestFirst = blobs
    .sort((left, right) => (right.properties.lastModified || 0) - (left.properties.lastModified || 0))
    .slice(0, Math.max(1, maxBlobs));

  for (const blob of latestFirst) {
    const download = await containerClient.getBlobClient(blob.name).download(0);
    const xml = await streamToString(download.readableStreamBody);
    const bookingRef = extractVbReference(xml, normalizedAsn);
    if (bookingRef) {
      return {
        bookingRef,
        blobName: blob.name,
        lastModified: blob.properties.lastModified,
      };
    }
  }

  throw new Error(`No 856 ACE VB reference found for ASN ${normalizedAsn} in the latest ${latestFirst.length} blob(s)`);
}

module.exports = { extractVbReference, findLatestVbReferenceByAsn };