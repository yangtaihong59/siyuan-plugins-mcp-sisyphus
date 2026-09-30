# 内核端点：功能、差异与验证

内核端点让 Docker／远程思源通过现有 HTTP 服务提供 Sisyphus MCP 能力。实现全部位于插件，不修改思源核心。本文集中说明功能、运行边界及验证范围；参数配置见[内核高级选项](../zh/reference/kernel-options.md)，协议及写入契约见[严格安全写入](../zh/reference/write-safety.md)。

## 部署与接入

在插件设置中启用“内核端点”（`kernelEndpointEnabled`），连接 `/plugin/private/siyuan-plugins-mcp-sisyphus/mcp`。端点使用思源 private 路由认证，并复用思源 HTTP 服务；部署环境需支持内核插件。独立 Node HTTP、stdio 和 CLI 入口继续可用。

启用内核端点后，严格预检与提交统一进入内核协调器。CLI／Node 自动处理附件暂存、选定导出的下载和任务结果查询；普通读取可由 Node 自行执行。内核协调器不可用时不会自动换到另一个 owner 重做写入。

## 与原实现的差异

**对比基线是原实现：由思源桌面插件启动 Node 子进程、监听本地 MCP 端口。原插件服务依赖桌面端的 Node／child_process 和工作空间路径，不支持直接在 Docker／远程思源部署中启动。** 本实现将 MCP 端点托管到思源内核，补齐这一部署能力，并增加 Node／CLI 到内核的协调与文件桥接。下表左侧仅列原实现，右侧包含本实现新增的适配及桥接。

原 Node／CLI 可配置远端思源 API 地址，但这不等于原插件能在 Docker／远程思源宿主中直接提供 MCP 端点。本表比较插件部署与功能迁移，不把“访问远端 API”写成“原插件已支持远程部署”。

**内核端点仍有功能限制，尚未达到原实现的完整能力范围。** 静态清单中的 143 个 action 均有实现，其中上传附件、创建／更新模板、ZIP 导出、文档提取这 5 个 action 存在内核专属的部分限制；其他 action 仍受通用预算、宿主和客户端条件约束。“有实现”不表示逐项真实验收通过。

表中 **√ = 内核端点相对原实现缺失或部分受限；X = 未发现额外功能缺失**。新增能力、行为差异和双方共同不足另行注明。**本实现新增的桥接属于右侧能力**；通过 Node／CLI 委托内核的调用也受内核限制，不能靠切换 owner 重试规避。

