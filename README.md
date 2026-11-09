# dsh_plugs

两个自用的 DeepSeek Harness 插件，附完整用法说明。

| 插件 | 一句话 | 你需要它的时候 |
|---|---|---|
| [dsh-learning-repo-organizer](./dsh-learning-repo-organizer) | 让模型整理你的 C / Python / Arduino 学习仓库 | 今天写了一堆练习，想按日期归档、补期望输出、查隐私、再推 GitHub |
| [office-archive](./office-archive) | 把散落的 Office 文件收进归档库，先出方案再动手 | 下载目录、桌面堆着一堆 Word/Excel/PPT，想按「课程作业 / 课程资料 / 电子书」归位 |

两个插件互不依赖，可以只装一个。下面按「装 → 配 → 用」三步写。

---

# 一、安装

## 1. 拿到代码

```powershell
git clone https://github.com/ss66725/dsh_plugs.git D:\02ai_practice\dsh_plugs
```

放哪都行，后面把路径换成你自己的。

## 2. 告诉 profile 这个包在哪

编辑 `C:\Users\<你的用户名>\.dsh\profiles\<profile>\package.json`，
在 `dependencies` 里加一行，在 `dsh.profile.bundles` 里加个名字：

```jsonc
{
  "private": true,
  "dependencies": {
    // 路径分隔符用 /，指向 clone 下来的目录
    "dsh-learning-repo-organizer": "file:D:/02ai_practice/dsh_plugs/dsh-learning-repo-organizer",
    "@local/office-archive": "link:D:/02ai_practice/dsh_plugs/office-archive"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-learning-repo-organizer",
        "@local/office-archive"
      ]
    }
  }
}
```

- `file:` 和 `link:` 都行：`link:` 是软链，你改源码不用重装；`file:` 是复制，适合定版。
- `@local/office-archive` 带 scope，`@local` 不是真组织，只是本地命名习惯。

## 3. 装依赖、重启

```powershell
cd C:\Users\<你的用户名>\.dsh\profiles\<profile>
pnpm install
```

然后重启 DSH。重启后 **设置 → 插件** 里应该能看到两张卡片：`学习仓库`、`Office 文件归档`。

> 也可以在会话里让插件管理器装本地路径：
> `plugin_manager action=install_bundle target="D:/02ai_practice/dsh_plugs/office-archive"`

---

# 二、学习仓库整理 · 怎么用

## 它给了你三样东西

| 东西 | 在哪 | 干什么 |
|---|---|---|
| 技能 `learning-repo-organizer` | 模型自己会加载 | 一整套整理流程：确认范围 → 盘点 → 归档到 `YYMMDD/` → 写每天 README → 补 `tests/` → 隐私检查 → 提交推送 |
| 工具 `learning_repo_status` | 对话里自动可调 | 只读扫描：文件数、日期文件夹数、测试数、最近改动、隐私命中 |
| 工具 `learning_repo_run_tests` | 对话里自动可调 | 跑 `tests/<程序名>.txt` 期望输出，给每个用例 PASS/FAIL 和 diff |

外加一个看板：设置页卡片 + 输入框下方的状态行（总文件数 / 隐私命中数），数据来自 `GET /learnrepo/api`。

## 先配你的仓库路径

默认值在插件的 `cordis.patch.yml` 里，改成你自己的：

```yaml
- insert:
    - id: learning-repo-organizer
      name: dsh-learning-repo-organizer
      config:
        repositories:
          - id: c
            label: C
            path: D:\01_代码\01c            # 你的 C 练习目录
            remote: https://github.com/ss66725/C
            languages: [c]
          - id: python
            label: Python
            path: D:\01_代码\01py
            remote: https://github.com/ss66725/Python
            languages: [python]
          - id: arduino
            label: Arduino
            path: D:\01_代码\01arduino\coding
            remote: https://github.com/ss66725/Arduino
            languages: [arduino]
        sourceDirectories: []        # 额外要收进来的散装目录，可留空
        testTimeoutMs: 30000         # 单个程序跑测试的超时，1000~300000
        dashboardPath: /learnrepo    # 看板接口路径
```

字段含义：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 工具参数里用的名字，如 `c` |
| `label` | | 界面显示名，工具参数也能用它匹配 |
| `path` | ✅ | 仓库根目录绝对路径 |
| `remote` | | GitHub 地址，仅用于展示和提醒 |
| `languages` | | `c` / `python` / `arduino`，决定看哪些文件 |
| `sourceDirectories` | | 归档时额外从这些目录收文件（原文件不动） |

`testTimeoutMs` 和 `dashboardPath` 是全局项，不在仓库里重复写。

## 然后直接用对话

装好就这三句话能跑起来：

```
看看我的学习仓库现在什么状态
```
→ 调 `learning_repo_status`，返回三个仓库的盘点结果。想连测试一起跑：

```
看看学习仓库状态，顺便把 C 仓库的测试跑一下
```
→ `learning_repo_status` 带 `runTests: true`。

```
只跑 Python 仓库 261108 那天的测试
```
→ `learning_repo_run_tests`，参数 `repository: python`、`filter: 261108`。

```
帮我整理今天的练习
```
→ 模型加载技能，走完整流程。它会先跟你确认日期和文件夹命名，**删文件和提交推送都会单独问你**，不会自己动手。

## 工具参数速查

**`learning_repo_status`**（只读）

