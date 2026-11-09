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

## 怎么用

装好之后不需要记命令，直接用中文提要求。三种典型说法：

```
看看我的学习仓库现在什么状态
```
调 `learning_repo_status`，返回三个仓库的文件数、日期文件夹、测试数、最近改动、隐私命中。

```
看看学习仓库状态，顺便把 C 仓库的测试跑一下
```
同上，但带 `runTests: true`，多返回每个用例的 PASS/FAIL。

```
只跑 Python 仓库 261108 那天的测试
```
调 `learning_repo_run_tests`，参数 `repository: python`、`filter: 261108`。失败时返回的报错里直接带 expected / actual 对比。

```
帮我整理今天的练习
```
模型加载技能走完整流程：确认范围 → 盘点 → 归档到 `YYMMDD/` → 写当天 README → 补 `tests/` → 隐私检查 → 补 `.gitignore` → 问你要不要提交推送。
**删文件和提交推送都会单独征求同意**，不会自己动手。

### 工具参数

`learning_repo_status`（只读）

| 参数 | 类型 | 说明 |
|---|---|---|
| `repository` | string | 仓库 id 或 label；不传扫全部 |
| `runTests` | boolean | 顺带跑测试，默认 `false` |
| `testLimit` | number | 每仓库最多几个用例，默认 40，上限 200 |

`learning_repo_run_tests`

| 参数 | 类型 | 说明 |
|---|---|---|
| `repository` | string | **必填**，id 或 label |
| `filter` | string | 只跑路径前缀匹配的用例，如 `261108` |
| `limit` | number | 最多几个，默认 40，上限 200 |

### 看板

- **设置 → 插件 → 学习仓库**：仓库卡片、测试状态、隐私检查、来源文件夹
- **输入框下方状态行**：总文件数、隐私命中数，可刷新
- 原始 JSON：`GET /learnrepo/api`

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

本包是 [dsh_plugs](https://github.com/ss66725/dsh_plugs) 里的子目录，条款式安装写在根 README。
要点：在 profile 的 `package.json` 里用 `file:` 指向本目录，并把包名加进 `dsh.profile.bundles`，然后 `pnpm install` 重启。

```jsonc
"dependencies": { "dsh-learning-repo-organizer": "file:D:/path/to/dsh_plugs/dsh-learning-repo-organizer" },
"dsh": { "profile": { "bundles": ["...", "dsh-learning-repo-organizer"] } }
```

也可以让插件管理器直接装路径：

```
plugin_manager action=install_bundle target="D:/path/to/dsh_plugs/dsh-learning-repo-organizer"
```

## 与原技能的关系

原技能目录保持不变。修改技能内容时，优先修改本包 `skills/learning-repo-organizer/` 下的副本；如需重新同步，可再次复制原目录覆盖。