| 功能／使用场景 | 原实现（桌面端 Node 本地服务） | 本实现（内核端点及新增桥接） | 相对原实现是否缺失 | 日常使用影响与限制 |
|---|---|---|---|---|
| Docker／远程思源部署 | 插件启动 MCP 服务依赖桌面端 Node 环境，不能在无该环境的 Docker／远程宿主中直接启动 | 内核托管 MCP，复用思源 HTTP 服务和 private 路由认证，无需桌面插件启动 Node 子进程 | X（新增部署能力） | Docker／远程思源可直接提供 MCP 端点；仍需宿主支持内核插件及正确配置认证／网络入口 |
| 上传大附件 | 大文件确认后可上传，无固定 10 MiB 硬上限，仍受思源／网络限制 | 单文件硬上限 **10 MiB**；新增 CLI／Node 暂存桥接不提高上限 | √ | 大于 10 MiB 的 PDF、视频、压缩包无法经内核上传；10 MiB 边界及超限拒绝已实测 |
| 使用电脑本地文件路径 | 上传／导出读写运行 Node 服务的电脑文件 | 内核无法读取调用者电脑路径；本实现新增 CLI／Node 自动暂存和下载 | √（需桥接） | 直连客户端需自行实现暂存／保存，不能仅传 localFilePath／outputPath；fs 仍指思源虚拟笔记路径 |
| ZIP 导出、文档与附件提取 | ZIP 缓冲后保存，可覆盖；文档提取清空输出根目录，跳过读取失败附件 | 直连返回清单／Markdown／小 ZIP Base64；新增桥接流式保存并校验 SHA，**总量 512 MiB、单文件 120 秒**，拒绝已有目标，失败清理本次输出 | √（交付方式与规模受限） | 直连客户端自行保存；桥接须用新目标并处理附件失败；原路径提取仍需专用目录 |
| 创建／更新超大模板 | 无对应固定正文上限 | 默认正文 **16 MiB**，可配 **1–32 MiB**，multipart 另预留 64 KiB | √ | 超限拒绝；大文本 JS 哈希较慢，需容纳等待时间；32 MiB 未做实际最大负载测试 |
| 大范围搜索、SQL、多文档批读 | 使用原 action 的分页／大小限制 | 普通只读调用默认累计 **128 次 API／8 MiB／30 秒**，可配置；超限返回不完整状态及恢复指引 | √ | 需缩小查询或拆分 ids；不能假设一次获得全部结果；docs_info 使用原 id／ids 参数 |
| 慢请求取消与硬超时 | 可中止客户端传输，但不保证所有 handler 或思源计算立即停止；原响应体超时有间歇问题 | 宿主原生 I/O 无逐请求强制中断接口；协作取消需等当前 I/O 返回再释放槽位 | √ | 慢 SQL 超时仍可能占位；现代 HTTP 断线不等于取消；两端都不能把断线视为写入回滚 |
| 大响应流式读取／内存控制 | 指定大小的 requestRead 可逐块检查；原 ZIP 导出仍先缓冲再保存 | 宿主 Go fetch 先缓冲再检查预算；本实现的调用方下载桥接可流式落盘 | √（宿主读取仍受限） | 桥接流式保存不能消除宿主预缓冲；8 MiB 预算不是宿主内存硬上限 |
| 仅支持 stdio 的客户端 | 通过原 Node stdio 入口连接 | 内核端点只提供 HTTP；保留 Node stdio 入口并增加内核委托适配 | √（内核需桥接） | 内核 URL 不能直接当作 stdio 命令；支持仅 stdio 的客户端仍需 Node |
| 独立监听端口／TLS | Node 服务可配置监听地址、端口、证书 | 内核复用思源 HTTP 服务，不单独监听 TLS | √ | 需要独立入口时仍用 Node 或反向代理 |
| 指向另一思源实例 | Node／CLI 可配置 SIYUAN_API_URL；插件服务自身仍依赖桌面端启动条件 | 内核端点绑定承载插件的思源实例 | √ | 多实例分别连接各自内核端点；原来的远端 API 配置能力不等于原插件支持远程部署 |
| 常规笔记操作、权限、帮助、图片读取 | 已有 handler／权限模型；图片单图 20 MiB | 复用原实现并适配内核运行；图片有独立 20 MiB 额度，普通读取受上述预算约束 | X | 未发现整类笔记能力缺失；不表示所有 action／数据规模逐项实测 |
| 并发、确认与长连接 | 无内核相同的 4／1／128 排队限制；legacy 主要依赖 instructions／help 明示确认 | 内核读取并发 4、其他通道串行、在途 128；legacy 高危调用需 confirm=true；SSE 有数量及时长限制 | X（行为不同） | 批量调用会排队或 queue_full；旧客户端需适配确认标记及重连，现代高危操作仍需表单确认 |
| MCP Apps／扩展、反馈／遥测 | 依赖客户端和下游服务；外部请求使用 Node fetch | 本实现适配协商、资源、扩展调用；反馈／遥测使用宿主 forwardProxy | X（未完整验收） | 已验证资源协商和受控遥测失败；所有 App 按钮、真实客户端及生产服务仍未完整实测 |
| 重启续跑、分片续传、数据库级原子 CAS | 无完整通用实现 | 同样无完整通用实现；内存租约以及新增的暂存、任务缓存不能跨重载保留 | X（双方共同不足） | 不承诺自动续传或重启继续；未知写入结果用原 requestId 核对，不随意重做 |

## 实现与审查入口

| 功能 | 实现方式 | 主要源码 |
|---|---|---|
| 内核托管与构建 | `kernel.js`、插件声明、Goja 运行时适配；schema 在构建阶段生成 | `vite.config.ts`、`plugin.json`、`src/kernel/{index,client,polyfill,node-shims,schema-manifest}.ts` |
| 工具与协议 | 复用注册表、handler、权限、参数校验、help／resources／prompts；支持现代无会话 MCP 与 legacy 会话 | `src/kernel/{index,modern-protocol,resources}.ts`、`src/tools/internal/define-tool.ts` |
| 唯一写入协调器 | CLI／stdio／Node HTTP 的严格写入委托同一 owner，共享预检租约、幂等账本与提交边界 | `src/core/write-coordinator-settings.ts`、`src/core/write-safety-coordinator.ts`、`src/cli/write-coordinator.ts` |
| 并发、取消与恢复 | 读取并发 4、修改／external／extension／App 串行，在途上限 128；协作取消、短期终态缓存与只读结果查询 | `src/kernel/{scheduler,task-client,task-results}.ts` |
| 读取预算与通知 | 调用次数、解码字节及协作期限预算；明确只读重试；legacy SSE 工具清单失效通知 | `src/kernel/{client,read-budget,events}.ts`、`src/core/kernel-options.ts` |
| 文件桥接 | 10 MiB 暂存上传；导出清单、客户端流式保存、SHA-256 校验和失败清理；模板 multipart 适配 | `src/core/{upload-source,export-download}.ts`、`src/cli/kernel-file-transfer.ts`、`src/tools/file/handlers.ts`、`src/api/template.ts` |
| Skills、Apps 与官方扩展 | 共享 Skills 开关／资源、App HTML／能力协商；通过官方 MCP 会话发现和转发 extension | `src/kernel/{resources,official-mcp}.ts`、`src/core/official-mcp-tools.ts` |
| 统计、网络及诊断 | 同运行时存储组串行更新；反馈与可选遥测走宿主代理；health 提供脱敏状态 | `src/core/{storage-queue,external-fetch,analytics,telemetry}.ts`、`src/kernel/index.ts` |