| 参数 | 类型 | 说明 |
|---|---|---|
| `repository` | string | 仓库 id 或 label；不传就扫全部 |
| `runTests` | boolean | 是否顺带跑测试，默认 `false` |
| `testLimit` | number | 每个仓库最多跑几个用例，默认 40，上限 200 |

**`learning_repo_run_tests`**

| 参数 | 类型 | 说明 |
|---|---|---|
| `repository` | string | **必填** |
| `filter` | string | 只跑路径前缀匹配的用例，如 `261108` |
| `limit` | number | 最多跑几个，默认 40，上限 200 |

跑测试的规则固定：C 用 `gcc -std=c11 -Wall -Wextra -lm`；Python 用 `PYTHONHASHSEED=0`、`PYTHONIOENCODING=utf-8`；行尾空白归一化。和仓库里的 `run_tests.py` 完全一致。

## 看板在哪

- **设置 → 插件 → 学习仓库**：三个仓库的卡片、测试通过数、隐私检查结果
- **输入框下方状态行**：总文件数 + 隐私命中数，点一下刷新
- 原始数据：`GET /learnrepo/api`（经 Connection 认证）

---

# 三、Office 归档 · 怎么用

## 核心设计：规划与执行拆开

`office_archive_plan` 只读、只出方案；`office_archive_apply` 要你点头才动文件。
所以**不会出现模型偷偷移动你文件的情况**。

## 两种用法

**收件箱 → 归档库**（`sources` 与 `target` 不同）：

```
把 D:\下载\待整理 收进 D:\归档，按课程作业和课程资料分
```

**原地整理**（`sources` 与 `target` 是同一目录）：只挑还散落在根目录和 `99_未归类/` 里的文件，放进对应子目录。已经归位的不动，所以可以每周重复跑。原地整理强制 `move`。

```
把 D:\归档 原地整理一下
```

## 自己写分类规则

按顺序匹配，第一条命中生效；文件名或相对路径里包含任一关键字就命中：

```jsonc
[
  { "match": ["实验报告", "课程笔记"], "dir": "01_课程作业/程序设计实验", "note": "实验报告" },
  { "match": ["slides", "大纲"],       "dir": "04_演示文稿",            "note": "PPT 项目" },
  { "match": ["教材", "电子书"],        "dir": "05_电子书",              "note": "课外阅读" }
]
```

`dir` 支持 `A/B` 表示层级；`note` 写进索引的「说明」列。
不传 `rules` 就用内置规则（课程作业 / 课程资料 / 项目 / 演示文稿 / 电子书 / 待清理）。
没命中任何规则的进 `99_未归类/`，等你补规则。

## 归档后会多一个 `00_索引/`

| 文件 | 内容 |
|---|---|
| `文件索引.csv` / `文件索引.md` | 整库快照，每次重写，Excel 双击即开 |
| `迁移清单.csv` | 这一批的「原位置 → 新位置 + SHA256」 |
| `归档日志.jsonl` | 累积日志，还原脚本按它生成 |
| `还原到原位置.ps1` | 把归档里的文件复制回最初位置 |

后悔了就还原：

```powershell
powershell -ExecutionPolicy Bypass -File 00_索引\还原到原位置.ps1
```

## 安全边界

- 方案 6 小时内有效，过期重新生成
- `apply` 必须带方案 id 且 `confirm: true`，缺一个就拒绝
- `copy` 保留源文件；`move` 先校验目标 SHA256 一致，再删源文件

---

# 四、常见问题

**装完看不到插件卡片？**
先看 profile 目录有没有 `pnpm install` 成功，再看 `dsh.profile.bundles` 里名字写对没有，最后重启 DSH。

**`learning_repo_status` 报 Unknown repository？**
报错信息里会列出当前配置的所有 id，照着改 `repository` 参数即可。

**测试工具说 unavailable？**
缺 `subprocess` 服务，或本机没有 `gcc` / `python`。缺什么它会明说，不会崩。

**看板 404？**
`dashboardPath` 必须以 `/` 开头；host 需要 `webServer` 服务（`dsh-web-app` 自带）。

**中文乱码？**
文件统一 UTF-8。终端里看到的乱码通常是 PowerShell 代码页问题，不影响文件内容。

**两个插件会互相影响吗？**
不会。`office-archive` 只用 `tools` 服务；`learning-repo-organizer` 用 `skills` + `webServer`，`subprocess` 可选。

---

# 五、目录结构

```
dsh_plugs/
├── README.md                     本文件
├── LICENSE                       MIT
├── dsh-learning-repo-organizer/
│   ├── index.js                  host：注册技能、两个工具、/learnrepo 接口
│   ├── client.js                 WebUI：设置页看板 + 状态行
│   ├── cordis.patch.yml          插入插件行（默认配置在这里改）
│   ├── locale/{zh,en}.json
│   ├── skills/learning-repo-organizer/   内嵌技能
│   │   ├── SKILL.md              整理流程
│   │   ├── references/           c.md / python.md / arduino.md
│   │   └── scripts/run_tests.py  统一测试运行器
│   └── scripts/                  自检脚本
└── office-archive/
    ├── index.js                  host：office_archive_plan / office_archive_apply
    ├── cordis.patch.yml
    └── locale/{zh,en}.json
```

环境要求：DSH `0.1.0-rc.8` 一代 profile；Node ≥ 20。

# 许可

MIT，见 [LICENSE](./LICENSE)。
