# dsh_plugs

自用的 DeepSeek Harness 插件合集。每个插件一个目录，互不依赖。

| 插件 | 形态 | 一句话 |
|---|---|---|
| [dsh-learning-repo-organizer](./dsh-learning-repo-organizer) | bundle：技能 + 工具 + WebUI | 整理 C / Python / Arduino 学习仓库：按日期归档、补 `tests/` 期望输出、隐私检查，并带设置页看板 |
| [office-archive](./office-archive) | bundle：纯 host 工具 | Office 文件归档：先出方案给你看，确认后才复制或移动，并刷新索引 / 迁移清单 / 还原脚本 |

## 目录结构

```
dsh_plugs/
├── dsh-learning-repo-organizer/
│   ├── index.js            host 侧：注册技能、两个工具、/learnrepo 接口
│   ├── client.js           WebUI 侧：设置页看板 + 输入框状态行
│   ├── cordis.patch.yml    插入插件行（含默认配置）
│   ├── locale/{zh,en}.json
│   ├── skills/learning-repo-organizer/   内嵌技能（SKILL.md + references + run_tests.py）
│   └── scripts/            自检脚本
└── office-archive/
    ├── index.js            host 侧：office_archive_plan / office_archive_apply
    ├── cordis.patch.yml
    └── locale/{zh,en}.json
```

## 安装

两个插件都靠 `cordis.patch.yml` 声明自己那一行，所以走 profile 的 bundle 流程：
先把目录挂进 profile 的 `dependencies`，再写进 `dsh.profile.bundles`，最后安装依赖。

以 `dsh-learning-repo-organizer` 为例，编辑 `~/.dsh/profiles/<profile>/package.json`：

```jsonc
{
  "dependencies": {
    "dsh-learning-repo-organizer": "file:D:/path/to/dsh_plugs/dsh-learning-repo-organizer"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "dsh-learning-repo-organizer"]
    }
  }
}
```

`office-archive` 的包名是 `@local/office-archive`，用 `link:` 指向目录即可：

```jsonc
"@local/office-archive": "link:D:/path/to/dsh_plugs/office-archive"
```

改完在 profile 目录跑一次 `pnpm install`，重启 DSH 生效。
也可以在会话里让插件管理器装本地路径：`plugin_manager action=install_bundle target="<插件目录>"`。

## 环境要求

- DSH `0.1.0-rc.8` 一代的 profile（两个插件都按这版的 `dsh.bundle` / `dsh.client` 声明写）。
- `dsh-learning-repo-organizer`：host 需要 `skills`、`webServer` 服务；跑测试还需要 `subprocess` 和本机的 `gcc` / `python`。缺了会返回说明，不会崩。
- `office-archive`：只用 `tools`，没有额外服务依赖。

## 许可

个人自用项目，未附许可协议；引用请注明出处。
