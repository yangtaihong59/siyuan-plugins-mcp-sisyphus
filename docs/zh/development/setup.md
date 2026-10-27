# 环境搭建

这个页面覆盖本地开发前置条件和当前仓库结构。

适用场景：你刚开始接手这个代码库。

## 前置要求

- Node.js 20.x 或更高
- `pnpm`
- 本地思源安装，用于测试

## 安装

```bash
git clone https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus.git
cd siyuan-plugins-mcp-sisyphus
pnpm install
```

## 项目结构

- `src/index.ts`: 插件入口
- `src/mcp/server.ts`: MCP 服务入口
- `src/tools/`: 工具实现；每个工具独立目录，工具层共享代码放在 `src/tools/internal/`
- `src/cli/`: CLI 入口与派发
- `src/api/`: SiYuan API 封装
- `tests/`: unit / integration / smoke 测试
