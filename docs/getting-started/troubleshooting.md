# Troubleshooting

This page groups common failures and quick checks for MCP connectivity.

When to read this page: the server does not start, tools are not visible, or calls fail after connection.

Related pages:

- [Deployment](./deployment.md)
- [HTTPS](./https.md)

## Connection Failed

Check these first:

- Is SiYuan running and its API reachable on `6806`?
- Is the plugin enabled?
- If using HTTP, is the MCP server started on `36806`?
- If using stdio, is the `mcp-server.cjs` path correct and readable from the MCP client machine?
- In Docker setups, do not use a container-only path like `/siyuan/workspace/data/plugins/.../mcp-server.cjs` unless that path is mounted on the client machine. Copy `mcp-server.cjs` to a client-side path or extract it from the release package.

## HTTP start button is disabled after turning off document snapshots and Diff

On SiYuan 3.8.1 with plugin 0.6.7, startup errors containing `removeDockFromPosition`, `toggleModel`, and `Cannot read properties of null (reading 'getAttribute')` indicate that dock cleanup tried to access a missing button. This interrupts plugin loading before the HTTP launcher is initialized.

To recover temporarily, enable document snapshots and Diff, then reload the plugin. Versions containing this fix check that the button and model exist before calling SiYuan's dock methods, allowing HTTP initialization with the feature disabled.

## Tools Not Visible

- Confirm the client is connected to the MCP endpoint
- Confirm the plugin-side tool config did not disable the tool
- If using HTTP, restart the MCP server after settings changes

## Calls Fail After Connection

- Verify bearer token or `SIYUAN_TOKEN`
- Verify notebook permissions for the target notebook
- Confirm you are using the right path type for document actions

## Permission Denied

Permission levels:

- `rwd`: read, write, delete
- `rw`: read, write
- `r`: read only
- `none`: no access

If a call fails, check both:

- notebook-level permission config
- whether the action itself is high-risk or disabled

## Logs and Quick Reference

Default ports:

- SiYuan API: `6806`
- MCP HTTP: `36806`

Useful locations:

- Plugin bundle: `{workspace}/data/plugins/siyuan-plugins-mcp-sisyphus/`
- `mcp-server.cjs`: same directory as the plugin bundle

Common stdio error:

- `Failed to reconnect ... -32000`: often means the MCP client could not start `mcp-server.cjs` or the server could not reach `SIYUAN_API_URL`. For Docker, first check that `args` points to a client-side file path and `SIYUAN_API_URL` points to the reachable SiYuan API endpoint, usually `http://<docker-host-ip>:6806`.

Desktop HTTP MCP uses the current workspace window’s actual API origin, including random ports, and refuses to start when that origin is unavailable. HTTP 401 means authentication failure, 403 means HTTP access denied, and 429 means rate limiting; these responses no longer instruct users to start SiYuan. Standalone deployments still use `SIYUAN_API_URL`. The copied AI setup prompt asks for global versus project/workspace scope before updating configuration.

## Enabling database filters breaks MCP schema loading

Errors mentioning `unresolvable $ref`, `$defs`, or `filters/items` can occur while loading the tool list, before any note operation. Older aggregated schemas dropped recursive filter definitions. After updating to a version containing the fix, restart the MCP Server actually used by your client (including its stdio child process) and refresh the tool list. If updating is not yet possible, temporarily disable the database `set_filters` action and reconnect.

If schema loading succeeds but `set_filters` intermittently returns `state_changed` after preflight, older code may also mistake DOM attribute serialization order for a content change. View-configuration preflights now normalize carrier attribute order while preserving attribute values and database bindings; actual state drift still rejects the write.

If the provider reports `recursive $ref cannot be inlined`, it rejects recursive schemas even when all references resolve. Versions containing this fix publish a bounded filter schema matching runtime validation and the kernel limit of four nested groups followed by a leaf. Update the MCP Server actually used by the client and refresh its tool list. Temporarily disabling `av.set_filters` also removes the problematic schema.

## Desktop kernel is running but MCP returns kernel_unreachable

A desktop workspace may use `https://127.0.0.1:<dynamic-port>`. Electron can accept its local certificate while the MCP Node child rejects it with `fetch failed`. For loopback origins, the launcher uses the kernel HTTP interface on the same workspace port; remote HTTPS origins keep TLS verification. After updating dev artifacts, disable and re-enable Sisyphus in plugin settings so the launcher rereads the address.

With multiple workspaces open, generated stdio configurations and AI setup prompts use each window's kernel origin, paired with that workspace's script path and token, instead of a fixed port 6806. Existing client configurations must be recopied, including after the dynamic kernel port changes. If both workspaces run MCP HTTP servers, assign different MCP listening ports.
