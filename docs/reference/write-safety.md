# Strict Safe Writes

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
  "preconditionField": "expectedStateHash",
  "stateHash": "sha256:v1:8ac2",
  "hashPrefixLength": 4,
  "leaseExpiresAt": 1786543200000
}
```

Generate a fresh UUIDv7 and submit the real write once with that field:

```json
{
  "action": "update",
  "id": "20260812120000-abcdefg",
  "dataType": "markdown",
  "data": "New content",
  "requestId": "019c1234-5678-7abc-8def-0123456789ab",
  "expectedStateHash": "sha256:v1:8ac2"
}
```

Actions may use `expectedStateHash`, `expectedStructureHash`, `expectedManifestHash`, or `expectedSourceHash`. Read `preconditionField` instead of guessing. Additive actions have no state hash but still require a fresh UUIDv7 for execution.

Credentials accept either `sha256:v1:<4-64 hex digits>` or bare `<4-64 hex digits>`, case-insensitively. Four digits are only a lease lookup key, not a 16-bit correctness check. The real write resolves the credential within `tool + action + business-argument digest + sorted target IDs`, retrieves the lease's complete 256-bit SHA-256, rereads current state, and compares the complete digests. Even a 64-digit credential must resolve to an active lease and cannot bypass preflight.

If active hashes in the same operation scope share four digits, a new preflight automatically returns the shortest unique prefix of five or more digits. If a previously issued short prefix becomes ambiguous later, the server neither guesses nor returns candidate hashes; it requires another preflight. Leases exist only in memory, contain no note body, and disappear on plugin/MCP Server restart. A committed or uncertain write also consumes its lease.

## Correctness properties

- State is canonicalized with stable object-key ordering and preserved array ordering, then hashed with versioned SHA-256.
- The Agent submits a short credential, but correctness always compares two complete SHA-256 digests; the prefix is never compared directly to live state.
- The plugin HTTP server owns one process-wide serial write coordinator. CLI and stdio strict writes forward to that coordinator instead of creating independent write paths.
- Write HTTP requests are attempted once; read requests may still retry transient failures.
- The ledger records `executing` before dispatch and `committed` only after readback. It stores request/action/target identifiers and hashes, never note bodies or binary payloads.
- Reusing the same request ID and arguments does not execute again. Reusing it with different arguments returns `idempotency_conflict`.

## Failure semantics

| Code | Meaning | Caller action |
| --- | --- | --- |
| `precondition_required` | A request ID or required hash is absent | Run preflight again; never invent a hash |
| `preflight_lease_invalid` | The lease is missing, expired, evicted, or belonged to a previous process | Run the same `validateOnly` call again |
| `ambiguous_hash_prefix` | The prefix matches multiple active leases in this scope | Re-preflight and use the newly issued longer prefix |
| `state_changed` | The target changed after preflight | Stop and reread before deciding to write |
| `outcome_unknown` | The connection failed after execution began | Do not retry with a new ID; inspect the target |
| `readback_mismatch` | The returned mutation could not be verified | Treat the outcome as unknown |
| `idempotency_conflict` | The request ID was reused with different arguments | Generate a new ID |
| `write_coordinator_unavailable` | CLI/stdio cannot reach the plugin coordinator | Enable the plugin HTTP server and preflight again |
| `preflight_unavailable` | The action is an external side effect that cannot be read back | Preflight does not execute; a real call carries no strict guarantee |

## Boundaries

Third-party and native SiYuan tools forwarded through `extension` are outside Sisyphus control and do not receive this guarantee. Local exports, notifications, sync, and feedback are also external side effects that cannot be verified through SiYuan state readback: `validateOnly` rejects without executing, while a real call still uses single-attempt transport and returns `writeSafetyGuaranteed: false`.

The guarantee applies only to mutations owned by Sisyphus and classified as `mutation` by its safety policy. A direct MCP/Agent call over the plugin HTTP server enters the process-wide coordinator. Strict mutations arriving through stdio or the standalone CLI are forwarded to that same plugin-hosted HTTP coordinator; they do not create an independent lease pool, mutex, or ledger. If that coordinator is unavailable, the call fails with `write_coordinator_unavailable` rather than silently falling back to an uncoordinated write. Read-only actions do not need this path. `extension` is a separate official-MCP bridge, so its forwarded plugin/native calls are external side effects even when the downstream tool happens to edit notes.

Do not add a second queue or coordinator to “make strict writes safer.” The existing mutex, process-local leases, and metadata idempotency ledger are one coordination boundary; duplicating them would split leases and request history, so two paths could both believe they may execute. The ledger records request/action/target metadata and hashes, while the lease is in memory. Together they prevent Sisyphus retries and duplicate requests, but neither is a kernel compare-and-swap transaction.

This is not a kernel-level compare-and-swap transaction. The coordinator serializes every write that passes through Sisyphus, but the SiYuan UI, another plugin, or a direct kernel API caller can still write between the last state check and execution. Post-write readback exposes an abnormal final state but does not roll it back; inspect the target before acting on `outcome_unknown` or `readback_mismatch`.

The short-hash lease itself never calls `/api/repo/*`, creates no SiYuan repository snapshots, and stores no full content for preflight (the timeline tool's existing repository-state reads are unrelated to lease storage). Complete audit digests such as `previousHash` and `resultHash` in successful responses are not credentials for the next write; another preflight is required to create an active lease.

Disabling Strict Safe Writes restores the legacy schema and direct invocation. Mutations still avoid transport retries, but responses state `writeSafetyGuaranteed: false`.
