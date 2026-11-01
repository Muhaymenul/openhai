# 教研阅记 · openhai

基于 [Papernook](https://github.com/affromero/papernook) 与 [PaperFlow](https://github.com/weijian-ai/PaperFlow) 整合的本机论文研究应用。下载或 clone 本仓库后，通过 Docker 在自己的电脑部署，浏览器入口为 `/workspace`。

论文、批注、笔记和研究记录保存在本机。AI 分析使用你自行配置的 OpenAI 兼容接口及额度；模型服务的收费与使用限制以服务商为准。
## 可以做什么

- 导入 PDF，管理题名、作者、标签和阅读进度，进行全文检索。
- 阅读、划线、写评论，将批注整理成可编辑笔记，导出带批注 PDF。
- 选择论文、选文、批注或笔记，让阅读助手解释内容、生成精读卡或逐题自测。
- 保存笔记版本、复习进度和研究待办，导出 Markdown、图谱、成果 ZIP 与日历提醒。
- 在知识图谱中核对概念关系及原文证据，再确认或拒绝候选关系。

阅读、人工批注、笔记编辑、样例导入与本地检索不需要模型令牌。AI 功能会把所选材料发送给你配置的模型服务，输出需要人工核对。带文字层的 PDF 可建立全文索引。

完整操作指南见 [使用说明](docs/使用说明.md)，技术与目录说明见 [上游来源与整合说明](UPSTREAM.md)。

## 课程项目文档

| 内容 | 文档 |
| --- | --- |
| 5W1H 与产品描述 | [问题定义](docs/requirements/problem_definition.md) |
| 功能、质量要求与验收 | [功能规格](docs/requirements/functional_spec.md) · [非功能规格](docs/requirements/nonfunctional_spec.md) · [用户故事](docs/requirements/user_stories.md) |
| 算法与选型依据 | [技术调研](docs/algorithm/research.md) |
| 架构与部署关系 | [软件架构](docs/software/architecture.md) |
| 实际验证环境与结果 | [发布验收记录](docs/software/validation.md) |
| 里程碑与分工 | [团队计划](docs/mgmt/plan.md) · [任务看板](docs/mgmt/kanban.md) |
| 首周实践回顾 | [回顾记录](docs/retrospection/week1.md) |

课程模板的 `code/frontend`、`code/backend`、`code/core_engine` 分别对应本仓库的 `app/`、`services/` 和 `services/paperflow/`。源码沿用上游工程边界，按根目录 Compose 完整构建。稳定版本位于 `main`，后续迭代使用 `develop`；反馈入口是 [验收 Issue #6](https://github.com/Muhaymenul/openhai/issues/6)，发布任务归入 [v0.1 里程碑](https://github.com/Muhaymenul/openhai/milestone/1)。

## 准备环境

安装带 **Docker Compose v2** 的 Docker。Windows 和 macOS 可使用 Docker Desktop；Windows 请启用 WSL2 和 Linux 容器。Linux 可使用本机 Docker Engine 与 Compose 插件。建议给 Docker 分配 8 GB 内存，并预留至少 10 GB 可用磁盘。

首次构建需要联网获取基础镜像和开源依赖，可能需要数分钟。宿主机无需另装 Node.js、Python 或数据库服务器。
## Windows：clone 或下载 ZIP

有 Git 时，在准备保存项目的目录运行：

```powershell
git clone https://github.com/Muhaymenul/openhai.git
cd openhai
```

也可以打开 [仓库页面](https://github.com/Muhaymenul/openhai)，选择 **Code → Download ZIP**，将 ZIP 完整解压到自己的目录，再打开解压后的项目文件夹。不要直接在 ZIP 内运行程序。

1. 启动 Docker Desktop，等待引擎就绪。
2. 在项目文件夹打开 PowerShell，运行以下命令，创建数据目录和空白配置。重复执行会保留已有配置。

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
   notepad .\private\model.env
   ```

3. 如需 AI，按下节填写自己的接口、模型 ID 和令牌并保存；暂时留空也能使用本地阅读功能。
4. 双击项目根目录中的 **`启动Demo.cmd`**。首次自动构建，之后已有镜像时直接启动。浏览器打开 [本机工作区](http://127.0.0.1:3000/workspace)。

停止使用 **`停止Demo.cmd`**，查看状态使用 **`检查Demo.cmd`**。停止会保留资料。启动日志位于 `runtime/launcher/`；遇到错误可先查看日志或运行 `docker compose logs --tail 50 web paperflow`。

## Linux / macOS

clone 或解压后，在项目根目录运行：

```sh
sh scripts/setup.sh
# 用自己的文本编辑器填写 private/model.env；暂不使用 AI 可保留空值。
sh start.sh
```

启动脚本会检查本机 Docker，已有本项目镜像时直接启动，缺少镜像时自动构建。按终端显示的地址打开工作区。停止时运行：

```sh
sh stop.sh
```

## 首次接入自己的 AI

真正的模型配置文件是 **`private/model.env`**。它由 `private.example.env` 复制生成，不进入 Git。页面“任务与设置 → 设置”目前显示服务和模型状态，令牌应在本地文件中填写。

```dotenv
PAPERFLOW_LLM_PROVIDER=openai
PAPERFLOW_LLM_BASE_URL=
PAPERFLOW_LLM_DEFAULT_MODEL=
PAPERFLOW_LLM_API_KEY=
```

发布模板中的接口地址、模型 ID 和令牌均为空。请在这三行等号后分别填写服务商提供的接口根地址、可用的模型 ID 和你自己的令牌；三项齐全后才启用 AI。Base URL 是 OpenAI 兼容接口的根地址，通常包含 `/v1`；不要填网页聊天地址，也不要追加 `/chat/completions`。模型 ID 必须与服务商支持的名称完全一致。

修改后重新加载研究服务：

```sh
docker compose restart paperflow
```

再刷新设置页检查状态。“已配置”表示已加载接口地址、模型 ID 和令牌三项配置；成功回答一次问题后即可确认连接可用。若曾通过配置接口保存过设置，`runtime/research/provider.json` 会优先覆盖文件配置；该文件也可能包含令牌，应自行保管。新安装不需要此文件。

## 端口与手动启动

默认只监听本机 `127.0.0.1:3000`。如果端口被其他应用占用，在根目录 `.env` 中修改：

```dotenv
RESEARCH_WEB_PORT=3001
```

随后重新运行启动脚本，访问 `http://127.0.0.1:3001/workspace`。不要修改容器内部的 3000 端口。Compose 项目名为 `openhai-jiaoyan`，与旧版演示项目分开；旧项目占用 3000 时可为本项目选择其他端口。

也可以绕过启动脚本，手动运行 Compose。先执行对应系统的 `scripts/setup.ps1` 或 `sh scripts/setup.sh`，填写私有配置，再运行：

```sh
docker compose build --builder default
docker compose up -d --no-build
docker compose ps
docker compose logs --tail 50 web paperflow
# 停止并保留数据
docker compose stop
```

## 更新、备份与恢复

更新前先保存笔记、PDF 批注和作答，并备份资料。Git 用户在项目根目录执行 `git pull --ff-only`；ZIP 用户请将新版解压到新目录，并迁移自己保管的 `data/`、`runtime/`、`private/` 和 `.env`。然后在 Windows 双击 **`重新构建.cmd`**，或运行：

```sh
docker compose build --builder default
docker compose up -d --no-build
```

Windows 的 **`备份Demo.cmd`** 会暂时停止本项目，备份 `data/` 与 `runtime/`，然后重新启动；ZIP 保存在 `backups/`。**`恢复备份.cmd`** 接受这种完整备份，并在替换前保留现有目录。备份排除 `private/model.env`、`provider.json` 与环境配置，请另行安全保管这些私有设置。

Linux / macOS 可先运行 `sh stop.sh`，再将 `data/` 和 `runtime/` 复制或归档到自己选择的备份位置；其中 `provider.json` 可能含令牌，分享备份前应排除它。还原前停止服务并另存现有目录，再将备份放回对应位置，最后运行 `sh start.sh`。网页“成果 ZIP”用于导出研究成果，不代替包含 Python 会话的完整服务备份。浏览器中尚未提交的作答草稿不在备份内。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| `app/` | Papernook Web 应用与中文研究工作区，构建入口 `Dockerfile.research` |
| `services/` | Python 研究服务及内置的 PaperFlow 核心源码 |
| `examples/` | 三份原创合成测试 PDF，供“导入示例论文”使用 |
| `docs/使用说明.md` | 阅读、批注、笔记、复习、图谱和待办操作说明 |
| `scripts/` | 初始化、Windows 管理、备份恢复及验证脚本 |
| `data/` | 首次运行生成的 PDF、元数据、笔记、图谱、复习记录与 SQLite 索引 |
| `runtime/` | 首次运行生成的任务会话、事件和启动日志 |
| `private/model.env` | 自备的模型配置，启动时读取，不随源码分发 |

数据以本机文件为事实来源，SQLite 是可重建的检索索引。删除源码前请自行保留数据和私有配置。

## 来源与反馈

本仓库是面向个人教研阅读的整合版本。原项目作者、固定提交、各部分许可及字体和画作来源见 [UPSTREAM.md](UPSTREAM.md)、[来源与许可](THIRD_PARTY_NOTICES.md)、`app/LICENSE` 与 `services/paperflow/LICENSE`。第三方组件继续遵守各自许可证。

遇到部署或使用问题，请到 [Issues](https://github.com/Muhaymenul/openhai/issues) 提交系统、Docker 版本、操作步骤与已去除隐私的错误信息。
