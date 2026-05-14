---
name: siyuan-plugin-pub
description: Publish the SiYuan Sisyphus plugin and/or standalone CLI from this repo, keeping plugin and CLI versions separate, updating release notes/docs, and preparing exact commit/tag/publish commands.
---

# SiYuan Plugin Pub

Use this skill when the user wants to publish a new version of this SiYuan Sisyphus repo. The repo now ships two related but independently versioned products:

- **SiYuan plugin / MCP server**: marketplace plugin metadata and bundled `dist/mcp-server.cjs`
- **Standalone CLI**: npm package `siyuan-sisyphus`, with `siyuan-sisyphus` and `siyuan` binaries

Always decide whether the requested release is plugin-only, CLI-only, or combined before editing files.

This repo already keeps release history in:

- `plugin.json`
- `package.json`
- `CHANGELOG.md`
- `README.md`
- `README_zh_CN.md`
- `cli/package.json`
- `cli/README.md`
- `cli/README_zh_CN.md`
- `docs/development/release-cli.md`
- `docs/zh/development/release-cli.md`

## Repo-Specific Rules

- Keep plugin versions in `plugin.json` and root `package.json` on the exact same version string such as `0.3.4`.
- Keep CLI version in `cli/package.json` independent from the plugin version, such as `0.1.5`. Do not force it to match the plugin version.
- `CHANGELOG.md` is the source of truth for plugin release notes and uses Chinese entries with newest plugin version on top.
- `README.md` and `README_zh_CN.md` both maintain the latest plugin version callout near the top; update both for plugin releases.
- `cli/README.md` and `cli/README_zh_CN.md` describe standalone CLI usage; update them when CLI behavior, install flow, or command syntax changes.
- `docs/development/release-cli.md` and `docs/zh/development/release-cli.md` are the CLI publish docs; keep them aligned when release procedure changes.
- Prefer matching the repo's recent commit style, for example:
  - `feat：新增文档头图与本地上传确认流程，整理代码并发布 v0.1.11`
  - `feat：优化 MCP tool 行为一致性并发布 v0.1.10`
- Do not run `git tag` or `git push` until the user explicitly wants to execute publish commands.

## Recommended Workflow

1. Classify the release:
   - plugin-only: MCP server/plugin behavior, plugin UI, shared tools, or docs for the plugin changed
   - CLI-only: CLI parser/rendering/config/npm package docs changed without a plugin release
   - combined: shared tool behavior or API surface changed and both packages should be published
2. Inspect current versions in `plugin.json`, root `package.json`, and `cli/package.json`.
3. For plugin releases, update both plugin version fields to the new numeric version without the leading `v`.
4. For CLI releases, update `cli/package.json` → `version` independently.
5. For plugin releases, add a new top entry to `CHANGELOG.md` in the existing style:
   - heading format: `## vX.Y.Z - YYYY-MM-DD`
   - usually 2-3 concise bullets
   - focus on user-visible changes, not raw file diffs
   - mention CLI version bump only for combined releases, e.g. "CLI 包同步提升至 v0.1.5"
6. For plugin releases, update the latest-version callout / timeline content in:
   - `README.md`
   - `README_zh_CN.md`
7. For CLI releases, update CLI docs when user-visible behavior changed:
   - `cli/README.md`
   - `cli/README_zh_CN.md`
   - `docs/development/release-cli.md`
   - `docs/zh/development/release-cli.md`
8. Check that English and Chinese descriptions have the same release meaning, even if not literally translated.
9. Review the diff for consistency.
10. Prepare:
   - a recommended commit message
   - exact plugin `git tag` / `git push` commands if the plugin version changed
   - exact CLI publish command if the CLI version changed

## Version Bump Guidance

If the user asks for a plugin version bump, update:

- `plugin.json` → `version`
- `package.json` → `version`

This repo also includes an interactive helper:

```bash
npm run update-version
```

Prefer direct file edits when the target version is already known. Use the script only when the user wants an interactive plugin bump choice.

### CLI Version Bump

The CLI sub-package lives in `cli/` and is published to npm as `siyuan-sisyphus`. Its version is **independent** of the plugin version.

