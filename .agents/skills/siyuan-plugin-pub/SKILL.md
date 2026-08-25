---
name: siyuan-plugin-pub
description: Publish the SiYuan Sisyphus plugin, standalone CLI, or both. Use for version bumps, release notes, merged-PR contributor attribution, docs, commit messages, tags, and npm publish prep.
---

# SiYuan Plugin Pub

Use this skill when the user wants to publish a new version of this SiYuan Sisyphus repo. The repo ships two related but independently versioned products:

- **SiYuan plugin / MCP server**: marketplace plugin metadata and bundled `dist/mcp-server.cjs`
- **Standalone CLI**: npm package `siyuan-sisyphus`, with `siyuan-sisyphus` and `siyuan` binaries

## Release Type Gate

Before editing release files, classify the request as exactly one path.

Use the user's explicit wording first. If they do not specify a release type, infer from mentioned features and changed files:

- **plugin-only**: plugin UI, MCP server, non-CLI docs, marketplace metadata, or plugin-only fixes changed.
- **CLI-only**: `src/cli/`, `cli/`, CLI install/config/rendering behavior, npm package docs, or CLI publish docs changed.
- **combined**: shared tool/API behavior changed in `src/api/`, `src/core/`, `src/tools/`, or the user wants both the plugin and npm CLI published.

If a required version number is missing, stop and ask for it.

If the release type is still unclear after checking the request and `git status --short`, state the inferred path and ask for confirmation before changing versions.

This repo already keeps release metadata, fallback versions, and release notes in:

- `plugin.json`
- `package.json`
- `src/core/feedback.ts`
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
- Keep the feedback tool fallback version in `src/core/feedback.ts` (`FEEDBACK_PLUGIN_VERSION`) on the same plugin version. It is used when the compiled `__PLUGIN_VERSION__` define is unavailable.
- Keep CLI version in `cli/package.json` independent from the plugin version, such as `0.1.5`. Do not force it to match the plugin version.
- `CHANGELOG.md` is the source of truth for plugin release notes and uses Chinese entries with newest plugin version on top.
- When a release contains merged PRs, identify each PR author from PR metadata and explicitly thank them in both `CHANGELOG.md` and the settings changelog (`public/i18n/zh_CN.json` and `public/i18n/en_US.json`). Never write only the PR number or a generic “thanks for the contribution.”
- Use the contributor's GitHub login, not the merge committer or an inferred display name. Prefer GitHub PR metadata; use the merge commit author only as a fallback when PR metadata is unavailable, and state that the attribution was inferred before publishing.
- `README.md` and `README_zh_CN.md` both maintain the latest plugin version callout near the top; update both for plugin releases.
- `cli/README.md` and `cli/README_zh_CN.md` describe standalone CLI usage; update them when CLI behavior, install flow, or command syntax changes.
- `docs/development/release-cli.md` and `docs/zh/development/release-cli.md` are the CLI publish docs; keep them aligned when release procedure changes.
- Prefer matching the repo's recent commit style, for example:
  - `feat：新增文档头图与本地上传确认流程，整理代码并发布 v0.1.11`
  - `feat：优化 MCP tool 行为一致性并发布 v0.1.10`
- Do not run `git tag` or `git push` until the user explicitly wants to execute publish commands.

## Recommended Workflow

1. Run `git status --short` and inspect current versions in `plugin.json`, root `package.json`, `src/core/feedback.ts`, and `cli/package.json`.
2. Apply the checklist for the chosen release path below.
3. If the release includes merged PRs, inspect the PR metadata before writing release notes. Record the PR number, contributor GitHub login, PR URL, and contributed outcome for each PR.
4. Add contributor thanks to `CHANGELOG.md` and both settings changelog strings in `public/i18n/zh_CN.json` and `public/i18n/en_US.json`. If a README latest-version callout mentions those PRs, include the contributor attribution there too.
5. Check that English and Chinese descriptions have the same release meaning and contributor attribution, even if not literally translated.
6. Review the diff for version consistency and scope.
7. If releasing from the `dev` branch, merge into `main` with `--no-ff` to preserve the feature branch history and create an explicit merge commit:
    ```bash
    git checkout main
    git merge --no-ff dev -m "feat：合并 dev 分支并发布 vX.Y.Z"
    ```
    - Do **not** use a fast-forward merge; the explicit merge commit makes the release boundary clear in the history graph.
8. Prepare a recommended commit message and the exact next commands. Do not run `git tag`, `git push`, or `pnpm publish:cli` unless the user explicitly asks.

### Plugin-Only Checklist

- Update `plugin.json`, root `package.json`, and `src/core/feedback.ts` (`FEEDBACK_PLUGIN_VERSION`) to the same numeric version without leading `v`.
- Add a top `CHANGELOG.md` entry: `## vX.Y.Z - YYYY-MM-DD`, with 2-3 concise Chinese bullets.
- If merged PRs are included, add one explicit contributor-thanks bullet per PR and synchronize the same attribution into `public/i18n/zh_CN.json` and `public/i18n/en_US.json`.
- Update latest-version callouts / timeline content in `README.md` and `README_zh_CN.md`.
- Leave `cli/package.json` unchanged.
- Prepare plugin tag/push commands only.

### CLI-Only Checklist

- Update `cli/package.json` to the new CLI version.
- Update CLI docs only when user-visible CLI behavior, install flow, command syntax, config, or publish procedure changed:
  - `cli/README.md`
  - `cli/README_zh_CN.md`
  - `docs/development/release-cli.md`
  - `docs/zh/development/release-cli.md`
