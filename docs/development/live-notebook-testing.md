# Live Notebook Testing With Built Artifacts

The repository includes the development skill [`siyuan-built-cjs-live-test`](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/tree/main/.agents/skills/siyuan-built-cjs-live-test). Its local entry is `.agents/skills/siyuan-built-cjs-live-test/SKILL.md`. It treats the freshly built CJS files as the system under test and runs isolated end-to-end checks against a real SiYuan test notebook.

Use it when tool or action changes require real-kernel verification, when strict safe writes or short-hash leases change, when HTTP/stdio/CLI behavior must agree, or when automated tests are insufficient evidence.

## Invocation

Ask a repository-aware agent to use the skill explicitly:

```text
Use $siyuan-built-cjs-live-test to validate every action affected by this change against the designated real SiYuan test notebook using the freshly built CJS files.
```

The workflow rebuilds and records `dist/mcp-server.cjs` and `cli/dist/cli.cjs`, then loads the Server bundle through a persistent interactive client:

```bash
node .agents/skills/siyuan-built-cjs-live-test/scripts/call-built-mcp.cjs \
  --server dist/mcp-server.cjs \
  --transport direct \
  --interactive
```

Keeping one process alive matters because preflight leases are intentionally in-memory. Starting a new CJS process between preflight and commit invalidates the lease.

## Safety and evidence

All mutations must target fixtures created for the current run inside the designated test notebook. The default workflow does not create SiYuan repository snapshots or invoke external side effects such as sync, notifications, feedback submission, third-party writes, or mascot purchases.

The final report must name actions that were covered, blocked, or intentionally excluded. Policy completeness and unit-test coverage do not count as a real action execution. See the skill and its `references/action-coverage.md` for the authoritative workflow.
