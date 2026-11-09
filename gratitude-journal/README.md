# 幸福课 · 三件好事（dsh-gratitude-journal）

DSH 插件。每天一份 Markdown，记三件让自己感到幸运或开心的事 —— 积极心理学里常说的「三件好事」练习。

配合一个每天晚上的定时任务用：到点它提醒你，你说三件事，它写进当天的文件。

## 三个工具

| 工具 | 作用 |
|---|---|
| `gratitude_today` | 确保今天（可指定日期）的文件存在，不存在就按模板建；返回路径、已记几条、模板内容 |
| `gratitude_add` | 把一条好事写进第一个空着的编号；三条满了就追加；可选 `why` 说明为什么会发生 |
| `gratitude_review` | 最近 N 天记了几条、连续多少天、哪几天空着。只读 |

## 数据放哪

```
D:\02ai_practice\幸福课\
├── 2026-11\
│   ├── 2026-11-08.md
│   └── 2026-11-09.md
└── 2026-12\
    └── 2026-12-01.md
```

按月分文件夹，一天一个文件，纯 Markdown —— 用任何编辑器都能看，不锁死在这个插件里。

改路径：编辑 `cordis.patch.yml` 的 `dataDir`，或在 profile 里覆盖这一行。

## 每天的文件长这样

```markdown
# 2026-11-09 · 星期日

> 幸福课 · 每天记三件让自己感到幸运或开心的事。

## 三件好事

1. 
2. 
3. 

## 为什么它们会发生（可选）


## 今天的心情

- [ ] 很好　- [ ] 不错　- [ ] 一般　- [ ] 低落
```

## 怎么用

装好后（需要重启 DSH）直接说：

```
记三件好事
```
→ 调 `gratitude_today`，把今天的模板摆出来。

```
第一条：今天室友帮我带了饭
```
→ 调 `gratitude_add`，写进第 1 条。

```
最近一周我坚持得怎么样
```
→ 调 `gratitude_review`，给出连续天数和空缺日期。

## 安装

本包是 [dsh_plugs](https://github.com/ss66725/dsh_plugs) 之外的独立仓库，也可以在 profile 的 `package.json` 里挂本地路径：

```jsonc
"dependencies": { "dsh-gratitude-journal": "file:D:/02ai_practice/dsh-gratitude-journal" },
"dsh": { "profile": { "bundles": ["...", "dsh-gratitude-journal"] } }
```

然后 `pnpm install`，重启 DSH。

## 自检

```powershell
node scripts/selftest.mjs
```

验证日期换算、模板、填槽顺序、连续天数统计，不碰真实数据目录。
