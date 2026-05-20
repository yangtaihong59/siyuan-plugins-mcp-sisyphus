# 更新日志

本文件记录项目的主要版本变更。

## v0.4.7 - 2026-05-20

- 优化文档时间线 diff 视口联动，历史版本切换与块级定位时滚动体验更稳定
- 延迟注册并规范化文档时间线停靠栏入口，降低冷启动与布局未就绪场景下的入口丢失风险
- 补充赞赏支持入口与相关展示信息，方便用户在 README 与插件元数据中找到支持方式

## v0.4.6 - 2026-05-17

- 修复思源冷启动后文档时间线 dock 按钮未显示的问题，确保布局就绪后自动注册入口
- 修正文档时间线顶部快照计数，改为显示当前文档相关的时间线节点数量
- 优化 diff 顶栏层级，避免块级回退按钮滚动时遮挡历史版本/当前状态栏

## v0.4.3 - 2026-05-16

- 优化 MCP/HTTP 连接稳定性与错误提示，降低远程调用和客户端断连场景下的失败噪声
- 修复 `file.extract_doc` 解析图片资源路径时误包含标题文本的问题，提升文档资源导出准确性
- 改进设置面板主题兼容与 CLI skills 安装引导，CLI 包同步提升至 v0.1.12

## v0.4.2 - 2026-05-15

- 优化文档时间线 diff 展示：支持统一/并排双模式对比、diff 缩略图导航、隐藏未变更块的上下文折叠、新增/删除行统计
- 改进块级差异算法：精确限制代码块 raw DOM 回退场景，补充列表类型支持
- 完善时间线交互细节：智能初始版本选中、国际化文案与测试覆盖

## v0.4.1 - 2026-05-15

- 修复文档时间线回退时代码块 payload 处理异常的问题
- 重构 Skill 体系：将原有 skill 拆分为浏览阅读、创建编辑、数据库、文件导出、搜索查询、系统 CLI、标签闪卡等 7 个独立 skill，降低 Agent 上下文占用
- 补充 block-diff 与工具配置同步的单元测试覆盖

## v0.4.0 - 2026-05-14

- 新增 **文档时间线（Document Timeline）**：基于思源快照为单篇文档提供版本控制，支持创建节点、左右对比差异、块级回退与整篇回退，配套侧边栏与顶部栏入口
- 新增 `file(action="extract_doc")`：将文档和所有引用资源导出到自包含的未压缩文件夹，AI 工具可直接读取附件内容
- 重构工具设置面板：默认折叠为手风琴样式，扁平化设计；权限管理独立为单独面板，提升大工具列表下的浏览效率
- 补充 extract_doc、block-diff、timeline 与工具配置同步的单元测试覆盖

## v0.3.8 - 2026-05-06

- 精简 MCP 响应输出，移除冗余字段降低上下文占用
- 块级精确 replace：支持在指定块范围内精准替换内容
- 优化设置面板统计页面，新增 Debug 面板便于排查问题
- CLI 支持 action 别名与位置参数，`fs` 工具命令更符合直觉
- 修正 av、flashcard、document 等工具的 help 文案与参数校验
- CLI 包同步提升至 v0.1.8

## v0.3.7 - 2026-05-06

- 新增 `fs` 类文件系统文档操作工具：支持通过人类可读路径进行 ls、tree、read、write、replace、rm、mv、search 操作，让 AI 像直接编辑 Markdown 文件一样读写笔记，屏蔽思源块、文档树与 ID 结构的复杂性
- 工具内部目录重构：将共享基础设施统一归拢到 `tools/internal/`，新增 `helpers/` 子目录存放跨工具辅助函数
- 新增国际化（i18n）基础支持：前端设置面板与提示文案支持中英双语切换
- CLI 包同步提升至 v0.1.7

## v0.3.6 - 2026-04-29

- Cherry Studio MCP 配置预设更新为 `streamableHttp` 格式，与 Cherry Studio 最新 MCP 客户端规范对齐
- HTTP Server 设置面板 `Cherry Studio` 预设从文本行表单字段改为标准 `mcpServers` JSON 输出
- 配套更新中英文 README 与部署文档中的 Cherry Studio 配置示例

## v0.3.5 - 2026-04-27