## 使用与恢复边界

- **确认与权限**：笔记本权限和工具开关沿用共享实现。现代高危调用使用绑定操作参数的表单确认，`confirm=true` 不能绕过；legacy 调用需先取得确认再携带标记。Origin 白名单不替代思源认证或代理 CORS。
- **写入一致性**：账本与租约约束通过 Sisyphus 的调用，不是数据库级 CAS，也不能阻止思源 UI、其他插件或直接 API 并发修改。SQL／全文索引可能延迟，应读回目标并核对原 `requestId`。
- **响应丢失**：CLI／Node 只查询原 `taskId` 的短期缓存结果，不重发业务调用；无法恢复时返回 `outcome_unknown`。终态缓存 10 分钟、128 项、总 8 MiB、单结果 1 MiB；过期或重载后不能据 `found=false` 判定业务结果。
- **取消与提交**：协作取消阻止后续步骤，不能中断宿主已发出的原生 I/O。提交边界之后继续完成写入、读回与账本记录；关闭 HTTP 连接不等于回滚。
- **读取与文件**：普通只读预算默认 128 次 API／8 MiB／30 秒，可配置；图片另有 20 MiB 额度。宿主预缓冲不受 JS 预算形成的内存硬限制。内核上传硬上限 10 MiB；模板默认 16 MiB、可配 1–32 MiB；导出桥接总量 512 MiB、单文件 120 秒。
- **外部副作用**：导出、第三方工具、反馈等属于 external，`validateOnly` 不执行，真实调用不承诺严格写入保证，也不自动重发外部提交。遥测默认关闭。
- **切换与回退**：先停止新写入、排空任务并核对未知结果，再关闭内核入口或切换版本、重启相关运行时、重新预检。租约、暂存、会话及任务缓存不能跨重载沿用；存储队列不提供跨进程锁。

## 验证结果

验收日期：2026-09-29。真实环境为隔离 Docker、思源 3.8.5；使用已构建的 kernel／server／CLI 产物。以下只记录与所列产物对应的验收，未逐项覆盖的功能不计为容器通过。

| 检查 | 结果与范围 |
|---|---|
| 全量自动化 | 117 个测试文件、1,375 项；**1,374 通过、1 项间歇失败**，见下文 |
| 构建与检查 | `pnpm build`、`pnpm build:cli`、`pnpm docs:build`、`pnpm api:audit:check`、`pnpm skills:check`、`git diff --check` 通过 |
| Goja 冒烟 | 初始化、工具发现、帮助、别名读取和无效预检通过；使用宿主替身，不计为容器实测 |
| CJS 入口 | direct／stdio／CLI 读取真实容器版本 3.8.5 通过 |
| 容器专项 | 11 组通过：产物 SHA、持久配置上下界、读取字节预算、docs_info IDs 拆批、模板边界、上传超限、App 协商及 3 个 HTML 资源、ZIP 断连、ZIP 声明超限、缺失附件清理、配置及夹具恢复 |
| 10 MiB 传输 | CLI 预检→Node HTTP 提交→CLI／内核重放，字节及 SHA 一致；源变化拒绝、提取／ZIP、已有目标与同级文件保留、validateOnly 不执行导出通过 |
| 遥测失败 | 受控 503 接收器验证工具成功、health 记录失败、后续调用按配置间隔再次尝试；没有向生产服务提交 |
| 未完整验证 | 全部 mutation action／凭据与并发扰动矩阵、所有真实 MCP 客户端及 App 操作、生产反馈／遥测、32 MiB 模板和 512 MiB 导出最大负载、完整取消／断线恢复组合 |