- Bump `cli/package.json` → `version` manually when CLI code changed.
- The `scripts/update_version.js` helper does **not** touch `cli/package.json`.
- If the CLI did not change in this release, leave its version untouched.
- A CLI-only release does not require a plugin tag, `plugin.json`, root `package.json`, or `CHANGELOG.md` changes unless docs intentionally mention the CLI package version.
- Build output for CLI releases is `cli/dist/cli.cjs`; run or recommend `pnpm build:cli` before publish.

## Changelog Writing Guidance

Follow the current repo tone:

- Chinese, concise, and release-oriented
- 2-3 bullets for a normal patch release
- describe improvements as outcomes, not implementation trivia

Good themes for this repo include:

- 聚合 tool 行为一致性
- 权限 / 路径 / help / 返回结构优化
- CLI 参数映射、配置优先级、输出渲染、npm 发布流程
- 文档、配置说明、测试覆盖同步刷新
- 本地文件、导出、确认流程、安全边界改进

Prefer this structure:

```md
## v0.1.12 - 2026-04-04

- 变更点 1
- 变更点 2
- 变更点 3
```

For combined releases where the CLI version also changed, add a bullet like:

```md
- CLI 包同步提升至 v0.1.5
```

For CLI-only releases, do not add a fake plugin changelog entry just to record the npm package publish. Prefer a CLI docs update or the npm package changelog if one is added later.

## README Timeline Guidance

When updating `README.md` and `README_zh_CN.md`:

- add the new version bullet at the top of the timeline list
- keep the summary shorter than the changelog
- preserve the existing tone of each language
- ensure the version number matches `CHANGELOG.md`

## Diff Review Checklist

Before proposing release commands, verify:

- `plugin.json` and `package.json` versions match
- plugin version did not accidentally overwrite `cli/package.json`
- `cli/package.json` version did not accidentally overwrite plugin versions
- for plugin releases: `CHANGELOG.md` has the new plugin version at the top
- for plugin releases: `README.md` and `README_zh_CN.md` latest-version text includes the new plugin version
- for CLI releases: CLI usage docs are updated if command behavior, config, install, or publish flow changed
- release wording is semantically aligned across all edited English and Chinese docs
- the diff scope matches the intended release
- **if CLI changed**: `cli/package.json` version was bumped and `cli/dist/cli.cjs` was rebuilt (or will be rebuilt during publish)

## Commit Message Guidance

本仓库采用**中文描述 + 简洁语义化**的提交信息风格，正常发布以 `feat：` 开头，后缀 `并发布 vX.Y.Z`（或 `并发布 CLI vX.Y.Z`）。

### 1. 基础格式

```
<type>：<简短描述>并发布 v<version>

[可选 body：多行，说明改动背景、关键决策或破坏性变更]

[可选 footer：关联 issue、 breaking change 说明等]
```

**规则**：
- 总字符数建议不超过 72（标题行），超出时在 body 补充。
- 使用中文全角冒号 `：`（与近期历史保持一致）。
- 描述用**动宾结构**，说明"做了什么"而不是"怎么做的"。

### 2. Type 前缀体系

| 前缀 | 含义 | 使用场景 |
|------|------|----------|
| `feat` | 新功能 / 发布 | **默认发布前缀**。新增能力、重大改进、版本发布 |
| `fix` | 修复 | 紧急补丁、线上 bug 修复后的小版本发布 |
| `docs` | 文档 | 仅文档、注释、README 更新，无代码变更 |
| `refactor` | 重构 | 代码结构调整，无用户可见功能变化 |
| `test` | 测试 | 补充测试用例、测试框架升级 |
| `chore` | 杂项 | 构建脚本、依赖升级、CI 配置等非业务代码 |
| `style` | 代码格式 | 仅格式化、分号、空行调整，无逻辑变化 |

**发布场景优先级**：
- 正常功能发布 → `feat`
- 线上热修复后发布 → `fix`
- 文档站点大修后若需要打标签 → `feat` 或 `docs`（优先匹配近期历史）

### 3. 发布专用模板

#### Plugin 发布

```bash
git add plugin.json package.json CHANGELOG.md README.md README_zh_CN.md
git commit -m "feat：<核心价值>并发布 vX.Y.Z"
```

示例：
```bash
git commit -m "feat：补强资源导出与确认流程并发布 v0.3.5"
git commit -m "feat：优化 MCP tool 行为一致性并发布 v0.3.4"
git commit -m "feat：完善 tool 帮助与路径语义并发布 v0.3.3"
```

#### CLI 独立发布