- AV 工具对齐思源"复制为镜像"实现：`duplicate` 通过复制 AV 定义、spun AV block DOM 与 transaction 插入生成镜像数据库块，空 AV 与有行 AV 均可复制
- `av.render(createIfNotExist=true)` 改为同样的安全物化路径，避免前端收到不完整数据库块 DOM 后触发 `innerHTML` 空引用错误
- AV 写操作对齐思源前端 transaction 流程：`add_rows`、`remove_rows`、`add_column`、`remove_column`、`set_cells` 改用 `insertAttrViewBlock` / `removeAttrViewBlock` / `addAttrViewCol` / `removeAttrViewCol` / `updateAttrViewCell`，并补充数据库块 `updated` 更新
- AV 权限与上下文解析增强：空 AV 可从行绑定块、镜像数据库块或 blocks 表中的 AV 块记录自动解析 owning database block；`blockID` 保留为精确上下文与兜底参数
- 移除 AV 上下文解析中的通用 `getDocInfo(avID)` 回退，减少思源内核 `blockinfo.go:61 load tree by root id ... failed` 噪声日志
- Document 工具 `lookup` 智能容错：当 `path` 参数传入人类可读路径而非存储路径时，自动按 `hpath` 解释并返回兼容提示
- HTTP Server 设置面板预设文案规范化，stdio 配置生成包含 `type` 字段
- Flashcard `list_cards` 支持 `reviewedCards` 透传；`create_card` 简化实现，依赖思源 `addRiffCards` 自动处理卡组绑定
- Block / Document 属性写入统一走 `transaction API`，与思源前端行为一致
- 聚合工具变体定义全面改用 Zod 自动生成 JSON Schema，消除手动维护的重复代码
- 新增 action-contract、notebook、system、tag 单元测试；HTTP 面板增加 7 个 MCP 客户端配置预设

## v0.3.4 - 2026-04-26

- AV 工具 `add_rows` 支持通过 `primaryKeyTexts` 直接添加 detached 游离行，无需绑定现有内容块；`batch_set_cells` 修复 cell value 构建方式，确保批量写入正确生效
- Search 工具 `query_sql` 的只读校验全面升级，新增完整 SQL 词法分析器，能正确穿透注释、字符串字面量、WITH RECURSIVE / MATERIALIZED CTE 等复杂语法，彻底阻断 mutation 注入
- Flashcard 工具 `review_card` 的 `reviewedCards` schema 收紧为带 `cardID` 必填字段的结构体，与思源内核读取行为一致
- MCP Server 配置缓存 TTL 从 30s 降至 1s，降低设置面板修改后的生效延迟
- CLI 包版本同步提升至 v0.1.5，文档与单元测试同步刷新

## v0.3.3 - 2026-04-21

- 修复并强化 AV（数据库块）的权限校验与 materialization 流程：写操作支持传入 `blockID` 做精确数据库块归属验证；新建 AV 后增加 mirror registration 轮询确认，避免后续写入因块未注册而失败
- CLI 新增 `config` 命令，支持多 profile 管理（`list`/`get`/`set`/`use`），便于在多思源实例间快速切换
- CLI 支持交互式分页浏览，分页结果可在终端内通过 Enter/n/p/q 直接翻页，脚本场景仍可通过 `--page` / `--page-size` / `--json` 精确控制
- MCP 新增 token 消耗洞察：每次调用记录 request/response 的近似 token，分析面板展示 CLI 与 MCP 的 token 成本对比，帮助用户按场景选择连接方式
- 服务端指令拆分为独立 `server-instructions.ts`，降低 server.ts 复杂度
- 文档站点结构重组，VitePress 导航拆分为 getting-started、reference、architecture、development 四大板块，中英文同步更新
- HTTP Server 设置面板体验优化，配置提示与交互细节改进
- 补充 CLI config、dispatch、render、args 及 AV、token-usage、analytics 等模块的单元测试覆盖

## v0.3.2 - 2026-04-20

- 修复设置面板加载时因跨 chunk 模块解析失败导致的配置初始化异常
- 将 tool-config 与 telemetry-config 内联至 setting 目录，避免 re-export 依赖在插件环境中的加载问题
- 同步调整配置一致性测试，确保 setting 与 mcp 两侧行为对齐

## v0.3.1 - 2026-04-20

- CLI 调用链路接入完整 tool lifecycle，analytics 与 telemetry 事件同步持久化，猫猫挣米与调用统计在终端场景下即时生效
- 分析面板「传输方式」升级为「调用来源」，新增 CLI 分类并与 stdio / http 并列展示，国际化文案同步刷新
- 移除 cli 包对 siyuan-sisyphus 的循环依赖，避免本地安装时的版本冲突
- 配套更新文档结构、帮助资源与单元测试覆盖

