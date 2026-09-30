# Kernel plugin options

All changes live in the plugin. The attachment upload ceiling is **10 MiB**.

Merge these fields into `/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpHttpSettings` through SiYuan's file API, preserving existing authentication and server settings. Advanced options are currently file-configured and preserved by the settings panel.

```json
{
  "skillsExtensionEnabled": true,
  "kernelOptions": {
    "readMaxRequests": 128,
    "readMaxMiB": 8,
    "readTimeoutMs": 30000,
    "readRetries": 3,
    "templateMaxMiB": 16,
    "allowedOrigins": []
  }
}
```

- Read limits: 16–512 requests including retries; 1–64 MiB decoded bodies. Image reads receive another 20 MiB allowance for the image; the existing per-image 20 MiB limit remains.
- Read deadline: 1–120 seconds after execution starts, checked cooperatively. Native host I/O retains its slot until completion. Committing writes and their readback are not interrupted.
- Read retries: 0–3 additional attempts, with 100/200/400ms backoff, only for transport failures and HTTP 429/5xx on explicit read methods. Writes and external submissions are never automatically retried.
- Template size: 1–32 MiB UTF-8 source, default 16 MiB, plus 64 KiB multipart overhead. Other workspace writes use an 8 MiB multipart budget.
- Origins: at most 32 exact HTTP(S) origins, no credentials, paths or wildcards. Same-host requests remain accepted. This does not bypass host authentication, cross-site policy or proxy CORS requirements.
- Skills use the existing switch for declarations, SEP methods and file resources; general help stays available. Reconnect clients after changing negotiated capabilities.

`block.docs_info` retains its existing `id/ids` contract. Split a large ID list into smaller ordered batches when the kernel budget is exceeded; the action parameters and response format are unchanged. Markdown snapshots and database reads retain their existing pagination.

Budget/deadline errors return `complete=false` and recovery guidance; suggested arguments never advance a failed page. No arbitrary SQL rewriting or silent truncation. Resource body consumption is charged, but Go still buffers before JavaScript checks the budget.

Feedback and opted-in telemetry use the existing authenticated `forwardProxy` API with bounded timeouts, encoded payloads and no redirects or automatic submission retries. Host destination/permission limits still apply. Telemetry remains disabled by default; failures are exposed through redacted `/health.telemetry` diagnostics. Both modern and legacy discovery advertise the MCP App UI extension and MIME type.

CLI/Node downloads delegated to the kernel use an exclusive streaming saver: 512 MiB per ZIP/extraction, 120 seconds per file, byte counts and SHA-256 receipts. Existing files/directories are rejected; failed extraction removes only its newly created directory, preserving siblings. Missing assets fail the export instead of silently producing a partial success. Use a fresh destination for subsequent exports. Automatic resumable downloads are not implemented. Without kernel delegation, Node may overwrite ZIP targets; extraction clears its output root and skips unreadable assets.

Direct kernel clients should request `delivery=download` and save the manifest via authenticated `getFile`. Inline assets share an 8 MiB aggregate ceiling. Arbitrary caller filesystem access, native host cancellation/streaming, standalone TLS, stdio and remote-instance routing still need the appropriate client/bridge/host support.

For rollback, set retries to zero, restore defaults and clear the Origin allowlist. Drain tasks before switching ownership; reconcile unknown writes by their original requestId before retrying. Reloading clears in-memory sessions and receipts. Acceptance scope and artifact hashes are recorded in the [kernel endpoint guide (Chinese)](../development/kernel-endpoint.md#验证结果).

Large templates still require JavaScript SHA-256 validation and may exceed client default timeouts. Allow sufficient client waiting time; after a timeout, reconcile using the original requestId rather than assuming no write occurred. UTF-8 encoding uses the existing native host Buffer without skipping hash or idempotency checks.
