'use strict';

const path   = require('path');
const dotenv = require('dotenv');

// Load config/.env first, then root .env as fallback.
dotenv.config({ path: path.resolve(process.cwd(), 'config/.env'), override: true });
dotenv.config({ override: false });

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name, defaultVal = '') {
  return process.env[name] || defaultVal;
}

module.exports = {
  serviceBus: {
    connectionString: optional('SERVICEBUS_CONNECTION_STRING'),
    topicName:        optional('SERVICEBUS_TOPIC_NAME', 'carrier-change'),
    subscriptionName: optional('SERVICEBUS_SUBSCRIPTION_NAME'),
    queueName:        optional('SERVICEBUS_QUEUE_NAME', 'po-cancel-events'),
    maxMessages:      parseInt(optional('SERVICEBUS_MAX_MESSAGES', '10'), 10),
  },

  milestones: {
    enabled: optional('MILESTONES_SERVICEBUS_ENABLED', 'false') === 'true',
    serviceBus: {
      connectionString: optional('MILESTONES_SERVICEBUS_CONNECTION_STRING', optional('SERVICEBUS_CONNECTION_STRING')),
      topicName: optional('MILESTONES_SERVICEBUS_TOPIC_NAME'),
      subscriptionName: optional('MILESTONES_SERVICEBUS_SUBSCRIPTION_NAME'),
    },
    allowedHosts: optional('MILESTONES_ALLOWED_BLOB_HOSTS', 'aspdsctinthubarchive.blob.core.windows.net')
      .split(',').map(value => value.trim().toLowerCase()).filter(Boolean),
    allowedContainers: optional('MILESTONES_ALLOWED_BLOB_CONTAINERS', 'cfs')
      .split(',').map(value => value.trim()).filter(Boolean),
    downloadTimeoutMs: parseInt(optional('MILESTONES_DOWNLOAD_TIMEOUT_MS', '60000'), 10),
    maxDownloadBytes: parseInt(optional('MILESTONES_MAX_DOWNLOAD_BYTES', '52428800'), 10),
  },

  databricks: {
    host:     optional('DATABRICKS_HOST'),
    httpPath: optional('DATABRICKS_HTTP_PATH'),
    token:    optional('DATABRICKS_TOKEN'),
    skipSp:   optional('DATABRICKS_SKIP_SP', 'false') === 'true',
    tenantId: optional('SP_TENANT_ID', '4af8322c-80ee-4819-a9ce-863d5afbea1c'),
    clientId: optional('SP_CLIENT_ID'),
    clientSecret: optional('SP_CLIENT_SECRET'),
  },

  outbound856: {
    connectionString: optional('AZURE_BLOB_CONNECTION_STRING'),
    containerSasUrl:  optional('AZURE_BLOB_CONTAINER_SAS_URL'),
    containerName:    optional('AZURE_BLOB_CONTAINER', 'sftp-inbound'),
    prefix:           optional('AZURE_BLOB_856_PREFIX', 'IN/'),
    lookbackDays:     parseInt(optional('AZURE_BLOB_856_LOOKBACK_DAYS', '365'), 10),
    maxBlobs:         parseInt(optional('AZURE_BLOB_856_MAX_BLOBS', '1000'), 10),
  },

  sftpEnv: optional('SFTP_ENV', 'test').toLowerCase(),

  sftpE2open: {
    host:               optional('SFTP_HOST'),
    port:               parseInt(optional('SFTP_PORT', '22'), 10),
    username:           optional('SFTP_USERNAME'),
    password:           optional('SFTP_PASSWORD'),
    privateKeyPath:     optional('SFTP_PRIVATE_KEY_PATH'),
    privateKeyContent:  optional('SFTP_PRIVATE_KEY_CONTENT'),
    passphrase:         optional('SFTP_PASSPHRASE'),
    vbkreqRemoteDir:    optional('SFTP_VBKREQ_REMOTE_DIR', '/inbound/vbkreq/'),
    bstRemoteDir:       optional('SFTP_BST_REMOTE_DIR',    '/inbound/bst/'),
  },

  sftpE2openProd: {
    host:               optional('PROD_SFTP_HOST'),
    port:               parseInt(optional('PROD_SFTP_PORT', '22'), 10),
    username:           optional('PROD_SFTP_USERNAME'),
    password:           optional('PROD_SFTP_PASSWORD'),
    privateKeyPath:     optional('PROD_SFTP_PRIVATE_KEY_PATH'),
    privateKeyContent:  optional('PROD_SFTP_PRIVATE_KEY_CONTENT'),
    passphrase:         optional('PROD_SFTP_PASSPHRASE'),
    vbkreqRemoteDir:    optional('PROD_SFTP_VBKREQ_REMOTE_DIR', '/inbound/vbkreq/'),
    bstRemoteDir:       optional('PROD_SFTP_BST_REMOTE_DIR',    '/inbound/bst/'),
  },

  carrier:   optional('CARRIER_CODE', 'DT'),
  outputDir: path.resolve(optional('OUTPUT_DIR', './output')),
  stateDir:  path.resolve(optional('STATE_DIR',  './state')),
};
