# 教研阅记桌面端

这是教研阅记的 Electron 桌面入口，与浏览器版使用同一套 Web、PaperFlow、PostgreSQL、论文与笔记数据。桌面源码、运行依赖和桌面资料集中在本目录。

本仓库提供桌面源码与打包脚本，**不包含已构建的安装包**。可以按下文从源码运行，或自行生成 Windows x64 安装包。构建与分发步骤见 [安装与分发](安装与分发.md)。

## 首次配置与打开

1. 下载或 clone 完整仓库，按 [PostgreSQL 本机部署](../docs/PostgreSQL部署.md) 安装自己的 PostgreSQL、建立专用数据库，并配置父项目的 `private/postgres.env`。
2. 启动本机 PostgreSQL 服务和 Docker Desktop。AI 为可选配置，接口、模型 ID 与令牌由使用者填写在父项目的 `private/model.env`，私有文件只留在本机。
3. 双击本目录的 **`setup.cmd`**。脚本将官方便携 Node.js、Electron 和桌面依赖下载到本目录，不修改系统 PATH；首次安装需要联网。
4. 双击 **`launch.cmd`** 或 **`启动桌面版.cmd`**，也可使用父项目的 **`打开教研阅记.cmd`**。程序自动准备本项目后台并进入工作区；重复打开会回到已有窗口。

桌面端需要完整的父项目、本机 Docker Desktop 和已配置的 PostgreSQL。单独复制 `desktop/` 不能运行完整应用。桌面运行环境由 `setup.cmd` 安装，无需从 Electron 官网另行下载应用。

## 关闭与再次打开

直接关闭窗口，或选择“工作区 → 退出桌面版”，会自动停止所选项目的 Web 和 PaperFlow 容器。未保存的编辑会先提示确认，选择“继续编辑”可返回页面保存。启动中关闭会等待启动操作结束，再完成停止。

等待 **“正在退出教研阅记”** 窗口自动消失。已保存的论文、笔记与批注会保留，下次双击启动即可继续使用。同一工作区的浏览器页面会随后台停止而暂时离线。

系统安装的 PostgreSQL 服务与 Docker Desktop 继续运行。若使用者自行配备了完整的专用便携 PostgreSQL 环境，桌面端会同时停止该项目自带的数据库。普通 clone 使用宿主机数据库，无需创建 `.portable-project.json`。其他项目的容器不会随本项目退出而停止。

程序意外结束时，可运行父项目的 **`停止Demo.cmd`** 补充停止后台。外置盘使用者应在退出完成后通过 Windows“安全删除硬件”弹出磁盘；`准备拔盘.cmd` 作为便携部署的备用检查入口。

## 功能与数据

- 文献库、上传、阅读批注、回收站、研究笔记与 TeX 公式、学习复习、研究记忆、多文献关系、知识图谱和教育研究速递，沿用同一套页面与 API。
- 上传使用系统文件选择窗口；导出文件可选择保存位置，源码版默认目录为 `desktop/.local/downloads/`。论文和期刊外部链接交给系统浏览器打开。
- PDF 保存在父项目 `data/`，研究业务资料由 PostgreSQL 保存。模型和数据库私有配置保存在父项目 `private/`，桌面窗口不读取模型令牌。
- Electron 有独立的浏览器资料。浏览器版与桌面版的未提交草稿分别保存；切换前先保存草稿，已保存资料可以共用。

## 目录

```text
desktop/
├─ launch.cmd / 启动桌面版.cmd    日常启动入口
├─ setup.cmd                    安装或重新安装桌面依赖
├─ check.cmd                    显示安装与路径状态
├─ build-installer.cmd          自行构建 Windows 安装包
├─ package.json / package-lock.json
├─ src/                         窗口、启停连接与本地导航策略
├─ scripts/                     安装、启动、构建与验证脚本
├─ tests/                       导航、启停协调与容器归属检查
├─ 使用说明.html                可离线打开的源码版说明
├─ .tools/                      本目录专用便携 Node.js，安装时生成
├─ node_modules/                Electron 运行依赖，安装时生成
├─ .cache/                      下载、npm 缓存及安装临时文件
├─ dist/                        自行构建的安装包，不随源码分发
└─ .local/
   ├─ profile/ + session/        草稿、浏览器存储与缓存
   ├─ downloads/                默认导出目录
   ├─ logs/                     桌面日志
   ├─ tmp/ + crashes/           桌面运行临时文件
   └─ qa/                       运行验证后生成的结果和截图
```

`.tools/`、`node_modules/`、`.cache/`、`.local/`、`dist/` 已排除版本控制。浏览器 HTTP 磁盘缓存目标上限为 64MiB；页面内存、PDF 与草稿存储分别管理。Windows 和 Docker 自身的系统文件位置沿用其安装配置。

退出后可删除 `.cache/` 清理下载缓存；依赖已就绪时正常启动无需重新下载。`.local/profile/` 和 `.local/session/` 可能包含未提交草稿，`downloads/` 包含用户导出文件，请保留需要的内容。数据库和父项目 `data/`、`runtime/`、`private/` 应另行备份。

## 验证与故障处理

在本目录打开 PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\desktop.ps1 -Action Check
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\desktop.ps1 -Action Test
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\desktop.ps1 -Action Smoke
```

`Smoke` 打开实际工作区，检查 PDF、批注工具、笔记、研究记忆、复习和图谱等页面，保存本机验证结果后关闭桌面端。不调用模型或写入测试论文。运行前先关闭其他桌面窗口。

连接失败时使用“工作区 → 重新连接”，或运行父项目 `检查Demo.cmd`。服务启停日志位于父项目 `runtime/launcher/`，桌面日志位于 `.local/logs/`，最近退出状态位于 `.local/logs/exit-status.json`。停止失败时，退出窗口提供重试或返回工作区。分享错误信息前请移除论文内容、个人资料与凭据。

## 构建安装包

完成 `setup.cmd` 后，双击 `build-installer.cmd`。安装包和 SHA256 校验文件生成在 `dist/`，版本号来自 `package.json`。构建不会自动上传安装包。

打包使用明确文件白名单，仅包含桌面程序、应用元数据、图标、说明与许可，排除业务数据、模型配置和本机运行记录。安装版仍需接收者自行部署完整后台。安装版桌面资料位于安装文件夹旁的 `JiaoyanDesktopData`；源码版使用 `.local/`。

固定工具版本见 `package.json`、锁文件与安装脚本。技术依据：[Electron 接入指南](https://www.electronjs.org/docs/latest/tutorial/tutorial-first-app)、[进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)、[运行路径](https://www.electronjs.org/docs/latest/api/app)、[Node.js 官方发行文件](https://nodejs.org/dist/)。