```bash
git add cli/package.json cli/README.md cli/README_zh_CN.md docs/development/release-cli.md docs/zh/development/release-cli.md
git commit -m "feat：完善 CLI 发布流程并发布 CLI vX.Y.Z"
```

示例：
```bash
git commit -m "feat：优化 CLI 参数映射与输出渲染并发布 CLI v0.1.8"
git commit -m "feat：修复 CLI 配置读取优先级问题并发布 CLI v0.1.7"
```

#### 组合发布（Plugin + CLI 同时更新）

```bash
git add plugin.json package.json cli/package.json CHANGELOG.md README.md README_zh_CN.md cli/README.md cli/README_zh_CN.md
git commit -m "feat：<核心价值>并发布 vX.Y.Z / CLI vA.B.C"
```

示例：
```bash
git commit -m "feat：统一权限校验逻辑并发布 v0.3.6 / CLI v0.1.9"
```

### 4. Body 与 Footer（何时需要）

当变更涉及以下情况时，在标题后留空一行写 body：

- **Breaking Change**：不兼容的 API 调整、配置格式变更、移除旧 action。
- **多模块大范围改动**：超过 3 个工具目录被修改，需要在 body 列出关键变更点。
- **需要解释"为什么"**：重构动机、技术决策背景。

Footer 约定：

```
BREAKING CHANGE: <描述不兼容变更及迁移方式>
Closes #123
Related to #456
```

完整示例：

```bash
git commit -m "feat：重构权限模型并引入 notebook 级隔离并发布 v0.4.0

- 将原来的全局 dangerous 标记改为 notebook 四级权限（rwd/rw/r/none）
- 所有工具入口统一调用 PermissionManager#check
- 旧版权限配置文件自动迁移，无需用户手动干预

BREAKING CHANGE: config.json 中的 dangerousActions 字段已废弃，
请在设置面板重新配置各笔记本权限。"
```

### 5. 非发布提交（日常开发）

日常 push 不需要带版本后缀，保持简洁：

```bash
git commit -m "feat(search): 为 fulltext action 增加 groupBy 支持"
git commit -m "fix(api): 修复 transaction 批量提交时超时未捕获的问题"
git commit -m "docs: 补充 CLI config profile 使用说明"
git commit -m "test(av): 增加 add_rows 边界条件单元测试"
git commit -m "chore: 升级 vitest 到 2.x"
```

**注意**：日常提交可保留英文 scope（如 `(search)`），但标题主体描述仍建议用中文，以与仓库主要提交历史保持一致。

### 6. 避坑清单

- ❌ 不要写 `"update"`、`"fix bug"`、`"一些修改"` 等无意义描述。
- ❌ 不要把提交信息写成变更列表（那是 CHANGELOG.md 的职责）。
- ❌ 不要把 issue 编号放在标题最前面（可放 footer）。
- ❌ CLI 与 plugin 版本不要混用同一个版本号提交信息。

## Release Commands

### Plugin Release

After the commit exists, recommend:

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

If the user asks to publish from a branch other than `main`, adjust the push command to match the actual branch.

### CLI Release

The CLI is published to npm independently. Only run this when `cli/package.json` version was bumped:

```bash
pnpm publish:cli
```

This runs `npm run build:cli && cd cli && npm publish --access public` through the root `publish:cli` script. In this repo, root scripts use `npm run ...`; `pnpm publish:cli` is also acceptable when pnpm is the active package manager.

**Prerequisites**:

- You are logged into npm (`npm whoami` returns your username)
- The `cli/package.json` → `version` is strictly higher than the latest published version on npm

### Combined Release (Plugin + CLI)

When both the plugin and CLI changed in the same cycle:

1. Bump plugin versions (`package.json`, `plugin.json`) and CLI version (`cli/package.json`)
2. Update `CHANGELOG.md`, root bilingual READMEs, and CLI bilingual docs as needed
3. Commit and tag the plugin release
4. Push tag and main branch
5. Publish CLI to npm:

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
pnpm publish:cli
```

## Output Shape

When using this skill, the response should usually contain:

1. A short release summary
2. Which release path was used: plugin-only, CLI-only, or combined
3. The files updated (including `cli/package.json` if CLI changed)
4. A recommended commit message
5. The exact release commands to run next (plugin tag + push, and CLI publish if applicable)

Keep the result compact, repo-specific, and directly executable.
