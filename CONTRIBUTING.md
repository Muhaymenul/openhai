# 参与开发

`main` 保存可部署版本，`develop` 汇集下一轮改进。新功能使用 `feature/功能名`，修复使用 `fix/问题名`，通过 Pull Request 合入。

1. 在 Issues 中说明用户场景、预期结果和验收步骤。
2. 从 `develop` 建立工作分支，保持改动聚焦。
3. 修改功能时同步更新使用说明与相关测试。
4. 提交前运行 `python scripts/check-release.py`，并完成 Web 与 Python 测试。
5. Pull Request 关联 Issue，列出验证结果；界面变更附使用原创示例的截图。

模型测试使用模拟服务；需要真实接口时，由测试者在本机配置自己的令牌。使用者的论文、笔记、运行记录及私有配置保存在各自的忽略目录中。

当前源码按上游工程边界保留：`app/` 对应前端与Web API，`services/` 对应研究后端，`services/paperflow/` 对应核心引擎。课程要求的需求、算法、软件设计、管理和回顾文档分别位于 `docs/` 的同名子目录。