- Do not edit `plugin.json`, root `package.json`, or `CHANGELOG.md` unless the user explicitly asks.
- Prepare `pnpm publish:cli` only.

### Combined Checklist

- Update plugin versions in `plugin.json`, root `package.json`, and `src/core/feedback.ts`.
- Update CLI version in `cli/package.json`.
- Add a plugin `CHANGELOG.md` entry and mention the CLI bump, e.g. `CLI 包同步提升至 v0.1.5`.
- If merged PRs are included, add one explicit contributor-thanks bullet per PR and synchronize the same attribution into `public/i18n/zh_CN.json` and `public/i18n/en_US.json`.
- Update root bilingual READMEs for plugin release notes.
- Update CLI docs if CLI behavior or publish procedure changed.
- Prepare both plugin tag/push commands and `pnpm publish:cli`.

### Stop Conditions

Stop and ask before editing or publishing if:

- the target plugin or CLI version is missing
- the release path remains ambiguous after checking the request and changed files
- required version files disagree, such as `plugin.json`, root `package.json`, and `src/core/feedback.ts` having different plugin versions
- a required release note/doc update is absent for the chosen path
- merged PRs are part of the release but the contributor login cannot be verified, or either the repository changelog or settings changelog lacks the contributor thanks
- the diff includes unrelated changes that make the release scope unclear

## Version Notes

- Plugin versions live in `plugin.json`, root `package.json`, and `src/core/feedback.ts` (`FEEDBACK_PLUGIN_VERSION` fallback); keep them identical.
- CLI version lives only in `cli/package.json`; never force it to match the plugin version.
- `scripts/update_version.js` updates plugin package metadata only. After using it, still update or verify `src/core/feedback.ts`.
- For CLI releases, run or recommend `pnpm build:cli` before publish because the npm artifact is `cli/dist/cli.cjs`.

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

For every merged PR included in the release, add a separate attribution bullet using this form:

```md
- **感谢 [@contributor](https://github.com/contributor) 提交 [PR #123](https://github.com/OWNER/REPO/pull/123)**，贡献 <用户可感知的结果>
```

In the settings changelog, keep the same contributor and PR mapping in plain Markdown-safe text:

```text
**感谢 @contributor 提交 PR #123。**
**Thanks to @contributor for PR #123.**
```

Do not collapse multiple contributors into “感谢 PR #123、#124 的贡献”. Do not credit the repository maintainer merely because they merged the PR.

For CLI-only releases, do not add a fake plugin changelog entry just to record the npm package publish. Prefer a CLI docs update or the npm package changelog if one is added later.

## README Timeline Guidance

When updating `README.md` and `README_zh_CN.md`:

- add the new version bullet at the top of the timeline list
- keep the summary shorter than the changelog
- preserve the existing tone of each language
- ensure the version number matches `CHANGELOG.md`

## Final Review

Before proposing release commands, verify:

- plugin versions match in `plugin.json`, root `package.json`, and `src/core/feedback.ts` when the plugin is released
- CLI version changed only when the CLI is released
- required changelog, README, and CLI docs match the chosen release path
- every merged PR is mapped to its verified GitHub contributor in `CHANGELOG.md`, `public/i18n/zh_CN.json`, and `public/i18n/en_US.json`
- contributor names and PR numbers match between Chinese and English settings changelogs
- release wording is semantically aligned across all edited English and Chinese docs
- the diff scope matches the intended release
- if CLI changed: `cli/package.json` version was bumped and `cli/dist/cli.cjs` was rebuilt or will be rebuilt during publish

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

### 2. 发布专用模板

#### Plugin 发布

```bash
git add plugin.json package.json src/core/feedback.ts CHANGELOG.md README.md README_zh_CN.md
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
git add plugin.json package.json src/core/feedback.ts cli/package.json CHANGELOG.md README.md README_zh_CN.md cli/README.md cli/README_zh_CN.md
git commit -m "feat：<核心价值>并发布 vX.Y.Z / CLI vA.B.C"
```

示例：
```bash
git commit -m "feat：统一权限校验逻辑并发布 v0.3.6 / CLI v0.1.9"
```

### 3. Body 与 Footer（何时需要）

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

### 4. 非发布提交（日常开发）

日常 push 不需要带版本后缀，保持简洁：

```bash
git commit -m "feat(search): 为 fulltext action 增加 groupBy 支持"
git commit -m "fix(api): 修复 transaction 批量提交时超时未捕获的问题"
git commit -m "docs: 补充 CLI config profile 使用说明"
git commit -m "test(av): 增加 add_rows 边界条件单元测试"
git commit -m "chore: 升级 vitest 到 2.x"
```

**注意**：日常提交可保留英文 scope（如 `(search)`），但标题主体描述仍建议用中文，以与仓库主要提交历史保持一致。

### 5. 避坑清单

- ❌ 不要写 `"update"`、`"fix bug"`、`"一些修改"` 等无意义描述。
- ❌ 不要把提交信息写成变更列表（那是 CHANGELOG.md 的职责）。
- ❌ 不要把 issue 编号放在标题最前面（可放 footer）。
- ❌ CLI 与 plugin 版本不要混用同一个版本号提交信息。

## Release Commands

### Plugin Release

When releasing from `dev`, always merge with `--no-ff` before tagging:

```bash
git checkout main
git merge --no-ff dev -m "feat：合并 dev 分支并发布 vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

If the release commit already exists directly on `main`, tag and push only:

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

1. Bump plugin versions (`package.json`, `plugin.json`, `src/core/feedback.ts`) and CLI version (`cli/package.json`)
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
