# CarrierFlex VB Cancel + BST

This Node.js service processes VB booking cancellations and carrier Bulk Status (BST) messages for E2open. A local dashboard displays the activity recorded by both pipelines.

## Log Dashboard

Start the dashboard from the repository root:

```powershell
npm run dashboard
```

Open [http://127.0.0.1:3100](http://127.0.0.1:3100). The dashboard reads `state/cancel-log.json` and `state/bst-log.json`, refreshes automatically every 15 seconds, and provides search plus flow and result filters.

`npm start` starts the dashboard and Service Bus listeners. BST CSVs are received through the milestones Service Bus subscription; carrier SFTP input is not used. Use `npm run dashboard` when you only want to run the dashboard locally.

For Windows App Service, the root `web.config` routes IIS requests to the Node entry point at `src/index.js`. The dashboard preserves the IISNode `PORT` value because it can be a named pipe rather than a numeric TCP port. Keep `web.config` in the deployed package; without it, IIS can show the default permission or under-construction page instead of the dashboard.

## Service Bus Cancellation Input

The listener accepts JSON messages containing either the legacy `poRefs` array or the carrier-change topic shape:

```json
{
	"PoId": "10200375991",
	"AsnIds": ["42152201407698"]
}
```

To receive from a topic subscription, configure `SERVICEBUS_SUBSCRIPTION_NAME` and `SERVICEBUS_CONNECTION_STRING`. The topic defaults to `carrier-change` and can be overridden with `SERVICEBUS_TOPIC_NAME`. When no subscription name is configured, the listener retains the queue mode using `SERVICEBUS_QUEUE_NAME`.

Optional environment variables:

- `LOG_DASHBOARD_HOST` changes the listen address. The default is `127.0.0.1`, which keeps the dashboard local to the machine.
- `LOG_DASHBOARD_PORT` changes the port. The default is `3100`.
- `PORT` is used when provided by a hosting platform such as Azure App Service. When `WEBSITE_HOSTNAME` is present, the default listen address is `0.0.0.0` so the platform can route traffic to the app.

Keep the default local-only host for local development. Azure App Service sets its own host and port defaults; `LOG_DASHBOARD_HOST` can override the listen address if needed.

## Service Bus Milestone CSV Input

The service also accepts JSON `FilePublished` events:

```json
{
	"metadata": { "eventName": "FilePublished" },
	"data": {
		"fileName": "milestones.csv",
		"blobUri": "https://aspdsctinthubarchive.blob.core.windows.net/cfs/DHL/milestones.csv?<read-only-SAS>",
		"source": "DHL"
	}
}
```

The message body must be JSON only, without the copied viewer CSS. The service downloads `data.blobUri` directly using its SAS, passes the temporary CSV to the existing BST parser/generator/uploader, and removes the temporary file. No blob-container credentials or changes to `config/inputs.json` are required. The CSV must use the existing ASN and milestone column mappings. `data.source` is publication metadata; it does not override the CSV carrier column or `CARRIER_CODE`.

Milestone CSV consumption is disabled by default. To enable a dedicated milestones subscription, set these values in `config/.env` or deployment application settings:

```dotenv
MILESTONES_SERVICEBUS_ENABLED=true
MILESTONES_SERVICEBUS_TOPIC_NAME=<milestones-topic>
MILESTONES_SERVICEBUS_SUBSCRIPTION_NAME=<milestones-subscription>
MILESTONES_SERVICEBUS_CONNECTION_STRING=<connection-string-with-listen-permission>
```

The milestones connection string falls back to `SERVICEBUS_CONNECTION_STRING` when blank. If milestones are enabled but no dedicated subscription is configured, `FilePublished` events on the cancellation receiver are routed to BST processing. Use `npm run bst-once` only for manual local-file processing.

Downloads require HTTPS and an explicitly allowed storage host/container. Defaults are `aspdsctinthubarchive.blob.core.windows.net` and `cfs`; use comma-separated `MILESTONES_ALLOWED_BLOB_HOSTS` and `MILESTONES_ALLOWED_BLOB_CONTAINERS` to change them. `MILESTONES_DOWNLOAD_TIMEOUT_MS` defaults to 60000 and `MILESTONES_MAX_DOWNLOAD_BYTES` defaults to 52428800 (50 MiB). Storage firewall/private endpoint restrictions still apply. Do not log or commit SAS URLs; expired SAS tokens require a refreshed publication URL.

Messages complete only after all parsed BST rows succeed. Download, parse, and upload failures abandon the message for Service Bus retry and eventual dead-lettering according to the subscription's delivery limit. Fully successful blobs are tracked under `STATE_DIR/milestone-files` by host/path, ignoring SAS query parameters, so redelivery with a renewed SAS does not reprocess the same blob. Publishers must use a unique blob path for each new file. Keep this state persistent across restarts.

This is file-level duplicate protection, not exactly-once delivery: partial upload failures or a crash after an upload but before recording completion can resend rows. The state store is intended for a single service instance; multiple instances require shared, atomic deduplication storage. The receiver renews message locks for up to 20 minutes during processing.

## Dashboard Fields

Each activity row shows its timestamp, flow, PO reference(s), ASN, VB reference, result, and output or skip details. Search matches references, filenames, and details. Summary counts reflect the currently filtered rows.

Cancellation rows use the PO references associated with that ASN by the Databricks query when available. A skipped cancellation shows the other ASN(s) found using the same VB reference in same-day outbound 856 messages. No VBKREQ is generated or uploaded for that skipped ASN.

BST rows show PO references only if the carrier input file supplies a recognized PO column, such as `PO`, `PO Number`, `PO Ref`, or `Purchase Order`. The current sample BST files contain ASN values but no PO column, so those entries show no PO reference. Historical log records are not backfilled when they lack PO data.

## Result Meanings

- **Cancel submitted**: The VBKREQ cancellation file was uploaded to the configured E2open SFTP destination. This does not confirm that E2open processed the cancellation; acknowledgments are not recorded by this dashboard.
- **BST submitted**: The BST file was uploaded to the configured E2open SFTP destination.
- **Skipped**: The pipeline intentionally did not send the cancellation, including when the VB reference was also found for another ASN on the same day.
- **Failed**: The log entry contains one or more processing or upload errors.
- **Saved locally**: SFTP was not used; output was saved locally.
- **No output**: The log records an event but no successful output file.

## Other Commands

```powershell
npm test
npm run cancel-once
npm run bst-once
npm start
```

`npm run cancel-once` and `npm run bst-once` run one-off local workflows; `npm start` runs the continuous service.
