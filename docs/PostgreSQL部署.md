# PostgreSQL 本机部署

教研阅记使用 PostgreSQL 保存研究工作区状态与全文索引，PDF 保存为项目文件。公共源码使用 **宿主机 PostgreSQL + Docker Web / PaperFlow 双服务**。本仓库不附带开发者的数据库、数据库密码或 PostgreSQL 程序目录。

## 1. 安装自己的 PostgreSQL

安装 [PostgreSQL 17 或 18](https://www.postgresql.org/download/)，包含服务器和 `psql`、`pg_dump`、`pg_restore` 客户端。记录自己的安装目录、实际端口和管理员密码，并启动数据库服务。

Windows 管理脚本通过 PATH 或数据库服务位置查找客户端；工具未被自动发现时，在当前 PowerShell 中设置实际的 `bin` 路径，再从同一终端运行脚本。例如以下路径需按自己的安装位置修改：

```powershell
$env:RESEARCH_POSTGRES_BIN = 'C:\Program Files\PostgreSQL\18\bin'
```

安装数据库时设置的管理员密码只用于本机管理。应用使用下面创建的专用账户。

## 2. 首次创建专用账户和数据库

在 PostgreSQL 的 SQL Shell（psql）中，以安装时的管理员连接默认 `postgres` 数据库；也可在已配置工具目录的 PowerShell 中运行：

```powershell
& "$env:RESEARCH_POSTGRES_BIN\psql.exe" --host=127.0.0.1 --port=5432 --username=postgres --dbname=postgres
```

端口按实际安装值修改。输入自己的管理员密码后，**首次部署**执行：

```sql
CREATE ROLE jiaoyan LOGIN;
\password jiaoyan
CREATE DATABASE jiaoyan OWNER jiaoyan;
\quit
```

`\password` 会交互提示输入并确认新的专用账户密码。请将自己设置的这个密码填入下一节的私有文件。已有 `jiaoyan` 数据库的升级用户继续使用原库和对应账户；升级前先备份。

Web 首次连接时由 [schema.ts](../app/src/lib/research/postgres/schema.ts) 自动创建业务表、索引与迁移标记。专用账户作为专用数据库的所有者，能够创建自身表和索引，日常运行无需 PostgreSQL 超级用户权限。当前全文检索使用内置文本检索能力，无需另装向量数据库扩展。

## 3. 创建本机连接配置

在项目根目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
notepad .\private\postgres.env
```

初始化从 [空白数据库模板](../private.postgres.example.env) 生成 `private/postgres.env`，重复运行保留现有文件。填写以下字段：

```dotenv
RESEARCH_DATABASE_HOST=host.docker.internal
RESEARCH_DATABASE_PORT=5432
RESEARCH_DATABASE_NAME=jiaoyan
RESEARCH_DATABASE_USER=jiaoyan
RESEARCH_DATABASE_PASSWORD=
```

最后一行等号后填写自己在 `\password jiaoyan` 中设置的密码。数据库名和账户保持 `jiaoyan`，管理脚本将备份、恢复限制在这套专用数据库中。数据库端口与实际安装保持一致。

| 配置 | 用途 |
| --- | --- |
| `host.docker.internal` | Web 容器访问宿主机 PostgreSQL 的地址 |
| `127.0.0.1` | Windows 管理脚本在宿主机检查与备份数据库的地址 |
| `private/postgres.env` | Web 与本机管理脚本共用的私有连接配置 |
| `private/model.env` | 用户自行填写的模型接口、模型 ID 与令牌 |

私有文件与数据库备份在本机保管，分享源码时仅提供空白模板。修改数据库配置后，重新创建 Web 容器以载入环境：

```sh
docker compose up -d --force-recreate web
```

## 4. 本机监听与 Docker 连接

本项目按个人电脑部署，数据库保留本机访问和密码认证。PostgreSQL 的 `postgresql.conf` 默认可使用 `listen_addresses = 'localhost'`；应用网页只发布到 `127.0.0.1`。Docker Desktop 使用 `host.docker.internal` 连接宿主机。

`pg_hba.conf` 需允许专用账户连接自己的数据库，例如本机连接规则为：

```text
host    jiaoyan    jiaoyan    127.0.0.1/32    scram-sha-256
host    jiaoyan    jiaoyan    ::1/128         scram-sha-256
```

安装器通常已提供本机认证规则，先使用现有规则连接。若宿主机检查成功而 Web 日志提示连接被拒绝，检查 Docker Desktop 的宿主机连接、数据库日志和 Windows 防火墙。若日志提示某个 Docker / WSL 来源地址未获认证，仅对实际来源地址和专用库、专用账户添加 `scram-sha-256` 规则，并重载 PostgreSQL 配置。保持密码验证，不添加 `trust` 或覆盖所有来源的允许规则。

Linux Docker Engine 的 `host.docker.internal` 可能需要在 Web 服务增加 `host-gateway` 映射；其宿主机网络和 PostgreSQL 监听方式应由使用者按本机 Docker 网络配置。Windows / Docker Desktop 的本机路线是本仓库主要开发环境；其他系统需在自己的电脑完成数据库连通验证。

## 5. 启动与退出

1. 启动自己的 PostgreSQL 数据库服务和 Docker Desktop。
2. 填写 `private/postgres.env`；AI 为可选配置。
3. 双击 `启动Demo.cmd`，或在当前已配置工具目录的 PowerShell 中运行：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage.ps1 -Action start
   ```

4. 打开 `http://127.0.0.1:3000/workspace`。运行 `检查Demo.cmd` 查看数据库与应用状态。

普通部署停止应用或关闭新版桌面端时，只停止本项目容器。宿主机 PostgreSQL 是可供其他应用共用的系统服务，继续运行。便携项目另有独立的 PostgreSQL 管理脚本；只有使用者主动配备完整的专用便携环境时，才随该项目启动或停止。公共 clone 无需放置 `.portable-project.json`。

## 6. 数据与检索

| 位置 | 保存内容 |
| --- | --- |
| PostgreSQL `jiaoyan` | 论文信息、逐页正文、笔记及版本、批注记录、概念、图谱、复习、待办、研究记忆与 Web 研究任务 |
| PostgreSQL 全文索引 | `tsvector` / GIN 索引、相关度排序；补充中英文原文匹配 |
| PostgreSQL 速递表 | 教育期刊目录、导读缓存和待读标记 |
| `data/papers/` | PDF 与已写回的标准 PDF 批注 |
| `data/library/` | 派生文本、内容版本及兼容文件 |
| `runtime/research/` | Python / PaperFlow 任务会话和事件 |

旧文件工作区首次导入后写入迁移标记，后续研究工作区读写走 PostgreSQL。迁移前的 JSON / SQLite 资料可保留用于回退；更新和恢复时保持 PDF 与数据库快照对应。

## 7. 备份与恢复

Windows 的 `备份Demo.cmd` 暂停 Web 和 PaperFlow，使用 `pg_dump` 生成自定义格式逻辑备份 `postgresql.dump`，连同 `data/` 与 `runtime/` 打包到 `backups/`，再启动应用。`恢复备份.cmd` 校验 ZIP 和文件清单，先保留当前数据库及文件，再通过事务化 `pg_restore` 恢复。

其他系统可在应用停止后执行针对专用数据库的 `pg_dump --format=custom`，并归档对应文件目录；恢复使用相应 PostgreSQL 客户端。数据库客户端应与服务器主版本兼容，备份后保留可用的恢复工具。

模型与数据库私有配置、可能含令牌的 `provider.json` 单独安全保管。浏览器未提交的草稿保留在该浏览器；网页“成果 ZIP”保存可见成果，完整服务恢复还需要数据库与 Python 会话。

## 8. 检查连接

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\postgres.ps1 -Action check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage.ps1 -Action status
```

常见提示及处理：

- **缺少 `private/postgres.env` 或密码**：运行初始化脚本，填写自己的专用账户配置。
- **客户端工具缺失**：设置实际 `RESEARCH_POSTGRES_BIN`，在同一终端重试。
- **密码认证失败**：核对 `jiaoyan` 账户密码、端口和本机认证规则。
- **宿主机可连、容器无法连接**：检查 `host.docker.internal`、Docker / WSL 来源规则和防火墙。
- **表创建权限不足**：确认专用 `jiaoyan` 数据库由 `jiaoyan` 角色拥有。

本页根据当前实现整理配置步骤。新电脑的实际 PostgreSQL 安装、Docker 网络及首次构建仍需在该电脑执行连接检查；历史验收结果保留在 [验收记录](software/validation.md) 的原日期下。