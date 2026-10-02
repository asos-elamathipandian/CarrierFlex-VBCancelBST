# CarrierFlex VB Cancel + BST

This Node.js service processes VB booking cancellations and carrier Bulk Status (BST) messages for E2open. A local dashboard displays the activity recorded by both pipelines.

## Log Dashboard

Start the dashboard from the repository root:

```powershell
npm run dashboard
```

Open [http://127.0.0.1:3100](http://127.0.0.1:3100). The dashboard reads `state/cancel-log.json` and `state/bst-log.json`, refreshes automatically every 15 seconds, and provides search plus flow and result filters.

The dashboard can run alongside the background service. `npm start` starts the Service Bus cancellation listener and BST poller; it does not start the dashboard.

Optional environment variables:

- `LOG_DASHBOARD_HOST` changes the listen address. The default is `127.0.0.1`, which keeps the dashboard local to the machine.
- `LOG_DASHBOARD_PORT` changes the port. The default is `3100`.

Keep the default local-only host unless access from other machines is intentionally required and appropriately protected.

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