`tests/unit/api/client.test.ts` 的 `times out and cancels a stalled response body` 存在间歇失败：原 Node 客户端取消 reader 后，在计时边界上可能把 EOF 当成空响应。原实现的 100 次定时器／停滞流探测有 2 次意外 null；全量回归也捕获了该问题。该测试未删除或放宽，因此不能把全量回归写成稳定全绿。内核委托下载有独立超时／取消路径，其断连和失败清理专项通过。

### 真实写入覆盖

73 个静态 mutation action 中，1 项所列新建场景通过、5 项部分实测、67 项未纳入上述产物的逐 action 容器验收。这里区分场景通过与完整 action 验收；公共路由自动化不能替代所有实际修改场景。

| action | 已验证范围 | 未覆盖范围 |
|---|---|---|
| `document.create` | 新建预检、提交、重放、ID／归属／内容读回与清理 | 其他参数组合 |
| `document.remove` | 预检、删除、重放、目标不存在读回 | 完整凭据消费与并发扰动 |
| `file.create_template` | 新建、重放、1 MiB 正文边界、+1 字节拒绝 | 覆盖已有模板 |
| `file.update_template` | +1 字节拒绝且原正文 SHA 不变 | 成功更新与完整凭据矩阵 |
| `file.upload_asset` | 恰好 10 MiB 跨入口预检／提交／重放／SHA 读回、源变化拒绝、超限拒绝 | 换 requestId 复用旧租约等完整凭据矩阵 |
| `file.delete_asset` | 预检、删除、重放、目录读回确认不存在 | 旧租约及并发扰动 |

ZIP／文档提取的验收是传输、保存和清理验证，不算严格 mutation 覆盖。模板夹具通过思源文件 API 清理，不计为 `delete_template` action 验收。同步、购买、全局资源清理、仓库快照与第三方写入均未纳入容器操作范围。

### 产物与证据

| 验收产物 | SHA-256 |
|---|---|
| `dist/kernel.js` | `5c5284565c547f83f503d2aa46fba91b2d6f46e266bdbbdea4826805c83796f8` |
| `dist/mcp-server.cjs` | `0f1c331a306ee314dec0baac0d2d373a36f07055018e87733e47523bb9bbc4e6` |
| `cli/dist/cli.cjs` | `be5e767d9edbd42845632789c7088c71e17d6ff4564bf3dfbdace1612baa14ec` |

容器 `sisyphus-kernel-live-20260928-201526`，测试笔记本 `20260929111731-3q6nrjg`。临时文档、模板、附件、远端 ZIP 及本地传输目录已清理，测试配置已恢复、队列空闲；测试报告保留。个人笔记和生产外部服务未参与测试。

可复用脚本：`scripts/kernel-goja-smoke.go`、`tests/smoke/kernel-remaining-live.cjs`、`tests/smoke/kernel-remaining-faults.cjs`、`tests/smoke/kernel-telemetry-failure-live.cjs`。容器脚本需要隔离测试实例、对应构建产物和权限为 0600 的连接文件；不得针对个人工作空间执行。正向传输另有本机验收脚本，未将其描述为仓库可直接复现的命令。

本机日志为 `/tmp/kernel-scope-final-{build,tests,install,live,entrypoints,telemetry,transfer}.log`，基线超时探测为 `/tmp/kernel-scope-timeout-baseline.log`；临时日志仅供该机器回查，不作为文档构建或产品运行依赖。实现清单及附录由 `src/core/config.ts`、`src/core/tool-registry.ts`、`src/core/write-safety-policy.ts` 核对。

## 逐项对照与覆盖附录

<details>
<summary>143 个静态 action 的逐项功能对照</summary>

√ 表示部分受限，X 表示未发现 action 专属缺失；所有行仍受正文中的通用运行边界约束。这里只陈述实现，不把源码支持当成容器验收。各类 help 为公共路由，动态 extension action 不计入静态总数。

