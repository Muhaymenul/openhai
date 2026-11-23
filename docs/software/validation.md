# 发布验收记录

日期：2026-11-02。验收对象为本仓库的本机部署版，使用新建数据目录和空白模型配置。

## 环境与构建

| 项目 | 实际环境与结果 |
| --- | --- |
| 宿主机 | Windows，Docker Desktop 的本机 Linux 引擎 |
| 网页运行环境 | Node.js 22，镜像内构建原生 SQLite 依赖 |
| 研究服务 | Python 3.12，按 `services/requirements.lock` 安装 |
| 部署 | 根目录 Compose 构建两个镜像；独立项目在 127.0.0.1:3001 启动，研究服务健康 |
| 初始化 | Windows PowerShell 和 Linux shell 均验证重复执行保留现有模型配置 |
| 平台覆盖 | 已实测 Windows 宿主机与 Linux 容器；macOS 的部署步骤尚待独立电脑试用 |

## 自动检查

| 命令或范围 | 结果 |
| --- | --- |
| `cd app && npm run ci` | ESLint、Prettier、TypeScript、全部 Vitest 与生产构建通过；154 个测试文件通过，2 个文件跳过；1,171 项测试通过，5 项跳过 |
| Python 研究服务测试 | 24 项通过，使用模拟模型 provider |
| Shell 入口 | `start.sh`、`stop.sh`、`scripts/setup.sh` 及上游运行脚本语法通过 |
| 源码完整性 | 补齐并核对 PaperFlow 工具模块与上游运行脚本，实际构建和启动验证导入关系 |
| 发布内容检查 | `python scripts/check-release.py` 检查 Git 跟踪内容，拒绝凭据、私有目录、运行缓存及超大文件 |

Python 测试在容器内运行：

```sh
pip install -r services/requirements.lock pytest pytest-asyncio
pip install --no-deps -e services/paperflow
pytest -q services/tests
```

GitHub Actions 对 `main`、`develop` 和 Pull Request 执行发布检查、研究服务测试及 Web 完整检查。

## 全新数据功能验收

通过 HTTP 对独立测试实例执行以下 10 组检查，均通过：

| 功能 | 检查结果 |
| --- | --- |
| 首次打开 | 文献、笔记与批注为空，4 个内置概念和本地索引可用 |
| 自备模型配置 | 空白地址、模型与令牌使 `configured` 为 false，不返回令牌 |
| 样例导入 | 3 份原创合成 PDF 导入成功，重复导入不复制文献 |
| 阅读资料 | PDF、文字页、第一页 PNG 封面及文件 ETag 正常返回 |
| 笔记 | 创建、幂等提交、编辑、版本冲突、历史与全文检索通过 |
| 高亮与评论 | 写回 PDF、重复提交、过期 ETag 拒绝、编辑、清空评论、删除及删除后重试通过 |
| 知识图谱 | 本地候选生成、确认、拒绝与重新生成后保留判断通过 |
| 文献回收站 | 删除后隐藏关联内容，恢复后保留原有记录 |
| 导出 | Markdown 与有效成果 ZIP 返回；ZIP 排除模型配置 |
| 网页入口 | `/workspace` 正常响应 |

本轮未调用真实模型接口。使用者填写自己的配置后，可按 README 发送一个简单问题进行连接验收。当前笔记支持创建、编辑与历史，删除及恢复列入 [Issue #8](https://github.com/Muhaymenul/openhai/issues/8)。

## Windows 全量备份与恢复

实际执行 `scripts/manage.ps1 backup` 与 `restore`，生成 398,103 字节的完整备份，27 个文件全部通过 SHA-256 清单和 ZIP 完整性校验。备份排除模型私有配置。恢复后的 3 篇样例、2 条笔记、4 个概念、9 个图谱节点、21 条边与恢复前逐项一致。备份和成功恢复后自动清理临时展开目录，恢复前的资料保留在 `backups/before-restore-*`。

## 后续验收

首轮 3–5 人试用、其他电脑的 Docker 下载环境及真实模型连接在 [Issue #7](https://github.com/Muhaymenul/openhai/issues/7) 记录；整体交付由 [Issue #6](https://github.com/Muhaymenul/openhai/issues/6) 跟踪。

## 2026-11-24 最新源码发布检查

本轮从最新开发目录整理公开源码，保留仓库已有课程文档。发布内容使用用户自备的 PostgreSQL 与模型配置；个人论文、笔记、数据库、会话、浏览器资料、凭据和本机验收截图均排除。

| 检查 | 本轮结果 |
| --- | --- |
| Web 静态检查 | ESLint、Prettier、TypeScript 通过 |
| Web 单元/行为测试 | 167 个文件，1286 项通过；5 项按既有环境配置跳过 |
| Web 生产构建 | `npm run build` 通过，独立运行产物及其内容检查通过 |
| PostgreSQL 集成 | 全新隔离 PostgreSQL 18 数据库，3 个文件、15 项通过 |
| Python 研究服务 | 58 项及 15 个子测试通过 |
| 桌面端 | 14 项通过，包括退出协调与 Windows PowerShell 5 容器归属模拟检查 |
| 发布和初始化 | 文件排除、凭据模式与本机凭据值对照、空白模板、重复初始化保留配置、PowerShell/sh 语法及 Compose 配置通过 |

检查使用隔离环境和合成数据，没有调用真实模型。Web 检查复用与锁文件一致的既有依赖缓存；测试中调整了格式、未使用类型导入和中文按钮的过期断言。仓库 CI 增加 PostgreSQL 集成与 Windows 桌面检查。上方旧日期记录保留为对应版本的历史结果。
随后按根目录 Compose 构建实际部署镜像并连接隔离空库，导入 3 份原创合成示例。Electron 实际验证首页、导入表单、PDF 画布和可选文字、批注工具、笔记、研究记忆、复习、图谱与 PDF/JSON 导出；检查前后资料数量一致。关闭桌面后，本项目容器全部停止，外部系统 PostgreSQL 保持运行，符合普通部署行为。
