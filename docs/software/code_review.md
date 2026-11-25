# 0. 评审注意事项

- 评审对象：`Muhaymenul/openhai` 自研 research 模块（`services/*.py`、`app/src/lib/research/`、`app/src/components/research/qa/`）
- Diff 规模：源文件 9 个（新增 2 个、重构 7 个），测试 3 个（新增 2 个、扩充 1 个），配置 1 个；净变更以拆分与测试为主
- 评审模板：bettermorn/ACMWDevHubPPT 的 [CodeReviewTemplate](https://github.com/bettermorn/ACMWDevHubPPT/blob/master/Methodology/CodeReviewTemplate.md)（章节与检查项保持一致）
- 严格度：strict（生产代码）
- 评审方式：项目作者自审 + 静态分析工具辅助；建议人工复核时长 1.5–2 小时
- 本表正文 36 项、补充检查 8 项，共 44 项：是 37 / 否 4 / 不适用 2 / 未知 1；问题行 23 条：Blocker 0 / Critical 1 / Major 12 / Minor 10（已修复 12 条 / 13 个问题点，其中 3 个未使用导入；豁免或登记 11 条）
- 配套质量报告：[`docs/software/code_quality.md`](code_quality.md)（含扫描报告截图与重构前后指标）

# 1.关于代码

| 检查项目     |           结果            | 说明                                                |
| :----------- | :-----------------------: | :-------------------------------------------------- |
| 模块名       |         research          | 研究引擎（Python）+ 研究 API / 上下文（TypeScript） |
| 审查人员     | 项目作者自审（工具辅助）  | 人工复核：任课教师                                  |
| 版本         |            1.1            | 1.0 为重构前基线；1.1 为 Top 5 修复后的复审版本     |
| 日期         |        2026-11-25         |                                                     |
| 程序设计语言 | TypeScript 5 / Python 3.9 | Next.js 16 + 标准库 asyncio                         |
| 作者         |        Muhaymenul         | 项目作者                                            |
| 文件数       |            13             | 源文件 9，测试文件 3，配置 1                        |

# 2.自动检查

| 检查项目                       |                                                  结果                                                  | 说明                                                                                                                                                    |
| :----------------------------- | :----------------------------------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 代码通过编译，没有任何错误     |                                                   是                                                   | `npx tsc --noEmit` 0 error；`npx next build` 成功；`python -m compileall services` 通过                                                                 |
| 代码通过编译，没有任何警告信息 |                                                   是                                                   | 编译/类型检查无警告；ESLint 质量规则集另有 837 条 Code Smell 告警（复杂度/长度阈值），见第 5 章                                                         |
| 存在单元测试                   |                                                   是                                                   | services 42 passed（重构前 23）；research 前端 160 passed / 1 skipped；覆盖率未统计（未知）                                                             |
| 代码处于源代码版本控制之下     |                                                   是                                                   | 原有文件均已跟踪；本次新增的 `api-http.ts`、`api-routes.ts`、两个测试文件与质量配置已纳入提交 `488c6e1`（分支 `code-quality-report`），提交前已完成密钥扫描 |
| 使用检查工具对代码进行了检查   |                                                   是                                                   | 前端与 Python 均执行了 lint、类型检查、复杂度、重复度扫描                                                                                               |
| 检查工具名称                   | ESLint 9.39.5, tsc 5.9.3, Radon 6.0.1, Pylint 2.14.5, Ruff 0.17.6, jscpd 4.2.5, pytest 7.1.2, Vitest 5.0.5 | 配置见 `app/eslint.quality.config.mjs`                                                                                                                  |
| 使用检查工具检查的结果         |                                        Error(0) / Warning(837)                                         | 项目 lint 基线 0/0；Python Pylint Error 0 / Warning 22；Ruff 正确性 0；重复率 0.73%；被重构的 5 个函数 CC ≤10，静态正确性缺陷 0，被重构前端文件无 CC>10 |

# 3.设计

| 检查项目                             |  结果  | 说明                                                                                                                                                                                      |
| :----------------------------------- | :----: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 代码已完成（相对于软件功能定义来说） |   是   | 路由、研究任务、流式模型、来源检索、审批、恢复、取消、导出/备份均有实现与测试                                                                                                             |
| 选择的算法模型很好                   |   是   | 标准库 asyncio + OpenAI 兼容流式客户端；无第三方运行时依赖；搜索/截断/预算均为有界线性操作                                                                                                |
| 采用了恰当的设计模式                 |   是   | 路由表、依赖注入（`model_call`）、Hooks、策略式错误映射；避免上帝函数                                                                                                                     |
| 任何缺失的功能都已在代码中清晰的标出 | 不适用 | 当前范围内未发现未实现占位或静默 `pass`；无遗留 TODO/FIXME                                                                                                                                |
| 代码的结构很好                       |   是   | `api-http.ts`（HTTP 辅助）/ `api-routes.ts`（路由）/ `api.ts`（入口）；`research_service.py`（编排）/ `agent_loop.py`（循环）/ `research_tools.py`（工具）/ `research_context.py`（检索） |
| 存在设计文档                         |   是   | `docs/software/architecture.md`、`docs/algorithm/research.md`、`docs/software/validation.md`                                                                                              |
| 代码与这些文档相符                   |   是   | RPC 方法、状态文件、来源范围与文档一致；160 个 research 测试覆盖契约                                                                                                                      |

# 4.对代码编写质量的总体意见

## 风格

| 检查项目                    | 结果 | 说明                                                                                        |
| :-------------------------- | :--: | :------------------------------------------------------------------------------------------ |
| 代码的布局很清晰            |  是  | Prettier/ESLint 通过；重构后单函数职责单一，嵌套 ≤4                                         |
| 代码遵循项目的风格准则      |  是  | TypeScript 双引号/尾逗号；Python 4 空格、类型注解、显式异常                                 |
| 存在良好（无歧义）的公共API |  是  | `handleResearchRequest(request, segments)`；RPC 方法 `research.*`；参数对象化，布尔标志少   |
| 选择的名称表达清晰和易理解  |  是  | `_validated_sources`、`_replayed_request`、`_consume_frame`、`sourceBlockReason` 等语义明确 |

## 防御性编程

| 检查项目                       |  结果  | 说明                                                                                                       |
| :----------------------------- | :----: | :--------------------------------------------------------------------------------------------------------- |
| 避免空指针                     |   是   | TS 可选链 + 类型收窄；Python Optional 检查；已修复 `Connection.accepts` 的 Optional 下标                   |
| 数据类型选择正确并使用类型检查 |   是   | `tsc --noEmit` 0 error；Python 注解 + Pylint/Ruff                                                          |
| 所有输入都经过验证             |   是   | HTTP 边界用 zod；RPC 边界校验字段长度/类型/数量；来源文本总量 ≤2,000,000 字符                              |
| 限制资源使用                   |   是   | 请求体 ≤2MB、帧 ≤16MB、来源 ≤4 篇、单页 ≤100,000 字符、队列 4096、模型调用有 deadline                      |
| 控制并发                       |   是   | `asyncio.Semaphore`、`session_busy`、`approval_lock`、单线程事件循环 + 有界线程池                          |
| 避免循环引用                   |   是   | `research_context.py` 用 `TYPE_CHECKING` 引入参数类型，运行时不形成 `research_tools ↔ research_context` 环 |
| 不存在特定编译器功能（C/C++）  | 不适用 | 项目为 TypeScript + Python                                                                                 |

## 错误处理

| 检查项目                         | 结果 | 说明                                                                                                                                                          |
| :------------------------------- | :--: | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 错误情况都得到了处理             |  是  | HTTP 错误映射、RPC 错误码、模型重试/中断、文件原子写、取消与超时均有分支                                                                                      |
| 使用断言来验证逻辑               |  否  | 仅启动处 1 个 assert；内部不变量主要靠类型、显式异常与测试；未批量增加断言，避免用断言替代错误处理。                                                          |
| 代码是异常安全(exception safe)的 |  是  | `atomic_json` 临时文件 + `os.replace`；`finally` 清理 future/事件；连接关闭有 `gather(return_exceptions=True)`                                                |
| 错误将被传播，而不会被隐藏       |  否  | 领域错误映射为明确状态码，模型错误保留 `code/message`；但 3 处服务边界 `broad-except` 统一转为 `failed` 且未记录异常堆栈，已作为服务边界豁免登记（见第 5 章） |
| 本地有日志文件                   |  否  | 仅 `logging.StreamHandler` 输出到 stderr，无本地日志文件；单机应用由宿主捕获 stderr，已登记技术债（见第 7 节）                                                |
| 没有任何资源被泄露               |  是  | 文件、连接、任务、线程池在作用域或 `finally` 中释放                                                                                                           |
| 代码使用多线程                   |  是  | `ThreadPoolExecutor` + asyncio（模型调用在线程池，事件在事件循环）                                                                                            |
| 它是线程安全的                   |  是  | 共享审批表加锁；运行状态只在事件循环线程修改；默认并发 1                                                                                                      |
| 不会发生死锁                     |  是  | 单锁、无嵌套加锁；跨线程调用有超时；线程池任务不反向等待事件循环锁                                                                                            |

## 结构

| 检查项目               | 结果 | 说明                                                                                         |
| :--------------------- | :--: | :------------------------------------------------------------------------------------------- |
| 不存在冗余的代码       |  是  | 未用导入/变量已清理；未发现重复造轮子                                                        |
| 不存在剪切粘贴式的编程 |  否  | jscpd 67 处 / 608 行（0.73%），低于 3% 门禁；主要在上游 API 路由对，已登记第 5 章 jscpd 条目 |

# 5.代码审查 清单

## 语句级审查

| 文件                                                |       行        |                      问题                      | 说明                                                                                                                                          |
| :-------------------------------------------------- | :-------------: | :--------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/src/lib/research/api.ts`                       |  133（重构前）  |         单函数 75 个 if，圈复杂度 146          | [Major][SM-B01/SM-O01] 拆为 `api-http.ts` / `api-routes.ts` / `api.ts`；39 个 API 测试通过【已修复 v1.1】                                     |
| `app/src/components/research/qa/run-context.ts`     |  34（重构前）   |           圈复杂度 74，多层嵌套三元            | [Major][SM-B06] 拆为来源完整性、版本匹配、范围文案、阻断原因、提示语等纯函数；4 个测试通过【已修复 v1.1】                                     |
| `services/research_service.py`                      |  238（重构前）  |          `start_run` 圈复杂度 40（E）          | [Major][SM-B01] 拆为 10 个方法，保持校验顺序/错误码/持久化顺序；42 个测试通过【已修复 v1.1】                                                  |
| `services/research_service.py`                      |  315（重构前）  |         `_validated_start` 圈复杂度 26         | [Major][SM-B01] 拆出 `_required_text` / `_optional_text` / `_validated_start_documents`【已修复 v1.1】                                        |
| `services/llm_client.py`                            |  100（重构前）  |           `stream_chat` 圈复杂度 24            | [Major][SM-B01] 拆出建连、单帧解析、流消费、重试策略；新增 6 个离线测试【已修复 v1.1】                                                        |
| `services/research_context.py`                      |     30 / 66     | `PaperReadParams` / `PaperSearchParams` 未定义 | [Critical][SM-V01] 注解在 `from __future__ import annotations` 下不立即求值，但类型检查器报错；补 `TYPE_CHECKING` 导入【已修复 v1.1】         |
| `services/research_service.py`                      |       662       |             Optional 对象直接下标              | [Major][SM-V07] `Connection.accepts` 改为局部变量 + 提前返回，补订阅过滤测试【已修复 v1.1】                                                   |
| `services/research_service.py`                      |   原 15 / 32    |     未使用导入 `contextlib` / `llm_client`     | [Minor][SM-D02] 删除【已修复】                                                                                                                |
| `services/research_tools.py`                        |       10        |                未使用导入 `re`                 | [Minor][SM-D02] 删除【已修复】                                                                                                                |
| `services/rpc_probe.py`                             |       178       |             未使用变量 `last_seq`              | [Minor][SM-D02] 删除【已修复】                                                                                                                |
| `services/llm_client.py`                            |     原 160      |          `except ...: raise` 立即重抛          | [Minor][SM-D03] 移除多余 try/except【已修复】                                                                                                 |
| `services/research_service.py`                      |       68        |         `RpcFailure` 未调用基类初始化          | [Minor][SM-V08] 调用 `super().__init__(message)`【已修复】                                                                                    |
| `app/src/lib/research/api-routes.ts`                |        —        |               文件 718 行 > 600                | [Minor][SM-B02] 路由处理器聚合；下一轮按 papers / runs / settings 分域拆分【已登记】                                                          |
| `app/src/components/pdf/PdfReader.tsx`              |       106       |                  圈复杂度 93                   | [Major][SM-B01] 上游渲染组件；缺针对性回归测试，待补测试后拆分【已豁免，下一轮】                                                              |
| `app/src/lib/canvas/validation.ts`                  |       212       |                  圈复杂度 70                   | [Major][SM-B01] 上游画布校验；同上【已豁免，下一轮】                                                                                          |
| `app/src/components/research/ResearchGraph.tsx`     |       37        |                  圈复杂度 51                   | [Major][SM-B01] 研究图谱 UI；待补组件测试【已豁免，下一轮】                                                                                   |
| `app/src/components/research/ResearchReader.tsx`    |       61        |                  圈复杂度 47                   | [Major][SM-B01] 阅读器 UI；待补组件测试【已豁免，下一轮】                                                                                     |
| `app/src/components/research/ResearchWorkspace.tsx` |       73        |                  圈复杂度 43                   | [Major][SM-B01] 工作区 UI；待补组件测试【已豁免，下一轮】                                                                                     |
| `services/rpc_probe.py`                             |       83        |            `main` 圈复杂度 29（D）             | [Minor] 开发者手动探针，无生产调用路径；待拆步骤函数【已登记】                                                                                |
| `services/research_service.py`                      |       214       |          `configure` 圈复杂度 19（C）          | [Minor] 配置校验链；已有错误码测试；待拆 URL/model 校验【已登记】                                                                             |
| `services/research_service.py`                      | 453 / 481 / 692 |              宽泛捕获 `Exception`              | [Major][SM-V03] 服务边界兜底，防止未预期异常杀死 RPC 连接；保留并加注释说明【已豁免】                                                         |
| `services/research_service.py`                      |       786       |        `raise SystemExit(1)` 未 `from`         | [Minor][SM-V08] 保留原始异常链更利于排查，待下一轮调整【已登记】                                                                              |
| `app/src/app/api/**`                                |        —        |           67 处重复 / 608 行 / 0.73%           | [Minor][SM-D01] 低于 3% 门禁；主要是上游 `add` / `status` / shares / chats 路由对；待统一提取【已登记】                                       |
| `services/tests/test_llm_client.py`                 |       14        |                 `# noqa: E402`                 | [说明] 测试需先 `sys.path.insert` 再导入 `llm_client`；沿用现有测试文件的同一做法，非规避检查【接受】                                         |
| `app/tests` 全量                                    |        —        |            456 failed / 720 passed             | [环境] 基线为 455 / 716；失败集中在 PDF worker、签名校验、发布脚本等依赖本机工具链的用例；本次涉及 160 个 research 测试全部通过【非本次改动】 |

# 6.跟踪调查

## 评审结论

| 检查项目           |    结果    | 说明                                                                                                                  |
| :----------------- | :--------: | :-------------------------------------------------------------------------------------------------------------------- |
| 代码质量较好       | 是（v1.1） | v1.0 为“否”：3 个 Pylint Error、2 个前端 CC>50 函数、3 个 Python CC≥24 函数；v1.1 已关闭 Top 5，剩余 Major 已登记豁免 |
| 重新编写并验证     |    完成    | tsc 0、next build 成功、compileall 通过、pytest 42 passed、research Vitest 160 passed                                 |
| 重新编写并重新审查 |    通过    | 复扫 Pylint Error 0、Ruff F/E9 0、被重构前端文件无 CC>10；Python 目标函数均 ≤10                                       |

## 在这里记录审查的结果

| 检查项目 |      结果       | 说明                                   |
| :------- | :-------------: | :------------------------------------- |
| 审查     | 结果2：通过审查 | Top 5 已修复；剩余问题有登记与豁免理由 |
| 校验     | 结果2：通过校验 | 以第 2 章自动检查结果为准              |

# 7. 补充检查项（模板外）

| 检查项目                                                       | 结果 | 说明                                                                                              |
| :------------------------------------------------------------- | :--: | :------------------------------------------------------------------------------------------------ |
| 不存在硬编码的密钥、口令和环境信息（SM-V05）                   |  是  | `private/` 未纳入版本控制；源码仅测试占位串；密钥由 `private/model.env` 注入                      |
| 不存在 SQL、命令、HTML 注入风险（SM-V13）                      |  是  | 无 SQL/Shell 执行；React 默认转义；路径/ID 有 schema；外链使用 `quote()`                          |
| 已做鉴权与越权（IDOR）检查                                     |  是  | HTTP 仅本机访问；非回环 RPC 必须 token；会话/文献/来源均有归属校验                                |
| 日志中无敏感信息（SM-V17）                                     |  是  | `RedactingFormatter` 替换 API key 与 Bearer；错误消息不返回原始响应体                             |
| 依赖无高危漏洞，新增依赖已锁定版本（TH-14，SM-V18）            | 未知 | Python 仅标准库；`npm audit` 因 npmmirror 未实现安全公告接口返回 404，无法在本机完成              |
| 单元测试有效：有断言，覆盖异常路径，未 Mock 被测对象（SM-V06） |  是  | 新增测试断言可观察行为；模型调用通过注入的 `model_call` 替换，未 Mock 被测服务                    |
| 变更聚焦，无超范围修改（SM-V10，TH-11）                        |  是  | 仅 research 模块、测试、质量配置与报告                                                            |
| 公共接口和数据结构的变更向后兼容，或附有迁移方案               |  是  | HTTP 路由/方法、RPC 方法/错误码、`state.json` / `events.jsonl` 格式未变；160 个 research 测试验证 |

# 8. 给人工评审者的关注点

1. `api-routes.ts` 的路由匹配顺序是否与旧 `if` 链完全等价（现有 39 个 API 测试覆盖主要路径，未穷举所有方法组合）。
2. 服务边界 3 处 `broad-except` 是否应改为结构化日志 + 更细错误码，而不是统一 `model_error`。
3. 上游高 CC 组件（PdfReader 93、validateSharedCanvas 70、ResearchGraph 51）是否纳入下一轮重构。
4. 全量 Vitest 的 456 个环境失败是否需要在 CI 中隔离或修复，避免掩盖真实回归。
5. `api-routes.ts` 是否按域拆分，回到 600 行以内。

# 9. 禁止行为自检

- 未使用 `eslint-disable` / `ts-ignore` / 新增 `noqa` 规避检查（唯一的 `# noqa: E402` 是测试导入顺序所需，已在上表说明）。
- 未删除、跳过或弱化任何测试；新增 19 个 Python 用例和 5 个前端路由用例。
- 未修改原有 lint 配置来掩盖问题；质量规则集是新增的独立配置。
- 未伪造未运行的检查：依赖漏洞扫描明确填“未知”并说明原因。
- 未顺手做与问题无关的重构；变更集中在 research 模块与对应测试。
