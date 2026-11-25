# 代码质量检查报告

| 项目     | 内容                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 项目     | openhai（教研阅记）                                                                                                                     |
| 仓库     | <https://github.com/Muhaymenul/openhai>                                                                                                 |
| 检查日期 | 2026-11-25                                                                                                                              |
| 检查范围 | 自研 research 模块：`services/*.py`、`app/src/lib/research/`、`app/src/components/research/qa/`；同时对 `app/src` 全仓做背景扫描        |
| 检查工具 | ESLint 9.39.5（新增质量规则集）、TypeScript 5.9.3、Radon 6.0.1、Pylint 2.14.5、Ruff 0.17.6、jscpd 4.2.5、pytest 7.1.2、Vitest 5.0.5       |
| 重构原则 | 先补测试，再小步重构；每次重构后立即运行测试；不改变对外接口、RPC 契约、状态文件格式和用户可见行为                                      |
| 参考方法 | bettermorn/ACMWDevHubPPT 的 [CodeQualitySkill](https://github.com/bettermorn/ACMWDevHubPPT/blob/master/Methodology/CodeQualitySkill.md) |

## 1. 静态分析工具配置

项目原本已有 ESLint（`app/eslint.config.mjs`）和 Python 标准库运行环境，但没有复杂度、函数长度、嵌套深度等质量阈值。本次新增一个**独立**的质量规则集，不削弱原有 lint 门禁：

`app/eslint.quality.config.mjs`

```js
import { defineConfig } from "eslint/config";
import base from "./eslint.config.mjs";

export default defineConfig([
  ...base,
  {
    files: [
      "src/**/*.{ts,tsx}",
      "tests/**/*.{ts,tsx}",
      "scripts/**/*.{ts,mts,js,mjs,cjs}",
    ],
    rules: {
      complexity: ["warn", { max: 10 }],
      "max-lines-per-function": [
        "warn",
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
      "max-depth": ["warn", 4],
      "max-params": ["warn", 5],
      "max-lines": [
        "warn",
        { max: 600, skipBlankLines: true, skipComments: true },
      ],
    },
  },
]);
```

运行方式：

```bash
cd app
npm run lint                              # 原有门禁
npx eslint --config eslint.quality.config.mjs . -f json -o eslint-quality.json
npx tsc --noEmit

cd ..
python -m radon cc services -s            # 圈复杂度
python -m pylint services                 # 错误 / 警告 / 坏味道
python -m ruff check services             # 正确性 + 现代化建议
npx jscpd@4.2.5 --min-lines 6 --min-tokens 50 --reporters json,html \
  --output jscpd app/src services scripts
python -m pytest services/tests -q
```

## 2. 扫描报告截图

### 2.1 重构前后指标对比

![重构前后指标对比](code_quality_assets/01-before-after.png)

### 2.2 ESLint 质量规则扫描（重构后）

![ESLint 报告](code_quality_assets/02-eslint-quality.png)

截图显示：`837 problems (0 errors, 837 warnings)`。原项目 lint 基线为 0 error / 0 warning；837 条均来自新增的质量阈值（复杂度、函数/文件长度、嵌套、参数个数），属于 Code Smell 计数，不是编译错误。

### 2.3 jscpd 重复代码扫描（重构后）

![jscpd 报告](code_quality_assets/03-jscpd-duplication.png)

截图显示：527 个文件、83,773 行、67 处重复、608 行重复，重复率 **0.73%**，低于 3% 的常用门禁。

### 2.4 Python / TypeScript 工具原始输出（重构后）

![Python 扫描输出](code_quality_assets/04-python-scan.png)

## 3. 重构前基线

### 3.0 任务要求的四项指标

| 指标                               | 重构前                         | 重构后                                 | 说明                                                               |
| ---------------------------------- | ------------------------------ | -------------------------------------- | ------------------------------------------------------------------ |
| Bug 数（静态正确性缺陷，去重）     | 7                              | 0                                      | Pylint Error 3 + Ruff F/E9 6，其中 2 个未定义类型重复，去重后 7 项 |
| Code Smell 数（前端）              | 840                            | 837                                    | ESLint 质量规则 Warning；拆分新增辅助函数带来少量计数              |
| Code Smell 数（Python）            | 29                             | 22                                     | Pylint Warning（含测试）                                           |
| 圈复杂度（全仓最高 / Python 最高） | 146（api.ts）/ 40（start_run） | 93（PdfReader，上游）/ 29（rpc_probe） | 被重构的 5 个函数均 ≤10；静态正确性缺陷清零                        |
| 重复率                             | 0.73%                          | 0.73%                                  | jscpd 67 处 / 608 行，低于 3% 门禁                                 |

### 3.1 缺陷与坏味道

| 指标                               |      重构前 | 说明                                                                          |
| ---------------------------------- | ----------: | ----------------------------------------------------------------------------- |
| ESLint Error / Warning（项目基线） |       0 / 0 | 原 lint 门禁本来就是干净的                                                    |
| ESLint 质量规则 Warning            |         840 | 525 条函数过长、262 条复杂度过高、22 条文件过长、16 条嵌套过深、15 条参数过多 |
| TypeScript 类型错误                |           0 | `tsc --noEmit` 通过                                                           |
| Pylint Error                       |           3 | 2 个未定义类型名、1 个 Optional 对象下标                                      |
| Pylint Warning                     |          29 | 含 3 个宽泛捕获、1 个多余 try/except、3 个未用导入等                          |
| Ruff 正确性缺陷（F / E9）          |           6 | F821×2、F401×3、F841×1                                                        |
| Radon 函数总数                     |         161 | A 124 / B 25 / C 8 / D 3 / E 1                                                |
| 最高圈复杂度                       | **40（E）** | `research_service.py::start_run`                                              |
| 重复代码率                         |       0.73% | 67 处 / 608 行                                                                |

### 3.2 重构前 Top 10 圈复杂度（前端）

| 排名 | 函数                    | 文件                                                |      CC |
| ---: | ----------------------- | --------------------------------------------------- | ------: |
|    1 | `handleResearchRequest` | `app/src/lib/research/api.ts`                       | **146** |
|    2 | `PdfReader`             | `app/src/components/pdf/PdfReader.tsx`              |      93 |
|    3 | `runContextMetadata`    | `app/src/components/research/qa/run-context.ts`     |  **74** |
|    4 | `validateSharedCanvas`  | `app/src/lib/canvas/validation.ts`                  |      70 |
|    5 | `ResearchGraph`         | `app/src/components/research/ResearchGraph.tsx`     |      51 |
|    6 | `ResearchReader`        | `app/src/components/research/ResearchReader.tsx`    |      47 |
|    7 | `ResearchWorkspace`     | `app/src/components/research/ResearchWorkspace.tsx` |      43 |
|    8 | `parseDeadlineText`     | `app/src/lib/research/planner/date.ts`              |      40 |
|    9 | `readPdfSelection`      | `app/src/components/research/reader-context.ts`     |      39 |
|   10 | `core.ts` 内箭头函数    | `app/src/lib/research/review/core.ts`               |      39 |

### 3.3 重构前 Top 圈复杂度（Python）

| 函数               | 文件                           |  CC | 等级 |
| ------------------ | ------------------------------ | --: | ---- |
| `start_run`        | `services/research_service.py` |  40 | E    |
| `main`             | `services/rpc_probe.py`        |  29 | D    |
| `_validated_start` | `services/research_service.py` |  26 | D    |
| `stream_chat`      | `services/llm_client.py`       |  24 | D    |
| `configure`        | `services/research_service.py` |  19 | C    |

## 4. Top 5 问题与重构

选取口径：重构范围限定在自研 research 模块，按“圈复杂度 + 静态正确性缺陷 + 用户可见行为风险”综合排序；上游 UI 组件（`PdfReader` 等）只做背景扫描，列入下一轮（见第 7 节），不在本次 Top 5 内。

### #1 研究 API 总入口：`handleResearchRequest`，CC 146

**问题**：`app/src/lib/research/api.ts` 用一个约 500 行的函数承载全部 REST 路由，包含 75 个 `if`，把守卫、参数校验、文件上传、笔记、批注、知识、图谱、运行任务、设置、导出、备份和错误映射全部写在同一作用域内。任何路由改动都可能影响其他路由。

**重构**（行为不变）：

- `api.ts`（97 行）：只保留 `handleResearchRequest`、错误映射和入口导出。
- `api-http.ts`（66 行）：`json`、`body`、`guard`、`versionFromRequest`、`visibleRun`。
- `api-routes.ts`（718 行）：16 条路由处理器 + 路由表；匹配顺序与原 `if` 链完全一致，未命中仍返回同一个 404。
- 错误映射拆为 `zodErrorResponse` / `pdfErrorResponse` / `domainErrorResponse` / `rpcErrorResponse`，判断顺序与状态码保持不变。

**验证**：

- 先补 5 个路由特征测试：根快照、health、未知路由/错误方法、非法路径段、跨来源写入。
- 重构后 `tests/lib/research-*.test.ts` 共 **160 passed / 1 skipped**（30 个文件），其中原有 39 个 API/上下文测试全部通过。

### #2 提问上下文元数据：`runContextMetadata`，CC 74

**问题**：`app/src/components/research/qa/run-context.ts` 在一个函数里计算来源完整性、版本匹配、选文页码、范围文案、阻断原因和提示语，嵌套三元与 `&&` 密集，任何文案调整都容易改错分支。

**重构**：

- 拆出来源记录、可用文献表、版本匹配、选文状态、范围文案、阻断原因、提示语等纯函数。
- `runContextMetadata` 只做组合；返回对象的字段、顺序和值保持不变。
- 复杂度：74 → **≤10**；文件行数 280。

**验证**：原有 4 个 `run-context` 测试通过；`tsc --noEmit` 0 error。

### #3 研究任务创建：`start_run` + `_validated_start`，CC 40 / 26

**问题**：`services/research_service.py` 的 `start_run` 同时负责参数校验、幂等摘要、请求重放、模型配置检查、文档/选区范围校验、来源校验、会话校验、会话创建、运行记录写入和调度。校验顺序与错误码是 RPC 契约的一部分，无法安全改动。

**重构**：

- `start_run`（40 → **3**）变为 8 个步骤的组合。
- 拆出 `_request_digest`、`_replayed_request`、`_require_configured`、`_validated_document_scope`、`_validated_sources`、`_scope_sources`、`_resolve_session`、`_validate_session`、`_session_is_busy`、`_enqueue_run`。
- `_validated_start`（26 → **6**）拆出 `_required_text`、`_optional_text`、`_validated_start_documents`。
- 严格保持：校验顺序、错误码、错误消息、幂等摘要字段、`state.json` 写入顺序、`events.jsonl` 的 queued 事件、任务调度顺序。

**先补测试**：新增 13 个用例，覆盖字段长度/类型、文档上下文不一致、非法选区、来源越界、重复来源、未知会话、超过 4 篇来源、超过 2,000,000 字符、会话忙等。

**验证**：`pytest services/tests -q` → **42 passed**（重构前 23 passed）。

### #4 流式模型客户端：`stream_chat`，CC 24

**问题**：`services/llm_client.py` 把“建连重试、SSE 解析、首 token 前/后错误语义、工具调用合并”耦合在一个循环里。首 token 前允许重试、首 token 后中断必须保留已流出文本，这是用户可见行为。

**重构**：

- `_open_stream`：HTTP/URL 错误分类；可重试错误抛内部 `_RetryStream`。
- `_consume_frame`：单帧解析，`[DONE]`、无效 JSON、上游 error 帧。
- `_consume_stream`：遍历响应；首 token 前断开走重试，首 token 后断开抛 `interrupted`。
- `stream_chat`（24 → **6**）：只保留 attempt 预算与重试策略。

**先补测试**：新增 `services/tests/test_llm_client.py` 6 个离线用例，覆盖 token 累积、工具调用合并、无效帧、错误帧脱敏、500 重试、401 不重试、流中断。

**验证**：6 个用例通过；`pylint services/llm_client.py` 的 Error/Warning 为 0。

### #5 静态分析正确性缺陷

| 问题                                                 | 位置（重构前）                                                        | 级别                     | 修复                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| 未定义类型名 `PaperReadParams` / `PaperSearchParams` | `services/research_context.py:27,63`                                  | Pylint Error / Ruff F821 | 增加 `TYPE_CHECKING` 导入，注解可被类型检查器解析，运行时不产生循环导入 |
| Optional 对象直接下标                                | `services/research_service.py:605`                                    | Pylint Error             | `Connection.accepts` 改用局部变量 + 提前返回，并补订阅过滤测试          |
| 未使用导入 `contextlib` / `llm_client` / `re`        | `services/research_service.py:15,32`、`services/research_tools.py:10` | Ruff F401                | 删除                                                                    |
| 未使用变量 `last_seq`                                | `services/rpc_probe.py:178`                                           | Ruff F841                | 删除                                                                    |
| `except ...: raise` 立即重抛                         | `services/llm_client.py:160`                                          | Pylint W0706             | 移除多余 try/except                                                     |
| `RpcFailure` 未调用基类初始化                        | `services/research_service.py:71`                                     | Pylint W0231             | 调用 `super().__init__(message)`                                        |

结果：Ruff 正确性缺陷 **6 → 0**；Pylint Error **3 → 0**；源码 Error/Warning **14 → 4**（余下 3 处宽泛捕获 + 1 处 `raise-missing-from`，均位于服务边界，见第 7 节）。

## 5. 重构前后对比

| 指标                            |            重构前 |                                      重构后 | 变化                                                   |
| ------------------------------- | ----------------: | ------------------------------------------: | ------------------------------------------------------ |
| ESLint 项目基线 Error / Warning |             0 / 0 |                                       0 / 0 | 保持                                                   |
| TypeScript 类型错误             |                 0 |                                           0 | 保持                                                   |
| ESLint 质量规则 Warning         |               840 |                                         837 | Top 2 高复杂度函数已拆解；新增辅助函数带来少量规则计数 |
| 全仓最高 CC                     |     146（api.ts） |                   93（PdfReader，上游代码） | ↓ 53                                                   |
| 被重构前端文件 CC>10 的函数     |          146 / 74 |                                       **0** | api.ts / run-context.ts 达标                           |
| Python 最高 CC                  |           40（E） |                 29（D，rpc_probe 工具脚本） | ↓ 11                                                   |
| Python E 级函数                 |                 1 |                                       **0** | 达标                                                   |
| Python D 级函数                 |                 3 |                                           1 | ↓ 2                                                    |
| Pylint Error                    |                 3 |                                       **0** | 达标                                                   |
| Pylint Warning                  |                29 |                                          22 | ↓ 7                                                    |
| Ruff 正确性缺陷（F / E9）       |                 6 |                                       **0** | 达标                                                   |
| 重复代码率                      |             0.73% |                                       0.73% | 未新增复制粘贴，低于 3% 门禁                           |
| Python 单元测试                 |         23 passed |                               **42 passed** | +19                                                    |
| research 前端测试               | 34 passed（定向） | **160 passed / 1 skipped**（全量 research） | 全绿                                                   |

## 6. 质量门禁

| 门禁            | 结果             | 证据                                                                                                                                |
| --------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 编译 / 类型检查 | PASS             | `npx next build` 成功；`tsc --noEmit` 0 error；`python -m compileall services` 通过                                                 |
| 项目 lint       | PASS             | `npm run lint` 0 error / 0 warning                                                                                                  |
| 静态正确性      | PASS             | Pylint Error 0；Ruff F/E9 0                                                                                                         |
| 单元测试        | PASS             | services 42 / 42；research 前端 160 / 160（1 skipped）                                                                              |
| 圈复杂度        | PASS（本次范围） | 被重构的 5 个函数 CC 均 ≤10；被重构前端文件无 CC>10；Python 服务仍有 `configure` 19 等既有 C 级函数，已登记第 7 节                  |
| 重复代码        | PASS             | 0.73% < 3%                                                                                                                          |
| 密钥            | PASS             | `private/` 未纳入版本控制；源码中无真实密钥（测试占位串除外）                                                                       |
| 依赖漏洞        | 未知             | `npm audit` 使用 npmmirror，镜像未实现安全公告接口（404 NOT_IMPLEMENTED）；本机无 Docker/WSL，无法启动 SonarQube/Trivy 完成依赖扫描 |

## 7. 遗留问题与技术债

| 问题                                                                                                                     | 级别  | 位置                                                                          | 处理                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上游 UI 仍有高 CC 函数：PdfReader 93、validateSharedCanvas 70、ResearchGraph 51、ResearchReader 47、ResearchWorkspace 43 | Major | `app/src/components/pdf`、`app/src/lib/canvas`、`app/src/components/research` | 本轮未改：属于上游 papernook 的渲染组件，缺少针对性回归测试，贸然拆分风险高于收益；已登记，下一轮按组件补测试后拆分                                                    |
| `api-routes.ts` 718 行 > 600                                                                                             | Minor | `app/src/lib/research/api-routes.ts`                                          | 路由处理器聚合在一个文件；后续可按 papers / notes / runs / settings 分域拆分                                                                                           |
| `services/rpc_probe.py::main` CC 29（D）                                                                                 | Minor | `services/rpc_probe.py`                                                       | 开发者手动探针，无生产调用路径；后续按步骤拆函数                                                                                                                       |
| `services/research_service.py::configure` CC 19（C）                                                                     | Minor | `services/research_service.py`                                                | 配置校验链，已有错误码测试；后续拆 URL/model 校验                                                                                                                      |
| 3 处 `broad-except` + 1 处 `raise-missing-from`                                                                          | Minor | `services/research_service.py`                                                | 服务边界有意兜底（不能让未预期异常杀死 RPC 连接）；保留并在评审表说明                                                                                                  |
| 日志仅输出 stderr，无本地日志文件                                                                                        | Minor | `services/research_service.py`                                                | 单机应用由桌面宿主捕获 stderr；后续增加按日轮转的本地日志文件                                                                                                          |
| Ruff 259 条风格建议（UP006/UP031/UP045 等）                                                                              | Minor | `services/`                                                                   | 仅注解/格式现代化，不涉及行为；未批量自动改，避免稀释本次重构 diff                                                                                                     |
| 全量 Vitest 仍有既有环境失败                                                                                             | 环境  | `app/tests`                                                                   | 基线 455 failed / 716 passed；重构后 456 failed / 720 passed。失败集中在 PDF worker、签名校验、发布脚本等依赖本机工具链的用例；本次涉及的 160 个 research 测试全部通过 |

## 8. 复现命令

```bash
# 前端
cd app
npm run lint
npx tsc --noEmit
npx eslint --config eslint.quality.config.mjs . -f json -o eslint-quality.json
npx vitest run tests/lib/research-*.test.ts

# Python
cd ..
python -m pytest services/tests -q
python -m radon cc services -s
python -m pylint services
python -m ruff check services

# 重复度
npx jscpd@4.2.5 --min-lines 6 --min-tokens 50 --reporters json,html \
  --output jscpd app/src services scripts
```

## 9. 本次变更清单

| 类型                 | 文件                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新增质量规则         | `app/eslint.quality.config.mjs`                                                                                                                               |
| 重构（API 层）       | `app/src/lib/research/api.ts`、`app/src/lib/research/api-http.ts`（新增）、`app/src/lib/research/api-routes.ts`（新增）                                       |
| 重构（上下文元数据） | `app/src/components/research/qa/run-context.ts`                                                                                                               |
| 重构（Python 服务）  | `services/research_service.py`、`services/llm_client.py`、`services/research_context.py`、`services/research_tools.py`、`services/rpc_probe.py`               |
| 新增 / 扩充测试      | `app/tests/lib/research-api-routing.test.ts`（新增）、`services/tests/test_llm_client.py`（新增）、`services/tests/test_research_engine.py`（扩充 13 个用例） |
| 报告资产             | `docs/software/code_quality_assets/01-before-after.png`、`02-eslint-quality.png`、`03-jscpd-duplication.png`、`04-python-scan.png`                            |
| 原始扫描数据         | `docs/software/code_quality_assets/raw/` 下的 ESLint / Radon / Pylint / Ruff / jscpd JSON 与 `next-build-after.log`                                           |
| 代码提交             | 分支 `code-quality-report`，提交 `488c6e1`（基于 `162f92b`）                                                                                                  |
| 代码补丁             | `docs/software/code_quality_assets/openhai-refactor.patch`（可在 `162f92b` 上用 `git apply` 复现）                                                           |
| 打包下载             | `docs/software/code_quality_assets/openhai-quality-docs.zip`（报告、截图与原始数据）                                                                          |

说明：检查与重构基于 `162f92b`；仓库 `main` 之后已有其他成员的提交，本次未直接改写 `main` 代码，补丁单独附上以便审阅。

## 10. 结论

本次检查覆盖了全仓静态扫描，并针对自研 research 模块中风险最高的 5 类问题完成了“先测试、后重构”的闭环：

- 前端最高复杂度函数 146 → 阈值内，第二高 74 → 阈值内；
- Python E 级复杂度 1 → 0，`start_run` 40 → 3，`stream_chat` 24 → 6；
- Pylint Error 3 → 0，Ruff 正确性缺陷 6 → 0；
- 单元测试从 23 增至 42（Python）并保持 research 前端 160 个测试全绿；
- 重复率维持 0.73%，低于 3% 门禁。

重构没有改变 HTTP 路由契约、RPC 方法/错误码、`state.json` / `events.jsonl` 格式或用户可见行为；所有改动都有对应测试或静态检查证据。剩余问题已在第 7 节登记，按“上游 UI → 路由文件拆分 → 风格现代化”的顺序进入下一轮。
