# CarrierFlex Cancellation and BST E2E Test Plan

## Scope and Execution Status

This is a manual/integration test specification, not an automated test suite. All cases start as **Not run**. Successful connectivity is a prerequisite, not evidence that these tests passed.

Cover the full chain: producer -> Service Bus subscription -> application -> enrichment and business rules -> XML -> E2open SFTP -> downstream acceptance -> logs/dashboard. BST CSV input is published through the milestones Service Bus subscription; carrier SFTP is not an input route.

Current implementation boundaries:

- Cancellation receives Service Bus events through `src/service-bus-listener.js` and calls `src/vb-cancel-pipeline.js`.
- BST `FilePublished` events are received from the configured Service Bus subscription and download the CSV from the event's blob URI before calling `src/bst-pipeline.js`.
- Cancellation ASN references take precedence over PO references; the supplied PO is not currently used to constrain an ASN lookup.
- Cancellation resolves the VB reference from outbound 856 blobs. Another ASN sharing that reference in the same date folder causes a skip, even if both ASNs are in the cancellation request.
- Logs record submission, not downstream E2open acceptance. Acceptance checks require partner acknowledgments or an agreed downstream observation.
- The listener completes a message whenever its handler resolves. The pipeline can resolve with an `errors` array, so retry behavior must be tested rather than assumed.

Priority: **P0** release blocker/core flow or data-loss risk; **P1** important negative, recovery, or operational coverage; **P2** additional compatibility and endurance coverage. Expected results below are release acceptance requirements; some intentionally expose current gaps.

## Preconditions and Safety

1. Use dedicated test topics/subscriptions, test PO/ASN data, an isolated blob fixture location, and E2open test SFTP directories. Never run fault injection or load tests against production without explicit approval.
2. Record the namespace, both topic/subscription names, deployed build, service instance count, subscription filters, session setting, lock duration, TTL, maximum delivery count, duplicate-detection configuration, and authentication method. The cancellation receiver currently requires a non-session-enabled subscription.
3. Verify Listen access for the application and Send access for the test producer separately. Do not publish secrets in reports or commit connection strings.
4. Obtain the approved cancellation JSON contract, BST topic contract, VBKREQ/BST schema or partner-approved examples, supported carriers, valid event codes, and timezone rules. Do not invent a BST topic payload and treat it as supported.
5. Confirm Databricks, outbound 856 Blob Storage, local output/state storage, and E2open test SFTP access. Explicitly configure remote delivery: local fallback must not count as E2E success.
6. Pause competing consumers during deterministic tests. Snapshot queue counts and test state; keep logs and counters isolated. Only reset test-owned artifacts with approval.
7. Agree on invalid-message, no-booking, shared-booking, retry, partial-batch, deduplication, ordering, and DLQ policies before accepting those cases. Document each unresolved policy as a blocker.
8. Synchronize clocks, use UTC for measurements, and arrange downstream acknowledgment access. Verify cancellation timestamps marked LT against the agreed deployment timezone.
9. Have the topic owner approve test traffic and subscription rules. A dedicated subscription alone does not prevent other topic subscribers from receiving published tests.

## Test Data

Use real test-environment equivalents for these symbolic fixtures; preserve identifiers as strings.

| Fixture | Required condition |
| --- | --- |
| PO-A / ASN-A | Active booked ASN; valid latest outbound 856 containing VB-A; no other same-day ASN using VB-A. |
| PO-A / ASN-B | Second active booked ASN for the same PO; different VB-B; no shared-booking conflict. |
| ASN-C | Several SKU rows and more than one PO, to validate grouping and order/line mapping. |
| ASN-D | Unknown, deleted, or unbooked ASN variants, each independently controlled. |
| ASN-E / ASN-F | Same VB reference in same-day 856 messages, including a bundled 856 variant. |
| ASN-G | Several historical 856s with different VB references and known dates/last-modified ordering. |
| ASN-H | Missing or invalid ACE reference; malformed and temporarily unreadable blob variants. |
| BST-A | Exact long ASN string, PO references, supported carrier, location, and all six supported date events. |
| BST-B | Minimal valid BST input with optional fields omitted; expected defaults signed off. |
| FAULT-A | Approved test dependency endpoint or fault mechanism for transient failures and timeouts. |

Cancellation multi-ASN example for the current listener:

```json
{
  "PoId": "<PO-A>",
  "AsnIds": ["<ASN-A>", "<ASN-B>"]
}
```

Legacy cancellation example:

