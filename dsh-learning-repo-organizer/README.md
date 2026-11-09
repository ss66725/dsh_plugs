# Learning repos · 学习仓库

DSH 插件，把 `learning-repo-organizer` 技能（原 `C:\Users\Thinkpad\.claude\skills\learning-repo-organizer`）整理成可安装的 Harness bundle。原目录只读复制，不做任何修改。

## 提供什么

| 能力 | 说明 |
|---|---|
| 技能 `learning-repo-organizer` | 内置 `skills/learning-repo-organizer/SKILL.md` 与 `references/`、`scripts/`，通过 `ctx.skills.register` 注册，模型可用 `skill` 工具加载 |
| 工具 `learning_repo_status` | 扫描已配置仓库：语言文件数、日期文件夹、tests/ 期望输出、最近改动、隐私检查（cookie/password/token/ssid 等，忽略 `YOUR_...` 占位符）。可选 `runTests` |
| 工具 `learning_repo_run_tests` | 按 `scripts/run_tests.py` 的规则运行 `tests/<程序名>.txt`（C 用 `gcc -std=c11 -Wall -Wextra -lm`；Python 用 `PYTHONHASHSEED=0`、`PYTHONIOENCODING=utf-8`） |
| 设置页看板 | 设置 → 插件 → 学习仓库：三个仓库的卡片、测试状态、隐私检查结果、来源文件夹 |
| 输入框下方状态行 | 总文件数与隐私命中数，可刷新 |
| HTTP 接口 | `GET /learnrepo/api`（经 Connection 认证），返回看板 JSON |

## 配置

`cordis.patch.yml` 的默认值与技能里的「固定路径」一致：

```yaml
- insert:
    - id: learning-repo-organizer
      name: dsh-learning-repo-organizer
      config:
        repositories:
          - id: c
            label: C
            path: D:\01_代码\01c
            remote: https://github.com/ss66725/C
            languages: [c]
        sourceDirectories: []
        testTimeoutMs: 30000
        dashboardPath: /learnrepo
```

仓库路径、来源文件夹、测试超时都可以在 profile 的 `cordis.patch.yml` 里按行覆盖。

## 依赖

- 解析配置需要 `schemastery`（bundle 的 `dependencies` 已声明）；profile 里没有时，安装一次依赖即可让该行从 `absent` 变成可用。

- Host：`skills`、`webServer`（可选 `tools`、`subprocess`、`connection`）。
- 运行测试需要 profile 里有 `subprocess` 服务（`dsh-subprocess-local`）以及本机的 `gcc` / `python`；缺失时工具会返回明确说明而不是崩溃。

## 安装

```powershell
# 在 DSH 会话中
plugin_manager action=install_bundle target="D:\02_AI\02ai_practice\dsh-learning-repo-organizer"
```

## 与原技能的关系

原技能目录保持不变。修改技能内容时，优先修改本包 `skills/learning-repo-organizer/` 下的副本；如需重新同步，可再次复制原目录覆盖。
