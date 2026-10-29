# Strict Safe Writes

Strict preflight and the state check before commit reload notebook permissions. An existing lease cannot bypass a later permission revocation, and granting permission does not require restarting the server.

Strict Safe Writes addresses three concrete risks: the target changing after it was read, a transport retry duplicating a mutation, and a repeated request being mistaken for a new one. It is enabled by default and does not create SiYuan data snapshots.

## Call flow

For a mutation with a precondition, first call the same action and business arguments with `validateOnly=true`:

```json
{
  "action": "update",
  "id": "20260812120000-abcdefg",
  "dataType": "markdown",
  "data": "New content",
  "validateOnly": true
}
```

The preflight reads without mutating, computes a complete SHA-256 digest, and creates a ten-minute lease inside the current MCP Server process. It returns `preconditionField` plus the shortest unique credential:

```json
{
  "validateOnly": true,
  "writeAttempted": false,
  "requestId": "b72f",
  "preconditionField": "expectedStateHash",
  "expectedStateHash": "8ac2",
  "hashPrefixLength": 4,
  "leaseExpiresAt": 1786543200000
}
```

The same response also contains a normalized `preflight` object (`version: 2`). It is the preferred client contract:

```json
{
  "preflight": {
    "version": 2,
    "requestId": "b72f",
    "expiresAt": 1786543200000,
    "ttlMs": 600000,
    "counts": { "operationCount": 1, "rowCount": 2, "cellCount": 4, "guardTargetCount": 1 },
    "commitArgs": {
      "action": "set_cells",
      "avID": "20260812120000-abcdefg",
      "cells": [],
      "validateOnly": false,
      "requestId": "b72f",
      "expectedManifestHash": "8ac2"
    }
  }
}
```

Copy `preflight.commitArgs` unchanged as the next call arguments. Do not reconstruct `requestId`, hash fields, or business arguments by hand. `counts` is action-specific: `operationCount` is always present; `rowCount`, `cellCount`, and `guardTargetCount` appear only when they can be computed, and equal values are never deduplicated into a smaller cell count. `expiresAt` and `ttlMs` describe the same ten-minute first-execution window. Top-level `requestId` and hash fields remain during the migration window for 0.6.13 clients; both describe one execution path, not a second retry mechanism. If a batch is too large to return executable arguments within the response limit, it is rejected explicitly rather than truncated.

### Impact preview

Every successful preflight also returns a top-level `preview` describing what the commit will change. Read it and compare it with the intent before committing:

```json
{
  "preview": {
    "detail": "summary",
    "targets": [{ "id": "20260812120000-abcdefg", "kind": "document", "title": "Meeting", "hPath": "/Meeting",
                  "notebook": { "id": "20260101000000-nbaaaaa", "name": "Work", "permission": "rw" } }],
    "changes": [{ "kind": "heading_to_doc", "summary": "Moves heading «Action items» and the 2 block(s) under it (3 blocks) out of «Meeting» into a new document «Action items» at Work:/Action items (at the notebook root). The source keeps 0 of 3 top-level block(s). The source document becomes EMPTY.", "movedBlockCount": 3 }],
    "risk": ["empties_source"]
  }
}
```

- `targets`: affected documents, blocks, databases, notebooks or tags, with hPath, notebook name and this client's permission.
- `changes`: one human-readable `summary` per change plus structured detail. Specific summaries exist for block update/replace/delete/move, fs write (overwrite)/replace/rm/mv/reorder, document remove/move/reorder/heading_to_doc/doc_to_heading, search find_replace, tag rename/remove and av remove_rows/remove_column/set_cells; other writes get a generic line with the key arguments.
- `risk`: any of `deletes`, `empties_source`, `cross_notebook`, `irreversible`, `large_batch` (more than 20 items), `workspace_wide`, `overwrites_content`.

The default detail truncates excerpts to about 200 characters and lists at most 5 entries per list. Pass `preview: "full"` (CLI `--preview full`) with `validateOnly=true` for complete before/after text. `preview` is response-only: it is excluded from the argument digest and `commitArgs`, and never changes the hash. The preview is built read-only; if it cannot be built, the preflight still succeeds with `preview: { "error": "..." }`.

The credential field name matches the write parameter, so copy that field and value directly. Remove `validateOnly` (or set it to `false`) and copy the returned `requestId`:

```json
{
  "action": "update",
  "id": "20260812120000-abcdefg",
  "dataType": "markdown",
  "data": "New content",
  "requestId": "b72f",
  "expectedStateHash": "8ac2"
}
```

