'use strict';

const { DBSQLClient }           = require('@databricks/sql');
const {
  ClientSecretCredential,
  AzureCliCredential,
  InteractiveBrowserCredential,
  ChainedTokenCredential,
} = require('@azure/identity');
const cfg = require('./config');

// Databricks AAD resource ID (constant across all Azure Databricks workspaces).
const DATABRICKS_RESOURCE = '2ff814a6-3304-4ab8-85cb-cd0e6f879c1d';

/**
 * Resolve the bearer token.
 * PAT takes priority; otherwise obtains an AAD token via SP → Azure CLI → browser.
 */
async function resolveToken() {
  const { token, skipSp, tenantId, clientId, clientSecret } = cfg.databricks;
  if (token && !token.startsWith('REPLACE_')) return token;

  const creds = [];
  if (!skipSp && clientId && clientSecret && tenantId) {
    creds.push(new ClientSecretCredential(tenantId, clientId, clientSecret));
  }
  creds.push(new AzureCliCredential({ tenantId }));
  if (process.env.NODE_ENV !== 'production') {
    creds.push(new InteractiveBrowserCredential({ tenantId }));
  }
  const credential = new ChainedTokenCredential(...creds);
  const resp = await credential.getToken(`${DATABRICKS_RESOURCE}/.default`);
  if (!resp?.token) throw new Error('Failed to obtain Azure AD token for Databricks');
  return resp.token;
}

/**
 * Run a SQL query against the Databricks Serve layer and return plain-object rows.
 */
async function query(sql) {
  const { host, httpPath } = cfg.databricks;
  if (!host || !httpPath) {
    throw new Error('Databricks not configured — set DATABRICKS_HOST and DATABRICKS_HTTP_PATH in config/.env');
  }

  const token  = await resolveToken();
  const client = new DBSQLClient();

  await client.connect({ host, path: httpPath, token });

  const session = await client.openSession({
    initialCatalog: 'sourcingandbuying',
    initialSchema:  'serve',
  });

  try {
    const operation = await session.executeStatement(sql, {
      queryTimeout: 120,
    });
    const result = await operation.fetchAll();
    await operation.close();
    return result || [];
  } finally {
    await session.close();
    await client.close();
  }
}

module.exports = { query };
