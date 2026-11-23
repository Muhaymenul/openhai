# 教研阅记 · openhai

基于 [Papernook](https://github.com/affromero/papernook) 与 [PaperFlow](https://github.com/weijian-ai/PaperFlow) 整合的本机论文研究应用。当前版本使用 **PostgreSQL 保存研究业务数据**，Docker Compose 运行 Web 与研究服务，支持浏览器和 Windows Electron 桌面入口。

论文、批注、笔记与研究记忆由使用者在自己的电脑保存。仓库提供程序源码、配置模板与原创合成示例；首次部署建立自己的数据库，AI 功能接入自己的 OpenAI 兼容模型接口。模型服务的使用额度由对应服务商提供。

## 可以做什么

- **文献与阅读**：导入 PDF，提取逐页原文，管理题名、作者、标签和进度；上传时可按需调用模型提取文献信息。
- **批注与笔记**：选文高亮、评论、原文回跳、批注整理成笔记；Markdown 编辑、TeX 数学公式、版本历史与带批注 PDF 导出。
- **阅读助手与复习**：围绕整篇、选文、批注或笔记解释概念、分析方法与证据，生成精读卡和逐题自测；保留对话及复习进度。
- **研究记忆**：建立课题，保存目标、关键认识、决定、待解决问题与回复偏好，跨会话召回相关内容；保留来源及版本信息。
- **多文献关系与知识图谱**：选择 2–4 篇论文比较研究对象、方法、发现和条件；核对双方原文，确认关系候选，按课题或年份筛选，查看时间线、合并概念与导出成果。
- **教育研究速递**：浏览四种教育学期刊近 7 天或 30 天的在线发表目录，查看原摘要、生成中文导读、加入待读并访问 DOI 原文；目录和导读缓存在 PostgreSQL。
- **成果与待办**：导出 Markdown、带批注 PDF、图谱及成果 ZIP；管理研究待办，导出 ICS 日历提醒。
- **首页与桌面**：《雅典学院》画作可完整查看、缩放和平移；桌面入口自动启动本项目，关闭窗口后停止本项目后台，保留未保存内容确认。

本地阅读、人工批注、笔记编辑、样例导入与全文检索不需要模型令牌。AI 操作使用明确选择的材料；答案、笔记与关系候选可回看原文核对。文字 PDF 支持原文提取；扫描件可阅读和批注，当前版本不自动 OCR。

操作说明见 [使用说明](docs/使用说明.md) 和 [研究记忆与文献关系](docs/研究记忆与文献关系.md)。

## 准备环境

以下快速开始以 **Windows x64** 为主：

1. 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)，启用 WSL2 / Linux 容器和 Docker Compose v2。
2. 安装 [PostgreSQL 17 或 18](https://www.postgresql.org/download/)，包含 `psql`、`pg_dump`、`pg_restore` 命令行工具。记录自己的安装目录、端口和管理员密码。
3. 为本项目创建专用数据库与账户 `jiaoyan`，按 [PostgreSQL 部署](docs/PostgreSQL部署.md) 完成连接配置。

Web 镜像自带 Node.js、Python 和 PDF 工具，宿主机无需另外安装这些应用依赖。首次构建需要联网下载镜像和开源依赖，并预留构建空间。桌面端为可选入口，后文说明其独立初始化方式。

## Windows：clone 或下载 ZIP

```powershell
git clone https://github.com/Muhaymenul/openhai.git
cd openhai
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

也可从 [仓库页面](https://github.com/Muhaymenul/openhai) 选择 **Code → Download ZIP**，完整解压后在项目文件夹运行初始化命令。重复初始化会保留现有私有配置。

初始化后：

1. 按 [数据库配置步骤](docs/PostgreSQL部署.md) 创建专用数据库，并编辑 `private/postgres.env`，填写自己的数据库端口与密码。
2. 如需 AI，编辑 `private/model.env`，填写自己的接口地址、模型 ID 与令牌；暂时留空也可使用本地阅读功能。
3. 启动 PostgreSQL 与 Docker Desktop，然后双击根目录 **`启动Demo.cmd`**。首次构建完成后，浏览器打开 [本机工作区](http://127.0.0.1:3000/workspace)。
4. 使用 **`检查Demo.cmd`** 查看数据库及服务状态；使用 **`停止Demo.cmd`** 停止本项目容器；更新源码后使用 **`重新构建.cmd`**。

停止容器会保留资料。普通安装的 PostgreSQL 系统服务继续运行，供其他应用共用。启动日志保存在 `runtime/launcher/`。

## Windows 桌面入口

完成上述数据库和后台环境配置后，双击 `desktop/setup.cmd`。它将固定版本的便携 Node.js、Electron 和依赖下载到 `desktop/`，无需单独从 Electron 官网安装程序。随后双击根目录 **`打开教研阅记.cmd`**，或 `desktop/launch.cmd`。

关闭窗口或选择“工作区 → 退出桌面版”，会先确认未保存内容，再自动停止本项目后台；等待“正在退出教研阅记”窗口消失即可。重复打开会回到已有窗口。Docker Desktop 本身保持运行；普通安装的 PostgreSQL 系统服务继续运行。便携部署若另行配备本项目专用 PostgreSQL，则由便携启动器一并停止。

桌面源码版本为 `0.1.2`。仓库发布源码和打包脚本；可通过 `desktop/build-installer.cmd` 在本机生成安装包。桌面入口仍依赖完整父项目、Docker 和 PostgreSQL。详细内容见 [桌面说明](desktop/README.md)。

## 首次接入自己的 AI

`private/model.env` 由空白模板 `private.example.env` 生成，使用以下字段：

```dotenv
PAPERFLOW_LLM_PROVIDER=openai
PAPERFLOW_LLM_BASE_URL=
PAPERFLOW_LLM_DEFAULT_MODEL=
PAPERFLOW_LLM_API_KEY=
```

填写服务商提供的接口根地址、可用模型 ID 和自己的令牌。Base URL 通常包含 `/v1`，应填写 API 根地址。保存后重启研究服务：

```sh
docker compose restart paperflow
```

刷新“任务与设置 → 设置”查看状态，再发送一个简单问题确认连接。曾经通过配置接口保存设置时，`runtime/research/provider.json` 可能优先提供配置，也应在本机保管。

**`private/`、`.env`、数据库文件、个人论文、笔记、会话、浏览器草稿与备份均不进入仓库。** 他人 clone 后使用自己的配置与资料。

## 手动启动与其他系统

数据库就绪并完成本地配置后，可在项目根目录直接运行：

```sh
docker compose build --builder default
docker compose up -d --no-build
docker compose ps
docker compose logs --tail 50 web paperflow
# 停止容器并保留资料
docker compose stop
```

Linux / macOS 可使用 `sh scripts/setup.sh` 初始化模板，再填写数据库和模型配置，通过 `sh start.sh` / `sh stop.sh` 管理容器。需自行安装 PostgreSQL，并确认 Web 容器能够连接宿主机数据库；Docker Engine 的主机映射、数据库监听及认证配置见 [PostgreSQL 部署](docs/PostgreSQL部署.md)。Windows 桌面脚本和安装包面向 Windows；macOS / Linux 桌面端尚未提供对应打包入口。

浏览器默认入口为 `127.0.0.1:3000`。浏览器部署可在 `.env` 中设置 `RESEARCH_WEB_PORT=3001`，再通过 `http://127.0.0.1:3001/workspace` 访问。当前桌面入口使用固定的 `3000` 端口；运行桌面版时请保留默认端口并关闭占用该端口的另一份 demo。

## 更新、备份与恢复

更新前先保存笔记、PDF 批注和作答，并执行完整备份。Git 用户在项目目录运行 `git pull --ff-only`，随后使用 **`重新构建.cmd`** 或手动重建镜像。ZIP 用户将新版解压到新目录，再迁移自己保管的 `data/`、`runtime/`、`private/` 与 `.env`，并继续连接原有的专用数据库。

Windows 的 **`备份Demo.cmd`** 暂停应用容器，通过 `pg_dump` 生成数据库逻辑备份 `postgresql.dump`，与 `data/`、`runtime/` 一起打包至 `backups/`，然后重新启动应用。**`恢复备份.cmd`** 校验完整备份，并在恢复前保留当前数据库和文件。数据库与模型配置、可能含令牌的 `provider.json` 需要单独安全保管。

其他系统可停止应用容器，使用 `pg_dump --format=custom` 备份专用 `jiaoyan` 数据库，并保存对应的 `data/` 与 `runtime/`。恢复时须保持数据库快照与 PDF 文件对应。网页“成果 ZIP”用于分享研究成果；完整服务恢复还需要数据库与研究会话。未提交的浏览器草稿保存在该浏览器中。

## 项目结构与架构

| 路径或组件 | 内容 |
| --- | --- |
| `app/` | Next.js 工作区、API、PDF 阅读、笔记、图谱及 PostgreSQL 访问 |
| `services/` | Python 研究 RPC、元数据抽取及内置 PaperFlow 智能体核心 |
| `desktop/` | Electron 源码、初始化、测试与 Windows 打包脚本 |
| PostgreSQL `jiaoyan` | 论文信息、逐页正文、笔记版本、批注、图谱、复习、研究记忆、任务与全文检索 |
| `data/` | 首次运行生成的 PDF、派生文本与兼容文件 |
| `runtime/` | 首次运行生成的研究任务、会话、事件与日志 |
| `private/model.env`、`private/postgres.env` | 使用者自行配置的本地模型与数据库连接 |
| `examples/` | 原创合成测试 PDF，可从页面导入 |
| `docs/` | 使用说明、需求、算法、架构及课程项目管理 |

PostgreSQL 保存当前研究工作区状态，PDF 保留为本机文件。Web 首次连接专用数据库时自动创建所需表和索引。原有工作区文件导入后记录迁移标记；迁移前的兼容文件仍可保留。

## 课程项目文档

| 内容 | 文档 |
| --- | --- |
| 5W1H 与产品描述 | [问题定义](docs/requirements/problem_definition.md) |
| 功能、质量要求与验收 | [功能规格](docs/requirements/functional_spec.md) · [非功能规格](docs/requirements/nonfunctional_spec.md) · [用户故事](docs/requirements/user_stories.md) |
| 算法与选型依据 | [技术调研](docs/algorithm/research.md) |
| 架构与部署关系 | [软件架构](docs/software/architecture.md) |
| 历史验证环境与结果 | [验收记录](docs/software/validation.md) |
| 里程碑与分工 | [团队计划](docs/mgmt/plan.md) · [任务看板](docs/mgmt/kanban.md) |
| 首周实践回顾 | [回顾记录](docs/retrospection/week1.md) |

课程模板的 `code/frontend`、`code/backend`、`code/core_engine` 对应本仓库的 `app/`、`services/` 和 `services/paperflow/`。历史验收记录保留其原日期和当时版本；当前实现与部署关系以本页和架构文档为准。

## 来源与反馈

原项目作者、固定提交、各部分许可、字体和画作来源见 [UPSTREAM.md](UPSTREAM.md)、[来源与许可](THIRD_PARTY_NOTICES.md)、`app/LICENSE` 与 `services/paperflow/LICENSE`。第三方组件继续遵守各自许可证。

遇到问题，请到 [Issues](https://github.com/Muhaymenul/openhai/issues) 提交系统、Docker / PostgreSQL 版本、操作步骤及已去除隐私的错误信息。