Preflight issues `requestId` starting at four hex digits, extending it when an already-issued ID collides. Copy the complete value; never generate or truncate it, and reuse it unchanged for retries. First execution expires after 10 minutes (`requestIdExpiresAt`); executed results remain for up to seven days. Persistent ID reservations prevent reuse after expiry, contain no note bodies, and grow with issuance count. Additive operations also require preflight to obtain an ID.

Actions may use `expectedStateHash`, `expectedStructureHash`, `expectedManifestHash`, or `expectedSourceHash`. Read `preconditionField` instead of guessing. Additive actions have no state hash but still require the preflight-issued request ID for execution.

Credentials accept either `sha256:v1:<4-64 hex digits>` or bare `<4-64 hex digits>`, case-insensitively. Four digits are only a lease lookup key, not a 16-bit correctness check. The real write resolves the credential within `tool + action + business-argument digest + sorted target IDs`, retrieves the lease's complete 256-bit SHA-256, rereads current state, and compares the complete digests. Even a 64-digit credential must resolve to an active lease and cannot bypass preflight.

Preflight and receipts share a short-hash pool in the coordinator runtime. Before returning a hash, reuse its existing alias or start with four digits. If that alias belongs to a different full hash, extend one digit at a time and register the first available alias. An existing `abcd` stays unchanged; a later collision can receive `abcd1`. Resolution uses the exact registered alias, not a prefix search over leases. Do not shorten or extend issued credentials yourself.

The pool stores no note content. Aliases remain reserved for the process lifetime, even after leases expire or are consumed, and are never reassigned. Restart clears the pool and active leases; aliases are not permanent identifiers across restarts. Leases retain their operation scope, expiry, and capacity limits. Knowing an alias alone does not authorize a write.

`block.update` reports the number of distinct targets from either `id` or `items[].id` in `targetCount`. A batch of 11 different blocks reports 11; repeated IDs count once. Block state includes Kramdown, block attributes, and DOM, so inline changes such as block-reference `data-subtype`, `strong`, or `em` change the hash. DOM attribute order and creation/update timestamps do not count as content changes. Attribute drift after preflight returns `state_changed`; a successful attribute edit returns `committed`, while an unchanged readback returns `no_change`.

## Read hashes and one-step writes (opt-in)

`writeSafety.oneStep` is `off` by default (plugin settings → Safety settings → "One-step Low-risk Writes", stored as `"writeSafety": { "oneStep": "low_risk" }` in `mcpToolsConfig`). While it is off, reads, schemas, server instructions and the two-step flow above are unchanged, and a commit without `requestId` returns `precondition_required` exactly as before. Changing it restarts the plugin's HTTP server; reconnect clients to load the new schema. The setting is read by the selected coordinator (kernel or Node HTTP), so the CLI follows the same switch.

### Read hashes (`ifMatch`)

With one-step on, reads of a writable target add a top-level `ifMatch`: the first 16 hex digits of the same sha256:v1 state hash the strict preflight probe computes. The state is hashed **before** the read runs, so if the target changes in between, the caller holds an older hash than the content it saw and a later write fails closed. Targets the client cannot write (notebook permission `r`/`none`, missing targets) get no `ifMatch`.