## v0.3.0 - 2026-04-18

- CLI 工具 `siyuan-sisyphus` 预览版上线，发布至 npm，支持通过命令行直接调用全部 10 个聚合工具的 115+ action
- 支持 `init` 交互式配置、`list` / `help` 命令查询工具与 action，以及全局 `--json` / `--debug` / `--config` / `--url` / `--token` 等 flag
- 支持 kebab / camel / snake 混用 flag 命名、`--<key>-json` 侧车参数传入复杂对象与数组，以及通过 `jq` 管道处理 JSON 输出
- 双语文档同步更新，在 README 开篇新增 CLI 简介与快速示例，插件介绍文案同步扩展为「插件 + CLI」双重定位

## v0.2.11 - 2026-04-18

- 修复并补全 AV（数据库块）创建能力：`av(action="render_attribute_view")` 新增 `createIfNotExist=true` 参数，支持在指定文档中创建新的数据库块，解决此前无法通过 MCP 新建数据库的问题
- 配套更新权限校验逻辑、错误翻译规则、帮助文案、API 文档与单元测试覆盖

## v0.2.10 - 2026-04-16

- 引入 `defineTool` 工厂统一所有聚合 tool 的定义模式，拆分设置面板为 HttpServer / Puppy / Telemetry / ToolCategories / UserRules 五大子面板，并新增遥测与分析模块，支持调用统计、错误率与耗时分布洞察
- 补全 `flashcard` 工具的 `create_card` action，支持将已有块完整转为闪卡（自动写 `custom-riff-decks` 并完成 riff 注册），action 总数扩展至 115
- 同步更新双语文档、帮助资源、国际化文案与测试覆盖

## v0.2.9 - 2026-04-14

- 合并成对 action 为单一动作：notebook 的 `open`/`close` 合并为 `set_open_state`、document 的 `set_cover`/`clear_cover` 合并为 `set_cover`、block 的 `fold`/`unfold` 合并为 `set_fold_state`、file 的 `get_doc_assets`/`get_doc_image_assets` 合并为 `get_doc_assets`，通过布尔或枚举参数控制行为，减少工具数量并提升调用一致性
- 优化 AV 搜索返回结构，补充 searchScope 与空结果 warning 提示，改善 AI 对搜索范围的感知
- 同步更新 API 映射文档、双语文档与单元测试覆盖

## v0.2.8 - 2026-04-14

- 增强 search 聚合工具：支持类型短码自动展开、sortBy 别名、parentId 与 hasTags 过滤，并优化搜索结果瘦身（字段裁剪、内容截断、excerpt 提取），显著降低 AI 消费时的 token 占用
- 修复闪卡（flashcard）工具在 add_card / remove_card 时的状态校验与重试逻辑，解决文档块误加入卡组和 get_cards 返回未解析内容的问题
- 补充 search 与 flashcard 的单元测试覆盖，提升相关模块稳定性

## v0.2.7 - 2026-04-13

- 新增完整的 API 接口映射文档（API_COMPLETE_MAPPING.md），提供全量 90+ 个 action 的详细说明
- 补强 block、document、file、search、av 等聚合 tool 的 action 支持，提升工具覆盖度
- 引入 normalize 模块统一参数处理逻辑，增强请求健壮性
- 重构文档目录结构，迁移至 VitePress 站点（docs/），改善文档浏览体验
- 补充单元测试和冒烟测试覆盖，新增 normalize、av、block、file 等测试套件

## v0.2.6 - 2026-04-12