| 功能 / action | 是否缺失 | 日常操作与边界 |
|---|---|---|
| 打包导出资源 `file.export_resources` | √ | 直连需客户端保存；桥接需要新目标 |
| 提取文档和附件 `file.extract_doc` | √ | 未委托内核时仍需使用专用输出目录；桥接需新目标并处理附件失败 |
| 创建模板 `file.create_template` | √ | 模板正文默认 16 MiB，可配置 1–32 MiB；超过配置值拒绝，普通模板不受影响。 |
| 更新模板 `file.update_template` | √ | 模板正文默认 16 MiB，可配置 1–32 MiB；超过配置值拒绝，普通模板不受影响。 |
| 上传附件 `file.upload_asset` | √ | 直接内核客户端需实现暂存；大于 10 MiB 附件不能上传。网络分片续传两边均未实现。 |
| 直接读取图片 `file.read_image` | X | 图片有独立二进制额度；两种实现均受 20 MiB 单图上限约束。 |
| 提交反馈 `feedback.submit` | X | 内核通过宿主 forwardProxy 提交；网络、代理权限和外部表单规则影响可用性。生产服务未实测。 |
| 列目录 `fs.ls` | X | 日常列目录保留；大范围/多页读取可能超预算，需要缩小范围或分页。 fs 操作的是思源笔记虚拟路径，不是电脑任意文件。 |
| 目录树 `fs.tree` | X | 日常目录树保留；大范围/多页读取可能超预算，需要缩小范围或分页。 fs 操作的是思源笔记虚拟路径，不是电脑任意文件。 |
| 读取文件式笔记 `fs.read` | X | 日常读取文件式笔记保留；大范围/多页读取可能超预算，需要缩小范围或分页。 fs 操作的是思源笔记虚拟路径，不是电脑任意文件。 |
| 写入笔记 `fs.write` | X | 日常写入笔记保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 fs 操作的是思源笔记虚拟路径，不是电脑任意文件。 |
| 批量替换 `fs.replace` | X | 日常批量替换保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 fs 操作的是思源笔记虚拟路径，不是电脑任意文件。 |
| 删除笔记 `fs.rm` | X | 日常删除笔记保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 fs 操作的是思源笔记虚拟路径，不是电脑任意文件。 |
| 移动笔记 `fs.mv` | X | 日常移动笔记保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 fs 操作的是思源笔记虚拟路径，不是电脑任意文件。 |
| 排序 `fs.reorder` | X | 日常排序保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 fs 操作的是思源笔记虚拟路径，不是电脑任意文件。 |
| 搜索 `fs.search` | X | 日常搜索保留；大范围/多页读取可能超预算，需要缩小范围或分页。 fs 操作的是思源笔记虚拟路径，不是电脑任意文件。 |
| 列笔记本 `notebook.list` | X | 日常列笔记本保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 创建 `notebook.create` | X | 日常创建保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 打开/关闭 `notebook.set_open_state` | X | 日常打开/关闭保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 删除 `notebook.remove` | X | 日常删除保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 重命名 `notebook.rename` | X | 日常重命名保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 读取配置 `notebook.get_conf` | X | 笔记本配置读取保留；通常只有少量数据，无已知日常功能损失。 |
| 修改配置 `notebook.set_conf` | X | 日常修改配置保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 修改图标 `notebook.set_icon` | X | 日常修改图标保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 读取权限 `notebook.get_permissions` | X | 权限列表读取保留；通常只有少量数据，无已知日常功能损失。 |
| 修改权限 `notebook.set_permission` | X | 日常修改权限保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 子文档列表 `notebook.get_child_docs` | X | 日常子文档列表保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 创建文档 `document.create` | X | 日常创建文档保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 定位文档 `document.lookup` | X | 日常定位文档保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 确保链接目标 `document.ensure_link_targets` | X | 日常确保链接目标保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 重命名 `document.rename` | X | 日常重命名保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 删除 `document.remove` | X | 日常删除保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 移动 `document.move` | X | 日常移动保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 排序 `document.reorder` | X | 日常排序保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 读取子块 `document.get_child_blocks` | X | 日常读取子块保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 读取子文档 `document.get_child_docs` | X | 日常读取子文档保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 修改属性 `document.set_attr` | X | 日常修改属性保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 文档树 `document.list_tree` | X | 日常文档树保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 搜索文档 `document.search_docs` | X | 日常搜索文档保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 读取文档 `document.get_doc` | X | 日常读取文档保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 大纲 `document.get_outline` | X | 日常大纲保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 创建日记 `document.create_daily_note` | X | 日常创建日记保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 复制 `document.duplicate` | X | 日常复制保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 标题转文档 `document.heading_to_doc` | X | 日常标题转文档保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 文档转标题 `document.doc_to_heading` | X | 日常文档转标题保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 插入块 `block.insert` | X | 日常插入块保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 前置追加 `block.prepend` | X | 日常前置追加保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 末尾追加 `block.append` | X | 日常末尾追加保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 更新块 `block.update` | X | 日常更新块保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 替换块 `block.replace` | X | 日常替换块保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 删除块 `block.delete` | X | 日常删除块保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 移动块 `block.move` | X | 日常移动块保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 折叠状态 `block.set_fold_state` | X | 日常折叠状态保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 读取 Kramdown `block.get_kramdown` | X | 日常读取 Kramdown保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 批量读取 Kramdown `block.batch_kramdown` | X | 日常批量读取 Kramdown保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 读取子块 `block.get_children` | X | 日常读取子块保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 转移引用 `block.transfer_references` | X | 日常转移引用保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 修改属性 `block.set_attrs` | X | 日常修改属性保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 读取属性 `block.get_attrs` | X | 块属性读取保留；极端属性总量仍受预算约束。 |
| 块信息 `block.info` | X | 单块信息读取保留；普通单块请求没有已知功能损失。 |
| 面包屑 `block.breadcrumb` | X | 日常面包屑保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 读取 DOM `block.dom` | X | 日常读取 DOM保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 最近更新 `block.recent_updated` | X | 日常最近更新保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 字数统计 `block.word_count` | X | 字数统计保留；正常响应很小，无已知日常功能损失。 |
| 追加日记 `block.add_to_daily_note` | X | 日常追加日记保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 文档信息批量查询 `block.docs_info` | X | 按 id／ids 读取；保持输入顺序分批调用 |
| 数据库信息 `av.get` | X | 日常数据库信息保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 渲染/可选创建数据库 `av.render` | X | 读取大表受预算；创建仍走严格预检；按 view/page/pageSize 缩小读取。 |
| 属性键 `av.get_attribute_view_keys` | X | 日常属性键保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 过滤排序信息 `av.get_attribute_view_filter_sort` | X | 日常过滤排序信息保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 搜索数据库 `av.search` | X | 日常搜索数据库保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 添加行 `av.add_rows` | X | 日常添加行保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 删除行 `av.remove_rows` | X | 日常删除行保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 添加列 `av.add_column` | X | 日常添加列保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 删除列 `av.remove_column` | X | 日常删除列保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 修改单元格 `av.set_cells` | X | 日常修改单元格保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 列选项 `av.set_column_options` | X | 日常列选项保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 复制行 `av.duplicate_rows` | X | 日常复制行保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 复制数据库 `av.duplicate` | X | 日常复制数据库保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 主键值分页 `av.get_primary_key_values` | X | 日常主键值分页保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 添加视图 `av.add_view` | X | 日常添加视图保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 设置筛选 `av.set_filters` | X | 日常设置筛选保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 设置排序 `av.set_sorts` | X | 日常设置排序保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 设置分组 `av.set_group` | X | 日常设置分组保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 列可见性 `av.set_column_visibility` | X | 日常列可见性保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 列顺序 `av.set_column_order` | X | 日常列顺序保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 新行模板 `av.set_new_item_templates` | X | 日常新行模板保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 从模板创建 `av.create_from_template` | X | 日常从模板创建保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 双向关联配置 `av.configure_two_way_relation` | X | 日常双向关联配置保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 汇总配置 `av.configure_rollup` | X | 日常汇总配置保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 设置关联 `av.set_relation` | X | 日常设置关联保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 列模板 `file.list_templates` | X | 日常列模板保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 读取模板 `file.read_template` | X | 模板资源 text() 消费现在计入预算；大模板读取可调整普通读取预算，预算仍在 Go 缓冲之后检查。 |
| 删除模板 `file.delete_template` | X | 日常删除模板保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 文档存为模板 `file.save_doc_as_template` | X | 日常文档存为模板保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。通过 docSaveAsTemplate 服务端生成，不适用客户端创建/更新模板的正文上限。 |
| 渲染模板 `file.render` | X | 日常渲染模板保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 导出 Markdown `file.export_md` | X | 日常导出 Markdown保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 分页 Markdown 快照 `file.export_markdown_snapshot` | X | 日常分页 Markdown 快照保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 列闲置资源 `file.list_unused_assets` | X | 日常列闲置资源保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 文档资源清单 `file.get_doc_assets` | X | 日常文档资源清单保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 图片引用审计 `file.audit_image_refs` | X | 日常图片引用审计保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 读取 OCR `file.get_image_ocr_text` | X | 日常读取 OCR保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 清理闲置资源 `file.remove_unused_assets` | X | 日常清理闲置资源保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 重命名资源 `file.rename_asset` | X | 日常重命名资源保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 删除资源 `file.delete_asset` | X | 日常删除资源保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 全文搜索 `search.fulltext` | X | 日常全文搜索保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 语义搜索 `search.semantic` | X | 日常语义搜索保留；大范围/多页读取可能超预算，需要缩小范围或分页。两者均依赖思源自身的语义搜索配置/能力；不是内核实现了独立嵌入模型。 |
| SQL 查询 `search.query_sql` | X | 日常SQL 查询保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 反向链接 `search.get_backlinks` | X | 日常反向链接保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 引用搜索 `search.search_refs` | X | 日常引用搜索保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 查找替换 `search.find_replace` | X | 日常查找替换保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 资源搜索 `search.search_assets` | X | 日常资源搜索保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 附件内容搜索 `search.fulltext_asset_content` | X | 日常附件内容搜索保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 无效引用列表 `search.list_invalid_refs` | X | 日常无效引用列表保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 标签列表 `tag.list` | X | 日常标签列表保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 重命名标签 `tag.rename` | X | 日常重命名标签保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 删除标签 `tag.remove` | X | 日常删除标签保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 列时间线节点 `timeline.list_nodes` | X | 日常列时间线节点保留；大范围/多页读取可能超预算，需要缩小范围或分页。快照／回滚未纳入容器验收。 |
| 创建节点 `timeline.create_node` | X | 日常创建节点保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。快照／回滚未纳入容器验收。 |
| 对比节点 `timeline.compare_node` | X | 日常对比节点保留；大范围/多页读取可能超预算，需要缩小范围或分页。快照／回滚未纳入容器验收。 |
| 删除节点 `timeline.delete_node` | X | 日常删除节点保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。快照／回滚未纳入容器验收。 |
| 回滚文档 `timeline.rollback_document` | X | 日常回滚文档保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。快照／回滚未纳入容器验收。 |
| 回滚块 `timeline.rollback_block` | X | 日常回滚块保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。快照／回滚未纳入容器验收。 |
| 工作空间信息 `system.workspace_info` | X | 日常工作空间信息保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 网络配置 `system.network` | X | 日常网络配置保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 系统配置 `system.conf` | X | 日常系统配置保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 发送通知 `system.notify` | X | 共用思源 API，未发现内核专属缺失；属于外部副作用，不承诺严格回滚。通知／同步未纳入容器验收。 |
| 更新记录 `system.changelog` | X | 插件更新记录保留；正常响应很小，无已知日常功能损失。 |
| 同步 `system.perform_sync` | X | 共用思源 API，未发现内核专属缺失；属于外部副作用，不承诺严格回滚。通知／同步未纳入容器验收。 |
| 版本 `system.get_version` | X | 版本查询保留；响应很小，正常使用不会接近累计预算。 |
| 当前时间 `system.get_current_time` | X | 时间查询保留，时间来自思源 API；正常响应很小。 |
| 筛选/候选卡片 `flashcard.list_cards` | X | 日常筛选/候选卡片保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 卡包列表 `flashcard.get_decks` | X | 日常卡包列表保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 卡包卡片 `flashcard.get_cards` | X | 日常卡包卡片保留；大范围/多页读取可能超预算，需要缩小范围或分页。 |
| 复习评分 `flashcard.review_card` | X | 日常复习评分保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 创建卡片 `flashcard.create_card` | X | 日常创建卡片保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 删除卡片 `flashcard.remove_card` | X | 日常删除卡片保留；先预检再提交，同 requestId 重放。不能把超时当作未写入。 |
| 动态工具发现 `extension.list` | X | 注册诊断/包校验保留；没有 baked action 记录不代表缺失，extension 使用独立 schema/路由。动态第三方 action 另列。 |
| 静态包校验 `extension.validate_package` | X | 注册诊断/包校验保留；没有 baked action 记录不代表缺失，extension 使用独立 schema/路由。动态第三方 action 另列。 |
| 插件 MCP 注册诊断 `extension.diagnose_plugin_mcp` | X | 注册诊断/包校验保留；没有 baked action 记录不代表缺失，extension 使用独立 schema/路由。动态第三方 action 另列。 |
| 余额 `mascot.get_balance` | X | 余额查询保留；正常统计文件很小，预算通常没有可感知影响。 |
| 商店 `mascot.shop` | X | 商店清单保留；不是桌面宠物动画，正常规模下预算通常无影响。 |
| 购买 `mascot.buy` | X | 共用余额与购买逻辑，非桌面宠物动画本体；没有真实购买验收，不将注册成功当作购买已验证。 |