| Read | Canonical probe (the hash equals this write's preflight credential) | Writes that accept the same `ifMatch` |
| --- | --- | --- |
| `block.get_kramdown` / `get_attrs` / `get_children` `{id}`, `document.get_doc {id}` | `block.update {id}` (`expectedStateHash`) | block `update`, `replace`, `set_attrs`, `set_fold_state`, `delete`; document `rename`, `set_attr`, `remove` (single `id`) |
| `fs.read {path}` | `fs.write {path}` with `overwrite=true` (`expectedStateHash`) | fs `write`, `replace`, `rm` |
| `av.get` / `av.query {avID}` | `av.set_cells {avID}` (`expectedManifestHash`) | av `add_rows`, `add_column`, `add_view`, `set_cells`, `remove_rows`, `remove_column`, `rename` |
| `file.read_template {path}` | `file.update_template {path}` with the path normalized to its `data/templates`-relative form | file `update_template`, `delete_template` |

Reads and writes of one target are both hashed through that single canonical probe call, so "read hash = preflight hash" holds by construction; sibling writes compare against the same canonical hash. A path must be spelled the same way in the read and the write (templates are normalized; fs paths are not). A batch shape (`items`) has no single target and rejects `ifMatch`.

`ifMatch` is accepted on any strict write (CLI `--if-match`), including a `validateOnly` preflight — there it closes the gap between the agent's read and the preflight. The server recomputes the canonical hash; a mismatch returns `state_changed` with `expectedField: "ifMatch"` and the hint to read the target again. `ifMatch` is stripped from the argument digest and from `commitArgs`; malformed values (fewer than 16 hex digits) return `invalid_arguments`. Only when one-step is on do the mounted schemas advertise `ifMatch` (a few hundred characters).

### One-step tiers

A commit without `requestId` may run in one step only when the setting is on and the tier allows it (`ONE_STEP_TIERS` in `src/core/write-safety-policy.ts`):

| Tier | Actions | One-step rule |
| --- | --- | --- |
| 1 — additive / low impact | document `create`, `rename`, `set_attr`; fs `write` (new document); block `insert`, `prepend`, `append`, `set_attrs`; av `add_rows`, `add_column`, `add_view`; flashcard `create_card`, `review_card` | Allowed without preflight; `ifMatch` optional (checked when present) |
| 2 — overwrites | block `update`, `replace`; fs `write` with `overwrite=true`; fs `replace` without `replace_all`; av `set_cells`; file `update_template` | Allowed only with a matching `ifMatch` for a single target |
| 3 — always two-step | every `dangerous` action, tag `rename`, document `heading_to_doc` / `doc_to_heading` / `reorder` / `move`, fs `reorder` / `mv`, block `transfer_references`, av `remove_rows` / `remove_column`, notebook `set_open_state` / `set_conf` / `rename`, fs `replace` with any `replace_all`, and every action not listed above (default deny) | Never |

Any write whose largest item list (`items`, `rows`, `blockIDs`, `primaryKeyTexts`, `cells`, `rowIDs`, `ids`, `edit`) exceeds 20 entries falls back to two-step.

A one-step commit skips only the round trip. It still reloads permissions, runs the same state probe and reference checks, verifies `ifMatch`, serializes through the coordinator, reads back, and writes the ledger. It receives a server-issued `requestId` (returned in `safety.requestId`; replaying the same arguments with it does not execute again) and the receipt carries `oneStep: { tier }` plus the same `preview` a preflight would have returned, so the agent can check the change after the fact. Because the ID is issued during the call, a transport loss before the response cannot be deduplicated by resending without it: on `outcome_unknown`, inspect the target instead of resending.

A refused one-step commit returns `precondition_required` with `error.oneStep: { allowed: false, tier, reason }`, where `reason` is `setting_off` (only when `ifMatch` was sent), `tier3`, `missing_if_match`, `if_match_unsupported` or `batch_too_large`, and the message names the two-step path (CLI: rerun with `--validate-only`). With one-step on, `action="help"` for a tier-1/2 topic adds `oneStep: { tier, rule }`.

## Correctness properties

- `fs` path readback checks live document existence before reading its block tree. Stale path or SQL indexes no longer turn a successful deletion into a readback failure. A failed existence query still leaves the outcome unknown; a network error never proves deletion.
- State is canonicalized with stable object-key ordering and preserved array ordering, then hashed with versioned SHA-256.
- `fs.reorder` and `document.reorder` use a structure precondition covering the parent, notebook configuration, and every visible direct child's ID, storage path, sort value, and current order. A concurrent create, delete, move, or reorder invalidates the lease; commit readback requires the exact requested order under custom sorting mode.
- The Agent submits a short credential, but correctness always compares two complete SHA-256 digests; the prefix is never compared directly to live state.
- The selected workspace authority (kernel when enabled, otherwise Node HTTP) owns one lease pool, ledger, and serial write coordinator. CLI, stdio, and Node HTTP use that same authority.
- Write HTTP requests are attempted once; read requests may still retry transient failures.
- The ledger records `executing` before dispatch and `committed` only after readback. It stores request/action/target identifiers and hashes. AV creation additionally persists reserved IDs, confirmed stages, and the complete small creation receipt for replay; it does not store note bodies or binary payloads.
- Reusing the same request ID and arguments does not execute again. Reusing it with different arguments returns `idempotency_conflict`.

## Failure semantics

| Code | Meaning | Caller action |
| --- | --- | --- |
| `precondition_required` | A request ID or required hash is absent, or a one-step commit was refused (`error.oneStep.reason`) | Run preflight again; never invent a hash |
| `preflight_lease_invalid` | The lease is missing, expired, evicted, or belonged to a previous process | Run the same `validateOnly` call again |
| `state_changed` | The target changed after preflight, or since the read that produced `ifMatch` | Stop and reread before deciding to write |
| `outcome_unknown` | The connection failed after execution began | Do not retry with a new ID; inspect the target |
| `readback_mismatch` | The returned mutation could not be verified | Treat the outcome as unknown |
| `idempotency_conflict` | The request ID was reused with different arguments | Generate a new ID |
| `write_coordinator_unavailable` | The selected coordinator cannot be discovered or reached | Check kernel/Node HTTP settings and preflight again |
| `kernel_endpoint_unsupported` | The Kernel endpoint is enabled but this SiYuan is older than 3.7.0 | Disable the Kernel endpoint and use the HTTP server, or upgrade SiYuan |
| `preflight_unavailable` | The action is an external side effect that cannot be read back | Preflight does not execute; a real call carries no strict guarantee |

## Boundaries

After user authorization, invoke external actions such as `feedback.submit` with business arguments only, without `validateOnly`, `requestId`, or hash credentials. Tool schemas advertise preflight fields only for enabled strict mutations; mixed tools name the applicable actions. An accidental `validateOnly` request returns a zero-execution error with a recovery hint.

For clients supporting form elicitation, MCP 2026-07-28 confirmation distinguishes `confirmation_declined` (explicit client refusal or `confirm=false`), `confirmation_cancelled` (explicit client cancellation), and `confirmation_invalid` (malformed, missing, or incorrectly typed content). Only explicit cancellation sets `cancelled=true`. Invalid content does not mean the user withdrew authorization: check client elicitation support without bypassing confirmation. Accepted confirmation still passes through permission and strict preflight checks.

Third-party and native SiYuan tools forwarded through `extension` are outside Sisyphus control and do not receive this guarantee. Local exports, notifications, sync, and feedback are also external side effects that cannot be verified through SiYuan state readback: `validateOnly` rejects without executing, while a real call still uses single-attempt transport and returns `writeSafetyGuaranteed: false`.

The guarantee applies only to mutations owned by Sisyphus and classified as `mutation` by its safety policy. MCP/Agent, stdio, and standalone CLI strict mutations enter the same selected coordinator; they do not create an independent lease pool, mutex, or ledger. If that coordinator is unavailable, the call fails with `write_coordinator_unavailable` rather than silently falling back to an uncoordinated write. Read-only actions do not need this path. `extension` is a separate official-MCP bridge, so its forwarded plugin/native calls are external side effects even when the downstream tool happens to edit notes.

Do not add a second queue or coordinator to “make strict writes safer.” The existing mutex, process-local leases, and metadata idempotency ledger are one coordination boundary; duplicating them would split leases and request history, so two paths could both believe they may execute. The ledger records request/action/target metadata and hashes, while the lease is in memory. Together they prevent Sisyphus retries and duplicate requests, but neither is a kernel compare-and-swap transaction.

This is not a kernel-level compare-and-swap transaction. The coordinator serializes every write that passes through Sisyphus, but the SiYuan UI, another plugin, or a direct kernel API caller can still write between the last state check and execution. Post-write readback exposes an abnormal final state but does not roll it back; inspect the target before acting on `outcome_unknown` or `readback_mismatch`.

The short-hash lease never calls `/api/repo/*`, creates no repository snapshots, and stores no note content. Success, no-change and replay `previousHash` / `resultHash`, conflict `expectedHash` / `currentHash`, and AV template, two-way relation, relation-value and rollup preimage/postimage hashes use the same alias pool. Internal comparisons and the idempotency ledger retain full SHA-256 values. Another write still requires a fresh preflight lease.

Export `sha256`, Markdown snapshot `scopeHash` / `inventoryHash` / `metadataHash` / `contentHash`, snapshot cursors, upload fingerprints and skill-resource manifest `digest` values retain full digests for file verification and incremental comparison across processes and restarts. Hash-like note content and third-party tool results are not rewritten.

Disabling Strict Safe Writes restores the legacy schema and direct invocation. Mutations still avoid transport retries, but responses state `writeSafetyGuaranteed: false`.

## Kernel endpoint and local port

When `kernelEndpointEnabled` is enabled, the kernel is the sole strict-write coordinator. CLI, stdio, and Node HTTP preflights and commits delegate to `/plugin/private/siyuan-plugins-mcp-sisyphus/mcp` on the SiYuan port. CLI discovery works even if the separate Node listener is disabled. Otherwise, Node HTTP remains the coordinator.

There is no automatic fallback between authorities. A connection failure returns `write_coordinator_unavailable`; a lost response after dispatch returns `outcome_unknown`. Inspect the target and reconcile with the original `requestId` at the same authority. Do not switch endpoints or issue a new ID to retry an uncertain write.

To change authorities, stop new writes, drain active calls, restart the plugin runtime and Node MCP server, then repeat preflight. A running Node process rejects an authority change with `write_coordinator_changed`. This is not a distributed lock and does not migrate live leases. Rollback requires the same drain/restart/preflight sequence. Direct kernel API calls and SiYuan UI edits remain outside this coordination boundary.

The kernel supports stateless MCP `2026-07-28` alongside legacy initialization through `2025-11-25`. Modern clients use `server/discover` and include protocol version and client capabilities in each request's `params._meta`. Help, rules, validation, App tools and HTML resources share the Node implementation. Modern App capabilities are per-request; legacy capabilities are session-scoped with a 30-minute idle expiry.

When the client supports form elicitation, modern dangerous calls use multi-round `input_required` / `elicitation/create` form confirmation; `confirm=true` alone cannot bypass it. An issued requestState binds the authenticated context, client declaration and normalized operation, expires after 5 minutes, and is consumed once on acceptance, decline or cancellation. At most 128 confirmations are retained. Changed arguments, forged, expired or reused states are rejected. Business requestId replay requires fresh confirmation, then the ledger deduplicates execution. Elicitation trusts the client to collect the user's choice; it is not cryptographic human attestation. Access control remains the host private route. Legacy callers retain the convention of passing `confirm=true` after obtaining confirmation. Authorized CLI calls and Node calls already confirmed at ingress answer confirmation on the internal hop.

Kernel template creation and updates use `/api/file/putFile` multipart, with a default 16 MiB template body budget (configurable to 32 MiB) and 64 KiB multipart overhead. The kernel cannot directly read the caller's `localFilePath`; CLI/Node provide the staging and download workflow described below. Local saving still requires a filesystem-capable client. Response size checks run after the Go host has buffered the response and do not impose a streaming memory limit on the host HTTP client.


### Kernel file transfer

CLI/Node automatically stage `upload_asset(localFilePath)` at the authenticated kernel `/plugin/private/siyuan-plugins-mcp-sisyphus/transfer/upload` endpoint, then use `uploadSource` for strict preflight/commit. CLI/Node POST raw bytes with `Content-Type: application/octet-stream` and a percent-encoded filename in `X-Sisyphus-File-Name`; the staging timeout is 120 seconds. Direct clients can use the same format or the compatible JSON `{fileName,dataBase64}` form, then pass the returned `uploadSource` instead of `localFilePath`. Binary transport avoids Base64 expansion; hashing still runs in the kernel JavaScript runtime, incrementally in 64 KiB batches with event-loop yields. Staging admits at most two simultaneous requests and returns HTTP 429 at capacity. CLI/Node first query `/transfer/lookup` with filename, full SHA-256 and size, reusing only an existing kernel-verified snapshot; a claimed digest cannot create a source. Staging has no workspace asset side effect: immutable bytes live in memory for 10 minutes, with a 10 MiB per-file, 32 MiB total and 64-entry cap. Expired entries are removed on the next stage/read; plugin reload clears all entries. Same content/name reuses the handle; changed content requires a new preflight. Upload preflight through CLI/Node also returns the handle for replay without local file access. Upload readback verifies the asset SHA-256. Files above the cap still require the Node coordinator; do not silently bypass the selected owner.

With the kernel coordinator selected, `export_resources(outputPath)` and `extract_doc` use `delivery=download`: the kernel returns a manifest and CLI/Node download using the configured authenticated SiYuan API, save locally and report SHA-256. Existing destinations are refused; sibling files are preserved; a failed extraction removes only its newly created directory. Direct kernel clients must save the manifest themselves. CLI/Node downloads stream to disk with incremental SHA-256, a 512 MiB limit per ZIP or complete document extraction, and a 120-second per-file deadline. Failure, cancellation or overflow cleans the owned partial output without restarting the transfer. This does not control buffering inside SiYuan. Exports remain external side effects, with no strict write guarantee and no executing validateOnly.

### Kernel concurrency and queued cancellation

Owned read actions run with concurrency 4. Mutations, external effects, extension calls and App session entry points use a separate FIFO admission lane with concurrency 1; WriteSafetyCoordinator remains the sole lease/ledger authority. Admission is capped at 128 in-flight calls including preparation. Excess calls return queue_full without tool execution. Each call loads its own permission snapshot at execution time. Concurrent reads/writes are not snapshot isolation.

Analytics, balance updates and display events use separate per-client storage queues. These are runtime-local, not cross-process locks. Calls still await metadata persistence, so slow storage can increase latency.

Legacy clients can send notifications/cancelled in the same Mcp-Session-Id with the original, type-sensitive JSON-RPC ID. Pending calls stop before execution; running reads stop at checkpoints after the current host call settles. Their concurrency slot remains occupied until settlement. Cancellation state is per call; running reads still record lifecycle statistics.

Modern clients may opt into the `io.siyuan.sisyphus/task-control` plugin extension: include a unique UUID under `params._meta["io.siyuan.sisyphus/taskId"]` on tools/call, then POST `{taskId, operation: "status" | "cancel" | "result"}` to `/tasks` under the same authenticated private plugin route. The authentication context must match. The response includes found, state, cancelRequested, committing, and accepted for cancellation. Acceptance means stop subsequent steps, not interruption of native I/O. Version 2 retains terminal records for 10 minutes, at most 128 records / 8 MiB total / 1 MiB per result. Status omits the body; result retrieves the original tool result. Oversized bodies report result_too_large. Changed permissions or tool configuration report access_changed without disclosing the old body. Intermediate input_required confirmations are not cached as terminal results. Records are memory-only and may expire, be evicted, or disappear on reload; found=false does not prove success or failure. Reconcile writes using the original business requestId.

CLI Ctrl-C during kernel delegation and Node MCP cancellation during delegated calls relay this control message without retrying the business request. A synchronous barrier before the executing ledger entry rejects cancellation once commit starts, allowing mutation, readback and ledger persistence to finish. External side effects also use this barrier. Caller-side downloads can stop independently.

This is an optional plugin extension. Merely disconnecting a direct modern HTTP client still cannot notify the kernel JS handler. Single native requests cannot be forcibly interrupted and started writes cannot be undone. No SiYuan core modification is required. Authenticated /health exposes aggregate queue counts, cancelled-but-running reads and staging admission counts.

### Tool notifications and response recovery

On hosts exposing plugin SSE, legacy initialize advertises tools.listChanged. GET the same /mcp endpoint with matching authentication, Mcp-Session-Id and Accept exactly text/event-stream. The stream sends an initial notifications/tools/list_changed invalidation, then checks configuration and exposed tools every 5 seconds and coalesces unchanged snapshots. Limits: 4 connections per authentication context, 64 total, 10 minutes per connection. Expired sessions, endpoint disablement or inspection failure close connections. Reconnect and list tools again; notifications have no replay history. Closing a shared stream does not cancel tool calls. This is a legacy MCP channel, not a notification extension to stateless modern MCP.

CLI/Node assign a taskId to every delegated kernel call. After losing the response they query only that task's result up to 3 times (2-second timeout each, 100 ms between attempts), then resume normal result/export processing if recovered. They never resubmit the business call automatically. Unavailable results return outcome_unknown with taskId for later queries. Reusing a live or retained terminal taskId for tools/call is rejected; business replay uses a new taskId and the original business requestId.

### Read budgets

Owned ordinary read-only kernel actions allow at most 128 scoped API calls and 8 MiB of decoded returned data in aggregate (UTF-8/binary counting). Overflow returns read_budget_exceeded even if an inner handler catches the exception; narrow the query or request smaller pages. Mutations, external actions, extension calls and App session entry points are excluded, so committed writes/readback are never interrupted by this budget. It bounds subsequent plugin work, not the host's already-buffered response or independent analytics writes. Existing action pagination parameters remain available.

Authenticated /health includes events, taskResults and readBudget counters without task IDs, authentication values or content. Drain committing writes before rollback/reload, then rediscover capabilities and repeat preflight. Result caches, SSE connections and upload staging do not survive reload.

See [kernel options](kernel-options.md) for image/template budgets, read retries, pagination and Origin configuration. The exclusive streaming saver applies to kernel delegation; Node-only export behavior remains unchanged.

Form capability follows MCP conventions: `elicitation: {}` or `elicitation: { form: {} }` supports the dialog; absent or URL-only declarations do not. Skipping the dialog does not imply user consent; agents must still follow the authorized scope. Removing capabilities cannot bypass an issued kernel confirmation: its bound request state remains validated.