```json
{
  "poRefs": ["<PO-A>"]
}
```

Current BST file fixture (not a BST topic schema):

```csv
ASN,PO,Carrier,HandoverLocation,080,HNDOVR,DO,A,135,QARD
<ASN-A>,<PO-A>,DT,TRIST,14/10/2026 08:00,14/10/2026 09:00,14/10/2026 10:00,15/10/2026 11:00,15/10/2026 12:00,16/10/2026 13:00
```

Keep a signed-off expected manifest per fixture: input MessageId, expected ASNs, POs/SKUs, VB references, carrier, version, dates, expected file count, and expected downstream outcomes.

## Common Execution Procedure

For each case below:

1. Prepare its fixture and record active/DLQ counts, log baseline, and existing local/remote filenames.
2. Assign a unique test run ID and MessageId; record body and properties, publication time, and fixture manifest. For duplicate tests reuse the specified ID deliberately.
3. Perform the stated action. Publish cancellation to its topic and `FilePublished` BST events to the approved milestones topic/subscription.
4. Observe settlement, delivery count, errors, output XML, local and remote artifacts, and log/dashboard records. A disappearing message alone is not a pass.
5. Parse generated XML with an XML parser and validate the approved XSD where available. Compare semantic fields and file counts against the manifest, not whole XML bytes containing dynamic timestamps/control numbers.
6. Verify remote file integrity by hash where possible, or byte comparison through a test download. Confirm downstream acceptance and business state for successful E2E cases.
7. Record Pass/Fail/Blocked, evidence, timings, defect reference, and cleanup. Do not purge subscriptions containing unrelated messages.

## Connectivity and Service Bus Contract

| ID | Priority | Test and action | Expected result / evidence |
| --- | --- | --- | --- |
| CON-01 | P0 | Peek existing test messages on the cancellation and milestones subscriptions using the configured identity. | Correct namespace/topic/subscription; bodies visible; active counts unchanged by peeking; no pipeline output. |
| CON-02 | P0 | Publish one uniquely identified valid cancellation and one valid `FilePublished` event to their respective subscriptions. | Each event reaches the intended pipeline; cancellation generates VBKREQ and file publication downloads the CSV for BST processing; unrelated flows are not processed. |
| CON-03 | P1 | Test valid credentials with no Listen permission, then expired/revoked credentials. | Explicit actionable authorization error; no read or output; alert visible; secrets absent from logs. Restore credentials and verify recovery. |
| CON-04 | P1 | Configure an incorrect topic/subscription and test session-enabled versus approved non-session setup. | Startup/receiver failure surfaced; no false ready/healthy signal; unsupported sessions clearly rejected or blocked by deployment validation. |
| CON-05 | P0 | Publish matching and nonmatching application properties against subscription filters. | Only matching events arrive; producer/filter agreement is proven with counts. Capture ignored events in a separate test observer if authorized. |
| CON-06 | P1 | Publish object and JSON-string cancellation bodies; repeat with malformed JSON, empty/null fields, null array elements, unsupported types, and oversized payloads. | Valid forms normalize; invalid values are not transformed into usable references such as "null"; invalid events follow agreed rejection/DLQ policy with no output. Broker size rejections are distinguished from application validation. |
| CON-07 | P0 | Publish valid and invalid `FilePublished` JSON events, including malformed fields and disallowed blob locations. | Valid events download and process the CSV through BST; invalid events are abandoned for retry without processing; cancellation requests are not sent through the BST pipeline. |

## Booking Cancellation Functional Cases

