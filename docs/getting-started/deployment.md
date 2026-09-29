# Deployment

This page covers installation, connection modes, and environment-specific setup.

When to read this page: you need to connect an MCP client or configure the plugin for local, WSL, Docker, or LAN usage.

Related pages:

- [Getting Started](./index.md)
- [HTTPS](./https.md)
- [Troubleshooting](./troubleshooting.md)

## Installation

### Marketplace

1. Open SiYuan Note
2. Go to `Settings -> Marketplace`
3. Search for `SiYuan Sisyphus`
4. Install and enable the plugin

### From Source

```bash
git clone https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus.git
cd siyuan-plugins-mcp-sisyphus
pnpm install
pnpm build
pnpm make-link
```

## Connection Modes

| Scenario | Recommended Mode | Why |
|----------|------------------|-----|
| Desktop local machine | HTTP or stdio | Both are supported directly |
| Docker / remote SiYuan | stdio, or HTTP sidecar | stdio is simplest for desktop clients; a second Node container can host HTTP when you need a long-running Docker service |
| WSL / cross-machine | HTTP | Easier cross-environment connectivity |
| stdio-only MCP client | `mcp-remote` bridge | Reuses the HTTP endpoint |

## HTTP Mode

Plugin-side settings:

- Host: `127.0.0.1` by default, `0.0.0.0` for remote access
- Port: `36806`
- Keep bearer token enabled
- Start the server and optionally enable auto-start

Client config (Claude Code, Cursor, Cline, etc.):

```json
{
  "mcpServers": {
    "siyuan": {
      "type": "http",
      "url": "http://127.0.0.1:36806/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Cherry Studio uses `streamableHttp`:

```json
{
  "mcpServers": {
    "siyuan": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:36806/mcp",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

Notes:

- Claude Code requires `"type": "http"`
- Cherry Studio requires `"type": "streamableHttp"`
- When binding to `0.0.0.0`, keep token auth enabled

## stdio Mode

Generated stdio configurations use the fixed endpoint `http://127.0.0.1:6806` so they do not retain a random port that may change after restart. On desktop, this port belongs to the first workspace started; the API token must match that workspace. To connect to other workspaces, use their configured HTTP MCP endpoints.

Use `mcp-server.cjs` as a subprocess and point it at the SiYuan API.

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "node",
      "args": ["/path/to/mcp-server.cjs"],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_TOKEN": "xxxxxx"
      }
    }
  }
}
```

Notes:

- `6806` is the SiYuan API port, not the MCP port
- `mcp-server.cjs` is usually under `{workspace}/data/plugins/siyuan-plugins-mcp-sisyphus/`
- The `args` path must be readable by the MCP client machine, because Claude Code, Cursor, Cline, and similar clients start this file as a local subprocess
- stdio serves one client process at a time

## `mcp-remote` Bridge

Use this when your client supports stdio only:

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://127.0.0.1:36806/mcp",
        "--header",
        "Authorization: Bearer <token>"
      ]
    }
  }
}
```

## Environment Variables

Core:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SIYUAN_API_URL` | `http://127.0.0.1:6806` | SiYuan API endpoint |
| `SIYUAN_TOKEN` | none | SiYuan API token |
| `SIYUAN_MCP_TRANSPORT` | `stdio` | Transport mode |

HTTP mode:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SIYUAN_MCP_HOST` | `127.0.0.1` | Bind host |
| `SIYUAN_MCP_PORT` | `36806` | Bind port |
| `SIYUAN_MCP_TOKEN` | none | Bearer token |
| `SIYUAN_MCP_PATH` | `/mcp` | HTTP endpoint path |

## Deployment Scenarios

### Docker

- Expose SiYuan port `6806`
- Run `mcp-server.cjs` on the client side
- Keep the SiYuan API token enabled
- Do not expose `6806` publicly without extra protection

In Docker setups, the path copied from the SiYuan plugin panel may point inside the container, for example `/siyuan/workspace/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs`. A desktop MCP client cannot execute that container path unless the same path is mounted and visible on the client machine.

Use this layout instead:

```json
{
  "mcpServers": {
    "siyuan-local": {
      "command": "node",
      "args": ["/any/client-side/path/mcp-server.cjs"],
      "env": {
        "SIYUAN_API_URL": "http://<docker-host-ip>:6806",
        "SIYUAN_TOKEN": "<siyuan-token>"
      },
      "type": "stdio"
    }
  }
}
```

You can get `mcp-server.cjs` from either:

- the plugin directory in the SiYuan Docker workspace, then copy it to the MCP client machine
- the release `package.zip`, then extract `mcp-server.cjs`

If you copy the file manually, update it again after plugin upgrades so the client-side server matches the installed plugin version.

If you cannot or do not want to run Node/npm on the MCP client machine, you can also run a second Node container as an HTTP MCP sidecar. The important detail is that `SIYUAN_API_URL` must point to the SiYuan container or host from inside the Node container. Do not leave it as `127.0.0.1`, because that points back to the Node container itself and commonly causes `kernel_unreachable`.

Example `docker-compose.yml`:

```yaml
services:
  siyuan:
    image: b3log/siyuan:latest
    container_name: siyuan
    command:
      - --workspace=/siyuan/workspace/
      - --accessAuthCode=${SIYUAN_ACCESS_AUTH_CODE}
    ports:
      - "6806:6806"
    volumes:
      - siyuan-workspace:/siyuan/workspace

  siyuan-mcp:
    image: node:20-alpine
    container_name: siyuan-mcp
    depends_on:
      - siyuan
    working_dir: /siyuan/workspace/data/plugins/siyuan-plugins-mcp-sisyphus
    command: ["node", "mcp-server.cjs", "--http"]
    environment:
      SIYUAN_API_URL: http://siyuan:6806
      SIYUAN_TOKEN: ${SIYUAN_TOKEN}
      SIYUAN_MCP_HOST: 0.0.0.0
      SIYUAN_MCP_PORT: 36806
      SIYUAN_MCP_TOKEN: ${SIYUAN_MCP_TOKEN}
    ports:
      - "36806:36806"
    volumes:
      - siyuan-workspace:/siyuan/workspace:ro

volumes:
  siyuan-workspace:
```

In this layout:

- install or extract the plugin into the SiYuan workspace first, so the shared volume contains `data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs`
- clients connect to `http://<docker-host-ip>:36806/mcp` with `Authorization: Bearer <SIYUAN_MCP_TOKEN>`
- inside Compose, `http://siyuan:6806` works because both containers share the same Docker network
- if the MCP container is not in the same Compose network, use a reachable host/LAN address instead, for example `http://host.docker.internal:6806` or `http://<docker-host-ip>:6806`

### WSL

- Bind plugin HTTP server to `0.0.0.0`
- Use the Windows host IP from WSL
- Keep bearer token enabled

### LAN

- Bind to `0.0.0.0`
- Open firewall access for `36806`
- Use the host machine LAN IP
- Keep bearer token enabled
