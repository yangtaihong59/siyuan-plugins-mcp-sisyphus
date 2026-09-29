# 部署指南

这个页面覆盖安装、连接方式和不同运行环境下的配置。

适用场景：你需要把 MCP 客户端连到插件，或者在本机、WSL、Docker、局域网场景下完成配置。

相关页面：

- [快速开始](./index.md)
- [HTTPS 配置](./https.md)
- [故障排查](./troubleshooting.md)

## 安装

### 从集市安装

1. 打开思源笔记
2. 进入 `设置 -> 集市`
3. 搜索 `SiYuan Sisyphus`
4. 安装并启用插件

### 从源码安装

```bash
git clone https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus.git
cd siyuan-plugins-mcp-sisyphus
pnpm install
pnpm build
pnpm make-link
```

## 连接方式

| 场景 | 推荐方式 | 原因 |
|------|----------|------|
| 桌面端本机使用 | HTTP 或 stdio | 两者都可直接使用 |
| Docker / 远程思源 | stdio，或 HTTP sidecar | 桌面客户端用 stdio 最简单；如果需要 Docker 内常驻 HTTP 服务，可以再起一个 Node 容器 |
| WSL / 跨机器 | HTTP | 更容易跨环境连接 |
| 只支持 stdio 的 MCP 客户端 | `mcp-remote` bridge | 复用 HTTP 端点 |

## HTTP 模式

插件侧设置：

- Host：默认 `127.0.0.1`，远程访问时用 `0.0.0.0`
- Port：`36806`
- 保持 Bearer Token 开启
- 启动服务，必要时启用自动启动

客户端配置（Claude Code、Cursor、Cline 等）：

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

Cherry Studio 使用 `streamableHttp`：

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

说明：

- Claude Code 必须包含 `"type": "http"`
- Cherry Studio 必须包含 `"type": "streamableHttp"`
- 绑定 `0.0.0.0` 时一定要保留 Token 鉴权

## stdio 模式

插件生成的 stdio 配置固定使用 `http://127.0.0.1:6806`，避免保存重启后可能变化的随机端口。桌面端该端口属于第一个启动的工作空间；API Token 必须与该工作空间一致。要连接其他工作空间，请使用各工作空间配置的 HTTP MCP 地址。

让客户端把 `mcp-server.cjs` 作为子进程运行，并连接思源 API。

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

说明：

- `6806` 是思源 API 端口，不是 MCP 端口
- `mcp-server.cjs` 一般在 `{workspace}/data/plugins/siyuan-plugins-mcp-sisyphus/`
- `args` 中的路径必须能被 MCP 客户端所在机器读取，因为 Claude Code、Cursor、Cline 等客户端会把这个文件作为本地子进程启动
- stdio 每次只服务一个客户端进程

## `mcp-remote` 桥接

当客户端只支持 stdio 时，可使用：

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

## 环境变量

核心变量：

| 变量 | 默认值 | 作用 |
|------|--------|------|
| `SIYUAN_API_URL` | `http://127.0.0.1:6806` | 思源 API 地址 |
| `SIYUAN_TOKEN` | 无 | 思源 API Token |
| `SIYUAN_MCP_TRANSPORT` | `stdio` | 传输模式 |

HTTP 模式：

| 变量 | 默认值 | 作用 |
|------|--------|------|
| `SIYUAN_MCP_HOST` | `127.0.0.1` | 绑定地址 |
| `SIYUAN_MCP_PORT` | `36806` | 绑定端口 |
| `SIYUAN_MCP_TOKEN` | 无 | Bearer Token |
| `SIYUAN_MCP_PATH` | `/mcp` | HTTP 路径 |

## 部署场景

### Docker

- 暴露思源端口 `6806`
- 在客户端侧运行 `mcp-server.cjs`
- 保持思源 API Token 开启
- 不要在没有额外保护的情况下暴露 `6806`

Docker 场景下，思源插件面板复制出来的路径可能是容器内路径，例如 `/siyuan/workspace/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs`。桌面 MCP 客户端无法执行这个容器路径，除非同一个路径已经挂载并且在客户端机器上可见。

应改成下面这种结构：

```json
{
  "mcpServers": {
    "siyuan-local": {
      "command": "node",
      "args": ["/客户端机器上的任意路径/mcp-server.cjs"],
      "env": {
        "SIYUAN_API_URL": "http://<docker-host-ip>:6806",
        "SIYUAN_TOKEN": "<siyuan-token>"
      },
      "type": "stdio"
    }
  }
}
```

`mcp-server.cjs` 可以从两个地方获取：

- 从思源 Docker 工作空间里的插件目录复制到 MCP 客户端机器
- 下载 release 的 `package.zip`，解压其中的 `mcp-server.cjs`

如果手动复制该文件，后续升级插件后也需要重新复制，保证客户端侧 server 与已安装的插件版本一致。

如果 MCP 客户端所在机器不能或不想安装 Node/npm，也可以再起一个 Node 容器作为 HTTP MCP sidecar。关键点是：`SIYUAN_API_URL` 必须填写从 Node 容器内部可以访问到的思源地址。不要保留默认的 `127.0.0.1`，因为它会指向 Node 容器自己，常见现象是返回 `kernel_unreachable`。

示例 `docker-compose.yml`：

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

这个结构里：

- 需要先把插件安装或解压到思源工作空间，确保共享卷里存在 `data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs`
- 客户端连接 `http://<docker-host-ip>:36806/mcp`，并带上 `Authorization: Bearer <SIYUAN_MCP_TOKEN>`
- 在同一个 Compose 网络里，`http://siyuan:6806` 会通过 Docker service name 访问思源容器
- 如果 MCP 容器不在同一个 Compose 网络里，请改用它能访问到的宿主机或局域网地址，例如 `http://host.docker.internal:6806` 或 `http://<docker-host-ip>:6806`

### WSL

- 插件 HTTP 绑定到 `0.0.0.0`
- 在 WSL 中使用 Windows 宿主机 IP
- 保持 Bearer Token 开启

### 局域网

- 绑定到 `0.0.0.0`
- 放行 `36806` 端口
- 使用宿主机局域网 IP
- 保持 Bearer Token 开启