| ID | Priority | Test and action | Expected result / evidence |
| --- | --- | --- | --- |
| CAN-01 | P0 | Send PO-A and ASN-A. | One VBKREQ; correct VB-A ACE, PO, SKU/ASN lines, carrier, version and destination; remote delivery and downstream cancellation confirmed. |
| CAN-02 | P0 | Send PO-A with ASN-A and ASN-B. | Two independent VBKREQ files, one per eligible ASN; neither ASN omitted or merged; correct VB per file; unique control numbers/filenames; both downstream outcomes confirmed. |
| CAN-03 | P0 | Send legacy PO-only request for a PO with multiple ASNs. | All eligible ASNs resolved and processed individually under the approved PO-only eligibility rule; reconcile returned rows against manifest. PO-only and ASN-only queries currently have different booked-state filters. |
| CAN-04 | P1 | Send ASN-only input, supported case-insensitive field names, singular `AsnId`, and whitespace-padded string references. | Supported forms resolve the same intended ASN without corruption; exact identifiers retained. Unsupported aliases follow agreed invalid-input policy. |
| CAN-05 | P0 | Send a PO that does not belong to the supplied ASN; also mix ASNs from different POs. | Confirm explicit contract: reject mismatches if PO is a constraint; if ASN is authoritative, use actual PO data and clearly record precedence. Current implementation does not constrain ASN queries by input PO. |
| CAN-06 | P0 | Use several SKU rows for one ASN, duplicate source snapshots, and ASN-C spanning multiple POs. | One file per ASN; only latest intended SKU records; correct quantities if required by schema; every line and PO association correct. Verify XML orders separately from dashboard PO lists: one XML Order is currently constructed per booking row. |
| CAN-07 | P1 | Test unknown, deleted, unbooked, and missing PO/ASN data separately, then combine with one valid ASN. | No cancellation for ineligible identifiers; valid identifiers still handled according to partial-batch policy; missing identifiers individually reported, including partial query results. |
| CAN-08 | P0 | Provide several 856s for ASN-G and a conflicting Databricks booking reference. | VB comes from the latest applicable outbound 856 under the agreed ordering; not the stale Databricks reference; source blob trace retained. |
| CAN-09 | P0 | Missing 856, invalid ACE format, missing ASN document, malformed XML, or cross-ASN reference false match. | No cancellation using an incorrect/missing VB; clear ASN-specific error; approved retry/quarantine behavior; no partial invalid XML delivered. |
| CAN-10 | P0 | Same-day VB shared by requested ASN and an ASN not in the request; repeat within one bundled 856. | Cancellation skipped; no file/upload for that ASN; log names other ASN(s), VB, source evidence, and reason. |
| CAN-11 | P0 | Request both ASN-E and ASN-F sharing one same-day VB; repeat with shared VB only on another day. | Record business decision explicitly. Current rule skips both same-day ASNs even when both are requested; different-day matches should not activate the same-day rule. Do not accept unapproved booking-wide cancellation. |
| CAN-12 | P0 | Make one same-day blob unreadable or put relevant evidence beyond scan/lookback limits. | No unsafe cancellation when shared-booking evidence cannot be established completely; retry/explicit incomplete-scan result as agreed. Capture scanned counts and limits; current blob errors can be logged and ignored. |
| CAN-13 | P0 | Test stored booking version and absent version; restart and generate another cancellation. | V0 matches original stored version without increment; approved default is 1.0; ASOSCXL control numbers remain unique and persistent across restart. |
| CAN-14 | P0 | Validate full cancellation XML for supported carrier profiles, special-character supplier values, and timezone boundary. | Well-formed/schema-valid XML; BPM-VBKREQ, MessageType VBKREQ, PurposeCd 01, BOOK key and ACE VB agree; SU/CA IDs, V0, SI lines, header direction, filename, LT timestamps and remote directory match approved contract. |

## BST Functional Cases

Apply applicable cases to both carrier file ingestion and the future BST topic route. Topic-route executions remain blocked until contract/listener availability; file-route passes do not prove topic support.