</details>

<details>
<summary>73 个 mutation action 的容器验收范围</summary>

以下状态均针对上表验收产物。未验收表示没有计入该产物的逐项容器证据；不表示功能未实现。

| action | 前置条件 | 验收状态 | 场景与边界 |
|---|---|---|---|
| `fs.write` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `fs.replace` | manifest | 未验收 | 未建立该 action 的独立容器验收场景 |
| `fs.rm` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `fs.mv` | structure | 未验收 | 未建立该 action 的独立容器验收场景 |
| `fs.reorder` | structure | 未验收 | 未建立该 action 的独立容器验收场景 |
| `notebook.create` | none | 未验收 | 未覆盖笔记本设置或权限修改 |
| `notebook.set_open_state` | state | 未验收 | 未覆盖笔记本设置或权限修改 |
| `notebook.remove` | state | 未验收 | 未覆盖笔记本设置或权限修改 |
| `notebook.rename` | state | 未验收 | 未覆盖笔记本设置或权限修改 |
| `notebook.set_conf` | state | 未验收 | 未覆盖笔记本设置或权限修改 |
| `notebook.set_icon` | state | 未验收 | 未覆盖笔记本设置或权限修改 |
| `notebook.set_permission` | state | 未验收 | 未覆盖笔记本设置或权限修改 |
| `document.create` | none | 已通过：新建/重放/回查 | 新建、提交、重放、只读回查和清理通过 |
| `document.ensure_link_targets` | structure | 未验收 | 未建立该 action 的独立容器验收场景 |
| `document.create_daily_note` | none | 未验收 | 未建立该 action 的独立容器验收场景 |
| `document.duplicate` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `document.rename` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `document.remove` | state | 部分通过：预检/删除/重放/回查 | 仅清理路径成功、重放、回查；未覆盖旧租约消费及并发扰动 |
| `document.move` | structure | 未验收 | 未建立该 action 的独立容器验收场景 |
| `document.reorder` | structure | 未验收 | 未建立该 action 的独立容器验收场景 |
| `document.set_attr` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `document.heading_to_doc` | structure | 未验收 | 未建立该 action 的独立容器验收场景 |
| `document.doc_to_heading` | structure | 未验收 | 未建立该 action 的独立容器验收场景 |
| `block.insert` | none | 未验收 | 未建立该 action 的独立容器验收场景 |
| `block.prepend` | none | 未验收 | 未建立该 action 的独立容器验收场景 |
| `block.append` | none | 未验收 | 未建立该 action 的独立容器验收场景 |
| `block.add_to_daily_note` | none | 未验收 | 未建立该 action 的独立容器验收场景 |
| `block.update` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `block.replace` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `block.delete` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `block.move` | structure | 未验收 | 未建立该 action 的独立容器验收场景 |
| `block.set_fold_state` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `block.transfer_references` | manifest | 未验收 | 未建立该 action 的独立容器验收场景 |
| `block.set_attrs` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.render` | none | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.add_rows` | none | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.remove_rows` | manifest | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.add_column` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.remove_column` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.set_cells` | manifest | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.set_column_options` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.duplicate_rows` | manifest | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.duplicate` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.add_view` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.set_filters` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.set_sorts` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.set_group` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.set_column_visibility` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.set_column_order` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.set_new_item_templates` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.create_from_template` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.configure_two_way_relation` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.configure_rollup` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `av.set_relation` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `file.upload_asset` | source | 部分通过：10 MiB/跨入口/源变化/重放 | 跨入口、10 MiB、源变化及重放通过；未覆盖换 requestId 复用旧租约 |
| `file.create_template` | state | 部分通过：新建/重放/边界 | 新建分支实测；已有模板的覆盖分支未验收，故不记整个 action 完整覆盖 |
| `file.update_template` | state | 部分通过：超限拒绝/原字节保持 | 仅超限拒绝与原字节保持，未覆盖成功更新 |
| `file.delete_template` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `file.save_doc_as_template` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `file.remove_unused_assets` | manifest | 未验收 | 未执行全工作空间资源清理 |
| `file.rename_asset` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `file.delete_asset` | state | 部分通过：预检/删除/重放/回查 | 仅夹具清理、重放、回查；未覆盖旧租约及并发扰动 |
| `search.find_replace` | manifest | 未验收 | 未执行跨文档替换或标签修改 |
| `tag.rename` | manifest | 未验收 | 未执行跨文档替换或标签修改 |
| `tag.remove` | manifest | 未验收 | 未执行跨文档替换或标签修改 |
| `timeline.create_node` | none | 未验收 | 未覆盖仓库快照或回滚 |
| `timeline.delete_node` | state | 未验收 | 未覆盖仓库快照或回滚 |
| `timeline.rollback_document` | state | 未验收 | 未覆盖仓库快照或回滚 |
| `timeline.rollback_block` | state | 未验收 | 未覆盖仓库快照或回滚 |
| `flashcard.review_card` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `flashcard.create_card` | none | 未验收 | 未建立该 action 的独立容器验收场景 |
| `flashcard.remove_card` | state | 未验收 | 未建立该 action 的独立容器验收场景 |
| `mascot.buy` | state | 未验收 | 未执行消耗余额的购买 |

条件分支：`fs.write`、`file.create_template` 新建无需状态哈希，覆盖需要；`av.render` 仅 `createIfNotExist=true` 修改；`document.ensure_link_targets` 的 resolve／reuse／dryRun 为只读。未列出的分支不视为已覆盖。

</details>