- 调整 MCP 工具配置加载策略，统一以思源 API 中的 `/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig` 作为唯一优先真相源；无论是插件模式还是 standalone 模式，都会先尝试通过 `SIYUAN_API_URL` / `SIYUAN_TOKEN` 读取同一份配置
- 移除 standalone 模式下默认从本地文件系统探测 `mcpToolsConfig` 的行为，不再依赖 `SIYUAN_DATA_DIR`、`~/SiYuan/...`、`~/.siyuan/...` 或 Windows `APPDATA` 等本机路径猜测，避免本地 MCP 进程误读另一份工作区配置
- 取消 `SIYUAN_MCP_TOOLS` 在服务端工具配置加载链路中的隐式覆盖作用；当 API 配置缺失、为空或内容无效时，直接回退到内置默认工具配置，减少多来源配置叠加带来的歧义
- 修正 standalone / Docker / 远端部署场景下的配置一致性问题：当 `mcp-server.cjs` 运行在独立 Node 进程或容器中，并通过网络连接远端 SiYuan 时，`listTools`、服务端 instructions 与实际工具调用将基于同一份远端插件配置，不再出现“API 指向远端、配置却来自本地磁盘”的错配
- 保留 `isPluginMode()` 对 UI 刷新等插件上下文相关能力的区分，仅将“工具配置读取”从运行模式判断中解耦；standalone 仍可正常使用 API 驱动的 MCP 能力，而插件专属的界面刷新逻辑继续只在插件模式下执行
- 补充并更新集成测试，覆盖以下关键场景：standalone 模式依然通过 API 读取工具配置、API 返回无效 JSON 时回退默认配置、`SIYUAN_MCP_TOOLS` 不再影响工具列表，以及 HTTP 并发访问下配置读取行为保持稳定

## v0.2.5 - 2026-04-11

- 新增独立模式（standalone mode）支持，优化 schema 定义与兼容性

## v0.2.4 - 2026-04-10

- 移除插件内置的数据仓库快照管理侧边栏与相关 repo API 封装；该能力与思源官方快照工具重复，后续请使用「主菜单 → 数据历史 → 数据快照」

## v0.2.3 - 2026-04-10

- 扩展插件运行平台支持，新增 docker 后端与 browser-desktop、desktop-window 前端
- 提升插件在多环境下的兼容性

## v0.2.2 - 2026-04-10

- 为数据仓库快照管理新增独立侧边栏 UI，支持可视化创建快照、查看历史、对比差异与一键回滚
- 优化快照标签置顶与列表刷新交互，提升数据管理操作便捷性

## v0.2.1 - 2026-04-09

- 新增**数据仓库快照管理**功能，提供完整的快照列表、创建、对比、回滚能力，支持标签置顶标记与侧边栏 UI 操作
- 补强 HTTP 传输层并发安全性，修复多客户端同时连接时的竞态问题
- 补充 HTTP 并发场景集成测试，提升传输层稳定性

## v0.2.0 - 2026-04-09

- 新增 **HTTP Streamable 远程传输模式**，`mcp-server.cjs` 支持通过 `--http` 或 `SIYUAN_MCP_TRANSPORT=http` 启动 HTTP 服务，多个 MCP 客户端可同时连接同一台思源（Stateful 会话，每会话独立 Server 实例），解决 WSL/远程 agent 难以走 stdio 的痛点
- 在插件设置面板新增「🌐 HTTP Server」分区，支持一键启停、随思源自动启动、Bearer Token 鉴权、客户端配置片段（直连 HTTP 与 mcp-remote 桥接两种）一键复制
- 内置安全防护：默认绑定 `127.0.0.1`，绑定到非回环地址且未开启鉴权时显示警告；token 自动随机生成，可一键重置
- 配套环境变量：`SIYUAN_MCP_TRANSPORT`、`SIYUAN_MCP_HOST`、`SIYUAN_MCP_PORT`（默认 36806）、`SIYUAN_MCP_TOKEN`、`SIYUAN_MCP_PATH`（默认 `/mcp`）

## v0.1.17 - 2026-04-09

- 新增 `flashcard` 聚合 tool，支持闪卡复习、卡组管理、卡片增删等 7 个 action，完善思源记忆卡片能力
- 重构双语文档，新增快速入门指南与 MCP 概念说明，降低新用户上手门槛
- 同步更新预览图、国际化文案与测试覆盖，工具总数扩展至 10 个聚合 tool

## v0.1.16 - 2026-04-07

- 新增 UI 自动刷新机制，在文档、块、笔记本等变更操作后自动触发界面同步，减少手动刷新
- 优化数据库块（AV）的行/单元格操作语义，改进写入链路的 ID 处理与返回值提示
- 同步补充调试脚本与回归测试，提升问题定位效率

## v0.1.15 - 2026-04-07

- 修正 `av` 行/单元格 ID 语义，明确区分源块 ID、行 item ID 与 value ID，并让 `add_rows`、`set_cell`、`batch_set_cells` 在写链路里返回或提示可写 `rowID`
- 补齐 `av` 对 `mAsset`、`lineNumber` 等字段类型的支持，优化数据库块复制后的插入与可读性校验，减少真实数据库操作时的歧义
- 同步补充 `mascot` 挣米规则、回归测试手册与双语文档说明，刷新 AV / mascot 相关测试覆盖