| ID | Priority | Test and action | Expected result / evidence |
| --- | --- | --- | --- |
| BST-01 | P0 | Deliver one valid BST-A input. | One BPM-BST/BST XML; SHIP key, DocumentID and transaction ASN match; mode, carrier headers, location, dates, filename and remote directory correct; downstream shipment status confirmed. |
| BST-02 | P0 | Deliver several ASN rows/events including several ASNs for one PO and several POs for one ASN. | Output cardinality follows approved event/row contract; no lost ASN; PO references retained in logs; no accidental grouping across shipments. Array/batch support for topic input requires contract approval. |
| BST-03 | P0 | Set all events: 080, HNDOVR, DO, A, 135, QARD; repeat with subsets. | Exact supplied events/dates preserved in expected order; no extra fabricated event when valid events exist; downstream milestones match. |
| BST-04 | P0 | Test DMY date/time, ISO UTC, timezone offsets, compact date, midnight and date-boundary inputs. | Correct UTC instant and partner-required date representation for each event; no day/month swap or timezone shift; compare custom events and default HNDOVR formatting separately. |
| BST-05 | P0 | Supply invalid calendar dates/times, unparseable dates, unknown event codes, future dates and out-of-sequence events. | Approved validation policy enforced; invalid dates are not sent or silently replaced by current-time HNDOVR; unsupported events and business sequence violations reported or explicitly permitted. |
| BST-06 | P0 | Use BST-B with optional carrier/location/dates absent; unknown carrier; missing ASN. | Approved defaults verified (current DT/configured carrier, TRIST and synthetic HNDOVR); missing/invalid ASN or unsupported carrier cannot produce invalid downstream status. Synthetic dates need business sign-off. |
| BST-07 | P0 | Use exact long/string ASN, leading zeros, numeric JSON ASN, scientific notation, separators, and maximum identifier length. | Valid strings preserved exactly; already-rounded numeric/scientific values are rejected or quarantined under agreed policy, never reconstructed as another ASN. Current CSV parser preserves scientific notation rather than validates it. |
| BST-08 | P1 | Test documented CSV column aliases, quoted commas, BOM, blank rows, PO separators and optional fields; compare with XLSX. | Equivalent canonical rows/output across supported formats; empty ASN rows accounted for; PO lists visible where supplied; parse errors actionable. |
| BST-09 | P1 | Test a genuine binary XLS file, corrupt XLSX/CSV, empty/header-only input, unsupported extension, and multiple sheets. | Only documented/supported content processed; corrupt or unsupported files not marked successful; first-sheet behavior explicit. Genuine XLS support must be verified, since current implementation uses ExcelJS XLSX reader for `.xls`. |
| BST-10 | P0 | Mixed valid/invalid rows and an upload failure halfway through a file. | Per-row outcomes reconciled; successful rows not lost/repeated on recovery; file archived only when agreed success/quarantine policy is satisfied. Current callback does not propagate returned processing errors to the archive decision. |
| BST-11 | P0 | Poll again after success; introduce same filename with new content, archive conflict, partial download, or overlapping poll cycles. | No accidental duplicate processing, data overwrite or silent loss; interrupted source remains recoverable; archive/collision policy explicit. |
| BST-12 | P0 | Two events for the same ASN within one second; reverse event order and repeat identical event. | No silent local/remote overwrite; approved version/ordering/deduplication rule protects latest milestone. Current BST filenames have second-resolution timestamp plus ASN. |

## Recovery, Settlement and Cross-Flow Cases

| ID | Priority | Test and action | Expected result / evidence |
| --- | --- | --- | --- |
| REC-01 | P0 | Publish the same MessageId twice, then the same logical event with different MessageIds; repeat after restart. | Deduplication responsibility established at broker/application/downstream levels; no unintended duplicate business effect. Do not equate unique output filenames with idempotency. |
| REC-02 | P0 | Force transient Databricks, Blob Storage, or E2open failure individually; restore dependency. | Message not irreversibly completed on returned errors; bounded retry/backoff; eventual single effective delivery or DLQ; complete evidence. Current cancellation pipeline catches errors and resolves, so this is a high-risk gate. |
| REC-03 | P0 | One ASN succeeds, another fails in a multi-ASN event; restore and redeliver. | Failed ASN recoverable and successful ASN not canceled twice; settlement follows agreed partial-batch policy; totals reconcile. |
| REC-04 | P0 | Kill process before output, after local write, after upload but before completion, and during log/state write. | At-least-once redelivery handled without data loss or duplicate business effect; state recoverable; uploaded output traceable even if log/settlement failed. |
| REC-05 | P0 | Delay processing beyond lock duration; interrupt network during renewal and complete/abandon. | Supported lock renewal budget documented; lock loss visible; safe redelivery; no false success or uncontrolled duplicates. Measure broker delivery count. |
| REC-06 | P1 | Inject deterministic poison message until maximum delivery count; test message expiry and approved DLQ replay. | Poison/expired outcomes match broker/application policy; alert and reason recorded; replay possible after correction without republishing successful items. Current empty-input messages are completed, not automatically dead-lettered. |
| REC-07 | P0 | Remove E2open SFTP configuration; test wrong remote directory and remote permissions. | LOCAL status distinct from submitted; remote delivery gate fails in production-like configuration; write/permission failures visible and recoverable; no misleading success. |
| REC-08 | P0 | Local disk full/read-only, corrupt state JSON, state reset, and two application instances sharing state. | No silent counter reset, duplicate control numbers, lost log entries or unintended file replacement; health/alerts reflect failure. Validate local/shared storage deployment design before scale-out. |
| REC-09 | P1 | Shut down during both flows and restart; test BST scheduler overlap and worker drainage. | Approved in-flight drain/replay behavior; no abandoned output/state; no new work after shutdown; no duplicate scheduler/consumer behavior. |
| REC-10 | P0 | Submit cancellation and BST for same ASN concurrently, including late status after cancellation. | Approved business precedence/order enforced or conflicts explicitly routed for review; both pipelines' evidence intact; downstream final state matches business rule, not timing accident. |
| REC-11 | P0 | E2open rejects a delivered file or no acknowledgment arrives by deadline. | Submission distinguished from acceptance; rejection/timeout investigated and retried/reconciled by agreed process; never report business completion from SFTP upload alone. |

## Observability and Security

| ID | Priority | Test and action | Expected result / evidence |
| --- | --- | --- | --- |
| OPS-01 | P0 | Trace successful, skipped, failed, partial and DLQ outcomes from one run. | Input MessageId/run ID, ASN, actual PO(s), VB where applicable, filename, blob, remote path and disposition linked across stages. Missing correlation is a defect, not a reason to omit reconciliation. |
| OPS-02 | P1 | Open dashboard after each outcome; search/filter and refresh, including large logs. | Correct PO/ASN/VB/result and skip reason; counts agree with logs; local versus submitted distinguished; update within expected 15-second refresh cycle plus processing/network time. |
| OPS-03 | P0 | Inspect logs/reports for credentials; test markup/XML/path characters in references and descriptions. | No keys/tokens/passwords disclosed; no dashboard script execution, XML injection, path traversal or unsafe filename; invalid input quarantined. |
| OPS-04 | P1 | Verify restricted network/firewall and credential rotation with approved controls. | Authorized route works, unauthorized access denied; rotation recoverable; certificate/host identity verification follows infrastructure security policy. |
| OPS-05 | P1 | Stop consumers/build backlog; induce repeated failures, stale output, and DLQ growth. | Monitoring detects unavailable consumer, backlog age/count, failures, disk pressure and DLQ within agreed alert window; no healthy signal solely because dashboard responds. |

## Performance and Resilience Workloads

Use production-sized fixtures and realistic dependency latency. Cancellation currently has one concurrent Service Bus callback and sequential ASN processing; 856 scanning and per-output SFTP connections can dominate latency. BST file polling adds schedule delay; do not compare file input latency directly with topic input latency without separating that delay.

Define before execution:

- `R_cancel` and `R_bst`: forecast sustained input events/second for each flow, plus ASNs/event and output files/second. Do not measure multi-ASN events as equivalent to single-ASN events.
- `L_cancel` and `L_bst`: agreed p95 enqueue-to-remote-delivery budgets; separate downstream-acceptance deadline `L_accept` and p99 budgets.
- Maximum payload, ASNs/event, SKUs/ASN, carrier file rows/size, 856 objects/day, lookback and scan limits.
- Agreed CPU/RSS/disk/connection budgets, maximum backlog age, recovery time, and acceptable downstream duplicate semantics.

The durations and multipliers below are proposed test workloads, not verified capacity or contractual SLAs. Obtain owner approval and replace forecast variables with actual targets.

| ID | Priority | Workload / execution | Acceptance and measurements |
| --- | --- | --- | --- |
| PERF-01 | P0 | Baseline: at least 100 valid events per flow after warm-up with real test dependencies. | Measure p50/p95/p99 enqueue-to-start, enrichment, generation, upload and acceptance; establish no-loss baseline and file/event counts for cancellation and milestones subscriptions. |
| PERF-02 | P0 | Steady load: both flows concurrently at forecast R_cancel/R_bst for 60 minutes. | Meets agreed latency/throughput/resource budgets; backlog stable rather than continually growing; no lost/corrupt output or unintended duplicate effect. |
| PERF-03 | P1 | Burst: 5x forecast input rate for 5 minutes, then normal rate. | Backlog drains within agreed recovery budget; latency degradation measured; no dependency exhaustion/data loss; capture active/DLQ counts. |
| PERF-04 | P0 | Maximum approved ASNs/event and SKUs/ASN; large BST batches/files with realistic distributions. | Exact output cardinality; lock budget adequate; no overwrite; memory and payload limits respected; normal small events not starved beyond agreed budget. |
| PERF-05 | P0 | 856 lookup stress: recent hit, old hit, no hit, many objects, shared-VB check, unreadable objects and scan cap. | Record listings/downloads, bytes, latency and concurrency; bounds observable; scan cap never silently weakens cancellation safety. |
| PERF-06 | P1 | Soak: approved representative mix for 8-24 hours, including invalid messages and dashboard queries. | Stable RSS/handles/connections and acceptable log/disk growth; no accumulating scheduler overlaps; compare first/last-hour latency and throughput. |
| PERF-07 | P0 | Dependency outage at forecast load for approved duration; restore with accumulated backlog. | No dropped/incorrectly completed failed events; bounded reconnect/retry; backlog drains in agreed time without recovery storm or duplicate business effect. |
| PERF-08 | P0 | Two consumers/app instances and competing input producers in a supported scale-out configuration. | Predictable throughput improvement or documented bottleneck; atomic state/idempotency protects control numbers/logs/artifacts; no file duplication or conflicting cancellation. |
| PERF-09 | P1 | Replay same-ASN bursts while dashboard reads large logs and both flows upload concurrently. | No same-second output overwrite, missed log entry, read corruption or unbounded event-loop delay; measured dashboard responsiveness. |