## v0.1.14 - 2026-04-05

- 新增 `siyuan://help/ai-layout-guide` 帮助资源，并在 tool overview 与服务端系统提示中补充 SiYuan 布局决策规则，帮助 AI 更稳定地区分标题、callout、超级块、可渲染代码块、嵌入与数据库块
- 强化标签、书签、闪卡等语义说明，明确分层标签写法、书签应走块属性，以及布局选择与复习标记是两类不同能力，减少内容生成时的误判
- 同步刷新技能说明与冒烟测试，校验默认 8 个聚合 tool、AI 布局帮助资源和关键提示文案，降低后续回归成本

## v0.1.13 - 2026-04-04

- 移除对 `getApiToken` 的错误依赖，统一兼容“有 token 则带鉴权、无 token 则按无鉴权模式访问”的思源 API 请求方式
- 修复 `SIYUAN_API_URL` 末尾带 `/` 时拼接出 `//api/...` 路径的问题，解决部分请求返回空响应并触发 JSON 解析报错的情况
- 同步精简服务端启动逻辑、删除未使用的 token helper，并补齐集成测试与双语文档说明，明确“开启 API 鉴权时必须配置 token”

## v0.1.12 - 2026-04-04

- 新增 `mascot` 聚合 tool，并加入余额查询、商店浏览与购买能力，让 MCP 交互多了一层轻量陪伴反馈
- 修复思源 API 地址与鉴权读取流程，优先支持 `SIYUAN_API_URL` / `SIYUAN_TOKEN` 环境变量，改善 Docker 等部署场景下的可用性
- 同步更新双语文档、技能说明、设置项文案与回归测试，补齐第 8 个聚合 tool 的说明与发布信息

## v0.1.11 - 2026-04-03

- 新增 `document` 的 `set_cover` / `clear_cover` 语义化能力，支持更顺手地设置与清空文档头图
- 将 `file(action="upload_asset")` 调整为本地文件路径上传，并补充大文件阈值确认流程，提升本地文件读写安全性
- 同步完善工具说明、设置页文案、接口映射与回归测试，减少 MCP 客户端接入歧义

## v0.1.10 - 2026-04-03

- 优化聚合 tool 的行为一致性，补齐参数语义、返回结构与边界场景处理
- 强化权限校验、路径规范化与帮助信息展示，提升 MCP 集成稳定性
- 同步更新双语文档、接口说明与测试用例，降低接入和回归成本

## v0.1.9 - 2026-04-03

- 升级笔记本 MCP 权限模型为 `none` / `r` / `rw` / `rwd`，并同步更新配置界面、帮助文档与多语言文案
- 强化 `document` / `block` / `file` 相关行为，包括更明确的 move 语义、结构化返回结果与资源导出路径规范化
- 补充 MCP 服务端说明、资源描述、接口映射与集成/单元/联调测试覆盖

## v0.1.8 - 2026-04-02

- 新增笔记本与文档 emoji 图标设置能力
- 对外 MCP 工具面恢复为 7 个聚合 tool（`notebook`、`document`、`block`、`file`、`search`、`tag`、`system`）

## v0.1.7 - 2026-04-02

- 新增笔记本与文档 emoji 图标设置能力
- 补充 `search` 聚合 tool，支持全文搜索、SQL 查询、标签搜索、反向链接与反向提及

## v0.1.5 - 2026-04-02

- 对外 MCP 工具面收敛为 4 个聚合 tool（`notebook`、`document`、`block`、`file`）
- 新增笔记本级权限守卫
- 对高危 action 增加执行前明确确认约束
- 新增按笔记本/文档查询直属子树的 action

## v0.1.4 - 2026-02-26

- 首次安装时自动生成 MCP 配置文件

## v0.1.3 - 2026-02-22

- 删除无关 dock/debug/menu 配置项，减少干扰

## v0.1.2 - 2026-02-21

- 合并 MCP 工具配置入口
- 增加配置读取双路径回退机制

## v0.1.1 - 2026-02-21

- MCP 配置路径调整为 `siyuan-plugins-mcp-sisyphus`
- 文档补充报错说明

## v0.1.0 - 2026-02-20

- 更新插件图标与预览图资源