Latency definitions: input latency starts at broker enqueue time (or carrier file availability); remote delivery ends when SFTP upload succeeds; acceptance ends at downstream acknowledgment/verified state. Report all three independently and record application start time. For file tests report poll wait separately.

Reconcile at both event and ASN/row level: published/available work = successfully handled work + explicitly skipped/rejected work + pending/retry work + DLQ/quarantined work. Separately reconcile attempted uploads, distinct remote artifacts and effective downstream changes. A completed broker event may contain multiple ASN outcomes; it is not automatically a successful output.

## Known High-Risk Gates to Prove

These are risks identified from the current implementation, not results from executed E2E tests:

| Gate | Current concern | Covering cases |
| --- | --- | --- |
| BST topic ingestion | No BST Service Bus consumer/contract yet. | CON-02, CON-07, BST-01 through BST-07, PERF-01 |
| Cancellation settlement | Handler resolves with errors; listener can complete unsuccessful events. | REC-02, REC-03, REC-06 |
| BST archive decision | Processing returns errors but caller can still archive input. | BST-10 |
| Delivery idempotency | No durable input-message deduplication is evident; duplicate detection alone is not logical-event deduplication. | REC-01, REC-03, REC-04 |
| Output uniqueness | BST filename resolution is one second plus ASN. | BST-12, PERF-09 |
| Shared booking safety | Unreadable blobs and bounded scans can leave safety evidence incomplete. | CAN-10 through CAN-12, PERF-05 |
| Multi-PO XML mapping | Cancellation builder creates one Order despite multiple PO references in grouped rows. | CAN-06 |
| Input/date validation | Invalid identifiers/calendar dates may pass through or trigger defaults; genuine XLS support unverified. | CON-06, BST-04 through BST-09 |
| State and scale-out | Synchronous local JSON read/write is not a distributed atomic counter/log store; corrupt JSON falls back to defaults in some paths. | CAN-13, REC-08, PERF-08 |
| Downstream evidence | Neither pipeline currently records E2open acknowledgment. | REC-11, OPS-01 |

## Run Record Template

Create one record per executed case/variant. Keep sensitive payloads in approved evidence storage, not source control.

| Field | Value |
| --- | --- |
| Run ID / case ID / variant | |
| Environment / build / application instances | |
| Input MessageId(s) / fixture manifest | |
| Topic/subscription or source filename | |
| Start/end UTC / output and acceptance times | |
| Expected / actual per-ASN outcomes | |
| Delivery count / completion / retry / DLQ | |
| Local/remote filenames / integrity evidence | |
| Logs/dashboard / downstream evidence references | |
| Performance metrics where applicable | |
| Result: Not run / Pass / Fail / Blocked | |
| Defect / owner / cleanup evidence | |

## Recommended Execution Order and Release Criteria

1. Establish both connection probes and confirm all contracts/gates. Run CON-01 through CON-07, explicitly marking BST topic integration blocked until implemented.
2. Run P0 cancellation and BST happy paths, XML mapping, multi-ASN, shared-VB and downstream acceptance cases.
3. Run P0 duplicates, partial failures, settlement, interruption, state and collision cases before load testing.
4. Run remaining negative, compatibility, dashboard, security and operational cases.
5. Execute baseline, forecast combined load and maximum-size tests; then approved bursts, outages, scale-out and soak.

Release requires all applicable P0 cases passed, no unresolved data-loss/unsafe-cancellation/duplicate-business-effect defects, all P1 failures dispositioned by owners, and signed-off capacity/latency/alert targets met. Blocked BST topic tests cannot be counted as passed. A local-only output or successful upload without the agreed downstream evidence does not qualify as complete E2E success. File-route retirement, if planned, requires separate owner sign-off after topic parity is established.