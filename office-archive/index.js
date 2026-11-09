/**
 * Office 归档插件 · 两段式
 *
 *   office_archive_plan   只读扫描，产出一份可审阅的归档方案（不碰任何文件）
 *   office_archive_apply  凭方案 id + confirm 执行复制或移动，并刷新索引
 *
 * 支持两种用法：
 *   1. 收件箱 → 归档：sources 与 target 不同，把散落文件搬进归档库。
 *   2. 原地整理：sources 与 target 是同一个目录，只挑出「还没归位」的文件
 *      （根目录下的、以及 99_未归类 里的），把它们放进对应子目录。
 *      已经归位的不动，所以可以每周重复跑。
 *
 * 设计上刻意把「规划」和「执行」拆成两个工具：方案是一份数据，确认是一次
 * 显式调用。模型先给你看树，你说行，才动手。
 */

import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const inject = ['tools']

// ---------------------------------------------------------------------------
// 分类规则：从上往下匹配，第一条命中生效
// ---------------------------------------------------------------------------

const DEFAULT_RULES = [
  { match: ['_tmp_extract'], dir: '99_待清理/_tmp_extract', note: 'PDF 解包出来的临时图片' },
  { match: ['方大同', 'slide-outline', '标准录音'], dir: '04_演示文稿/方大同英语课', note: '英语课 PPT 项目' },
  { match: ['冰箱不是食品的', 'yswg', 'ppt题目'], dir: '04_演示文稿/冰箱冷藏室', note: 'PPT 作业' },
  { match: ['AI辅助撰写报告文档'], dir: '04_演示文稿/参考资料', note: '写报告用的参考资料' },
  { match: ['资本论'], dir: '05_电子书', note: '电子书' },
  { match: ['实验实训报告'], dir: '01_课程作业/程序设计实训报告', note: '程序设计实训报告' },
  { match: ['产品价格表', 'B企业'], dir: '01_课程作业/表格与图表分析', note: '表格与图表分析作业' },
  { match: ['双选会', '大学生涯规划'], dir: '01_课程作业/就业与生涯规划', note: '就业指导类作业' },
  { match: ['读书笔记'], dir: '01_课程作业', note: '读书笔记' },
  { match: ['实验8和9', '课程笔记'], dir: '02_课程资料/控制系统程序设计基础', note: '课程笔记与实验题' },
  { match: ['实训调研报告', '实训报告框架'], dir: '02_课程资料/实训调研', note: '实训调研材料' },
  { match: ['项目计划书'], dir: '03_项目与方案', note: '项目计划书' },
]

const FALLBACK_DIR = '99_未归类'

const CATEGORY_DESC = {
  '01_课程作业': '平时作业、实训报告、课堂练习',
  '02_课程资料': '课件、课程笔记、实验题、调研材料',
  '03_项目与方案': '项目计划书、方案类文档',
  '04_演示文稿': 'PPT 成品及配套讲稿、大纲、素材',
  '05_电子书': '课外阅读电子书',
  '99_待清理': '临时解包产物、中间文件',
  '99_未归类': '没有命中任何规则，需要你补一条规则',
  '（根目录散落）': '还没归位的文件，下次整理会处理',
}

const EXT_CN = {
  '.docx': 'Word 文档', '.doc': 'Word 文档（旧）',
  '.xlsx': 'Excel 表格', '.xls': 'Excel 表格（旧）',
  '.pptx': 'PowerPoint', '.ppt': 'PowerPoint（旧）',
  '.pdf': 'PDF', '.md': 'Markdown', '.txt': '文本',
  '.png': '图片', '.jpg': '图片', '.jpeg': '图片', '.jp2': '图片', '.gif': '图片',
  '.svg': '图片', '.webp': '图片', '.zip': '压缩包', '.csv': 'CSV',
}

const INDEX_DIR = '00_索引'

// 原地整理时，这些目录下的文件已经归位，不再动。
// 约定：两位数字加下划线开头的一级目录（01_/02_/…/06_…）都算已归位，
// 这样你自己新建 06_证书 之类的分类也不会被扫走。99_未归类 例外，
// 留着它，规则改好后还能把里面的文件重新归位。
const MANAGED_RE = /^\d{2}_/
const REVISIT_DIR = '99_未归类'

const PLAN_TTL_MS = 6 * 60 * 60 * 1000 // 方案 6 小时内有效

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0')

const dateTag = (d) =>
  `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`

const stamp = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
  `${pad(d.getHours())}:${pad(d.getMinutes())}`

async function hashFile(file) {
  const hash = createHash('sha256')
  const handle = await fs.open(file, 'r')
  try {
    const buf = Buffer.allocUnsafe(1 << 20)
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, null)
      if (bytesRead === 0) break
      hash.update(buf.subarray(0, bytesRead))
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/** 去掉下载站水印和重复下载留下的 " (1)"，其余名字保持原样 */
function cleanName(name) {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  const cleaned = stem
    .replace(/\s*\(z-lib[^)]*\)/gi, '')
    .replace(/\s*\(\d+\)$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return `${cleaned || stem}${ext}`
}

function classify(rel, rules) {
  const flat = rel.toLowerCase()
  for (const rule of rules) {
    if (rule.match.some((k) => flat.includes(String(k).toLowerCase()))) {
      return { dir: rule.dir, note: rule.note ?? '' }
    }
  }
  return { dir: FALLBACK_DIR, note: '未命中规则' }
}

async function walk(root) {
  const found = []
  async function visit(dir) {
    let items
    try {
      items = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
      const full = path.join(dir, item.name)
      if (item.isSymbolicLink()) continue
      if (item.isDirectory()) await visit(full)
      else if (item.isFile()) found.push(full)
    }
  }
  await visit(root)
  return found
}

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const csvLine = (cells) => cells.map(csvCell).join(',') + '\r\n'
const text = (s) => [{ type: 'text', text: s }]

const sizeLabel = (bytes) =>
  bytes < 1024 ? `${bytes} B`
    : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`

const mb = (bytes) =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

// ---------------------------------------------------------------------------
// 方案
// ---------------------------------------------------------------------------

/** 原地整理：只有「没归位」的文件才算候选 */
function isLoose(rel) {
  const first = rel.split('/')[0]
  if (first === REVISIT_DIR) return true
  return !MANAGED_RE.test(first)
}

async function buildPlan({ sources, target, rules }) {
  const entries = []
  const warnings = []
  const byHash = new Map()
  const usedNames = new Set()
  const inplace = sources.some((s) => samePath(s, target))

  for (const source of sources) {
    const abs = path.resolve(source)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat?.isDirectory()) {
      warnings.push(`源目录不存在，已跳过：${source}`)
      continue
    }
    const self = samePath(abs, target)
    if (!self && isInside(target, abs)) {
      warnings.push(`归档目录位于源目录内部，已排除：${target}`)
    }

    for (const file of await walk(abs)) {
      if (!self && isInside(file, target)) continue
      const rel = path.relative(abs, file).split(path.sep).join('/')
      if (self && !isLoose(rel)) continue
      // 归档库自己的说明文件不参与整理
      if (self && !rel.includes('/') && rel.toLowerCase() === 'readme.md') continue

      const st = await fs.stat(file)
      const { dir, note } = classify(rel, rules)

      let name = cleanName(path.basename(file))
      const tag = dateTag(st.mtime)
      const ext = path.extname(name)
      let stem = name.slice(0, name.length - ext.length)
      // 名字中间已经带了同一个日期就挪到前面，避免出现 260923_xxx260923
      if (!stem.startsWith(tag) && stem.includes(tag)) {
        const stripped = stem.replace(tag, '').replace(/\s{2,}/g, ' ').trim()
        if (stripped) stem = stripped
      }
      name = stem.startsWith(tag) ? `${stem}${ext}` : `${tag}_${stem}${ext}`

      const key = (d, n) => `${d}/${n}`.toLowerCase()
      let final = name
      if (usedNames.has(key(dir, final))) {
        const e2 = path.extname(name)
        const s2 = name.slice(0, name.length - e2.length)
        let i = 2
        while (usedNames.has(key(dir, `${s2} (${i})${e2}`))) i++
        final = `${s2} (${i})${e2}`
        warnings.push(`目标重名，已加后缀：${name} → ${final}`)
      }
      usedNames.add(key(dir, final))

      // 原地整理时，只规划真正会移动的文件；已经待在正确位置的直接跳过，
      // 否则 99_未归类 里的文件每周都会被重新列一遍
      if (self && samePath(path.join(target, dir, final), file)) continue

      const sha = await hashFile(file)
      let duplicateOf = null
      if (byHash.has(sha)) duplicateOf = byHash.get(sha)
      else byHash.set(sha, rel)

      entries.push({
        src: file,
        source: abs,
        rel,
        dir,
        name: final,
        mtime: st.mtime.toISOString(),
        size: st.size,
        sha,
        note,
        duplicateOf,
      })
    }
  }

  for (const d of entries.filter((e) => e.duplicateOf)) {
    d.note = `${d.note}${d.note ? '；' : ''}内容与 ${d.duplicateOf} 完全相同`
  }

  return {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    sources,
    target: path.resolve(target),
    rules,
    inplace,
    entries,
    warnings,
  }
}

function planSummary(plan) {
  const groups = new Map()
  for (const e of plan.entries) {
    if (!groups.has(e.dir)) groups.set(e.dir, [])
    groups.get(e.dir).push(e)
  }
  const total = plan.entries.reduce((s, e) => s + e.size, 0)
  const lines = []
  lines.push(`方案 ${plan.id}　·　${plan.entries.length} 个文件 / ${mb(total)}　·　尚未执行`)
  lines.push(plan.inplace
    ? `原地整理：${plan.target}（只处理还没归位的文件）`
    : `源目录：${plan.sources.join('、')}`)
  if (!plan.inplace) lines.push(`目标：${plan.target}`)
  lines.push('')

  for (const dir of [...groups.keys()].sort()) {
    const files = groups.get(dir).sort((a, b) => a.mtime.localeCompare(b.mtime))
    lines.push(`${dir}/　（${files.length} 个，${mb(files.reduce((s, f) => s + f.size, 0))}）`)
    for (const f of files) {
      const d = new Date(f.mtime)
      lines.push(`  ${f.name}　(${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())})`)
    }
    lines.push('')
  }

  if (plan.warnings.length) {
    lines.push('需要注意：')
    for (const w of plan.warnings) lines.push(`- ${w}`)
    lines.push('')
  }

  const unclassified = plan.entries.filter((e) => e.dir === FALLBACK_DIR).length
  if (unclassified) {
    lines.push(`有 ${unclassified} 个文件没有命中规则，会放进 ${FALLBACK_DIR}/。补一条规则再重跑会更整齐。`)
  }

  lines.push(`确认无误后调用 office_archive_apply：planId="${plan.id}"、confirm=true。`)
  return lines.join('\n')
}

async function savePlan(plan) {
  const dir = path.join(plan.target, INDEX_DIR, '.plans')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${plan.id}.json`)
  await fs.writeFile(file, JSON.stringify(plan, null, 2), 'utf8')
  return file
}

async function loadPlan(target, id) {
  const file = path.join(path.resolve(target), INDEX_DIR, '.plans', `${id}.json`)
  const raw = await fs.readFile(file, 'utf8').catch(() => null)
  return raw ? JSON.parse(raw) : null
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

async function copyPreservingTime(src, dst, mtime) {
  await fs.copyFile(src, dst)
  await fs.utimes(dst, new Date(), mtime)
}

async function moveFile(src, dst) {
  try {
    await fs.rename(src, dst)
  } catch (err) {
    if (err.code !== 'EXDEV') throw err
    await fs.copyFile(src, dst) // 跨盘：复制后删源
    const st = await fs.stat(src)
    await fs.utimes(dst, new Date(), st.mtime)
    await fs.unlink(src)
  }
}

async function applyPlan(plan, mode) {
  const done = []
  const target = plan.target

  for (const entry of plan.entries) {
    const dir = path.join(target, entry.dir)
    await fs.mkdir(dir, { recursive: true })
    let dst = path.join(dir, entry.name)

    const existing = await fs.stat(dst).catch(() => null)
    if (existing) {
      const same = existing.size === entry.size && (await hashFile(dst)) === entry.sha
      if (same) {
        // 已经归档过：复制模式下什么都不做；移动模式下把源文件清掉
        if (mode === 'move' && !samePath(entry.src, dst)) await fs.unlink(entry.src).catch(() => {})
        done.push({ ...entry, dst, status: 'already' })
        continue
      }
      const ext = path.extname(entry.name)
      const stem = entry.name.slice(0, entry.name.length - ext.length)
      let i = 2
      while (await fs.stat(path.join(dir, `${stem} (${i})${ext}`)).catch(() => null)) i++
      dst = path.join(dir, `${stem} (${i})${ext}`)
    }

    if (samePath(entry.src, dst)) {
      done.push({ ...entry, dst, status: 'already' })
      continue
    }

    if (mode === 'move') await moveFile(entry.src, dst)
    else await copyPreservingTime(entry.src, dst, new Date(entry.mtime))

    if ((await hashFile(dst)) !== entry.sha) {
      throw new Error(`校验失败，源与副本不一致：${entry.src}`)
    }
    done.push({ ...entry, dst, status: mode === 'move' ? 'moved' : 'copied' })
  }

  await writeIndexes(done, target)
  return done
}

// ---------------------------------------------------------------------------
// 索引
// ---------------------------------------------------------------------------

const catOf = (dir) => (dir === '.' || dir === '' ? '（根目录散落）' : dir.split('/')[0])

/** 扫一遍归档库，索引永远反映「现在长什么样」，而不是「这一批搬了什么」 */
async function snapshot(target) {
  const rows = []
  const indexAbs = path.join(target, INDEX_DIR)
  async function visit(dir) {
    let items
    try {
      items = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      const full = path.join(dir, item.name)
      if (item.isSymbolicLink()) continue
      if (item.isDirectory()) {
        if (samePath(full, indexAbs)) continue
        await visit(full)
        continue
      }
      if (!item.isFile()) continue
      const relDir = path.relative(target, dir).split(path.sep).join('/')
      if (relDir === '' && item.name.toLowerCase() === 'readme.md') continue
      const st = await fs.stat(full)
      rows.push({
        dst: full,
        dir: relDir || '.',
        name: item.name,
        size: st.size,
        mtime: st.mtime.toISOString(),
      })
    }
  }
  await visit(target)
  return rows
}

async function appendJournal(target, batch) {
  if (!batch.length) return
  const file = path.join(target, INDEX_DIR, '归档日志.jsonl')
  const lines = batch.map((d) => JSON.stringify({
    at: new Date().toISOString(),
    from: d.src,
    to: d.dst,
    status: d.status,
  }))
  await fs.appendFile(file, lines.join('\n') + '\n', 'utf8')
}

async function writeIndexes(done, target) {
  const indexDir = path.join(target, INDEX_DIR)
  await fs.mkdir(indexDir, { recursive: true })
  const now = new Date()

  const moved = done.filter((d) => d.status !== 'already')
  await appendJournal(target, moved)

  const rows = await snapshot(target)
  const noteOf = new Map(done.map((d) => [d.dst, d.note]))

  const sorted = [...rows].sort((a, b) =>
    `${a.dir}/${a.name}`.localeCompare(`${b.dir}/${b.name}`, 'zh'))

  // 迁移清单（这一批）
  let csv = '\ufeff' + csvLine(
    ['原路径', '新路径', '原文件名', '新文件名', '大小(字节)', '修改时间', 'SHA256', '分类'])
  for (const d of [...moved].sort((a, b) => a.dst.localeCompare(b.dst, 'zh'))) {
    csv += csvLine([
      d.src, d.dst, path.basename(d.src), path.basename(d.dst), d.size,
      stamp(new Date(d.mtime)), d.sha, d.dir,
    ])
  }
  await fs.writeFile(path.join(indexDir, '迁移清单.csv'), csv, 'utf8')

  // 文件索引（整库快照，Excel / WPS 双击即开）
  let idx = '\ufeff' + csvLine(
    ['序号', '大类', '目录', '文件名', '修改日期', '类型', '大小(KB)', '路径', '说明'])
  sorted.forEach((r, i) => {
    const ext = path.extname(r.name).toLowerCase()
    const note = noteOf.get(r.dst) ?? ''
    idx += csvLine([
      i + 1, catOf(r.dir), r.dir, r.name,
      stamp(new Date(r.mtime)), EXT_CN[ext] ?? '其他',
      (r.size / 1024).toFixed(1), r.dst, note,
    ])
  })
  await fs.writeFile(path.join(indexDir, '文件索引.csv'), idx, 'utf8')

  // 目录树 + 时间线 + 分类表
  const groups = new Map()
  for (const r of sorted) {
    if (!groups.has(r.dir)) groups.set(r.dir, [])
    groups.get(r.dir).push(r)
  }

  const lines = [
    '# Office 文件索引',
    '',
    `生成时间：${stamp(now)}　|　共 ${sorted.length} 个文件、${mb(rows.reduce((s, r) => s + r.size, 0))}`,
    '',
    '文件名开头的 `YYMMDD_` 是**修改时间**，同一批次的文件会挨在一起。',
    '',
    '## 目录结构',
    '',
    '```',
  ]
  for (const dir of [...groups.keys()].sort()) {
    lines.push(`${dir === '.' ? '（根目录）' : `${dir}/`}`)
    for (const r of groups.get(dir).sort((a, b) => a.mtime.localeCompare(b.mtime))) {
      lines.push(`  ├── ${r.name}`)
    }
  }
  lines.push('```', '')

  const months = new Map()
  for (const r of sorted) {
    const m = r.mtime.slice(0, 7)
    if (!months.has(m)) months.set(m, [])
    months.get(m).push(r)
  }
  lines.push('## 时间线（按修改时间）', '')
  for (const m of [...months.keys()].sort()) {
    const items = months.get(m).sort((a, b) => a.mtime.localeCompare(b.mtime))
    lines.push(`### ${m}　${items.length} 个文件`, '')
    for (const r of items) {
      const t = new Date(r.mtime)
      lines.push(`- \`${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}\`　${r.name}　—　${r.dir === '.' ? '（根目录）' : r.dir}`)
    }
    lines.push('')
  }

  const cats = [...new Set(sorted.map((r) => catOf(r.dir)))].sort()
  for (const cat of cats) {
    const items = sorted.filter((r) => catOf(r.dir) === cat)
    lines.push(`## ${cat}　${items.length} 个文件`, '')
    if (CATEGORY_DESC[cat]) lines.push(`> ${CATEGORY_DESC[cat]}`, '')
    lines.push('| 文件 | 修改日期 | 类型 | 大小 | 目录 |', '|---|---|---|---|---|')
    for (const r of items) {
      const t = new Date(r.mtime)
      const ext = path.extname(r.name).toLowerCase()
      lines.push(`| ${r.name} | ${stamp(t).slice(0, 10)} | ${EXT_CN[ext] ?? '其他'} | ${sizeLabel(r.size)} | ${r.dir === '.' ? '根目录' : r.dir} |`)
    }
    lines.push('')
  }
  await fs.writeFile(path.join(indexDir, '文件索引.md'), lines.join('\n'), 'utf8')

  // 还原脚本：从归档日志反推，把每个文件放回它最初的位置
  const logFile = path.join(indexDir, '归档日志.jsonl')
  const raw = await fs.readFile(logFile, 'utf8').catch(() => '')
  const latest = new Map()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line)
      if (rec.status !== 'moved') continue
      latest.set(rec.to, rec) // 同一目标以最后一次为准
    } catch {
      /* 跳过坏行 */
    }
  }
  const ps = [
    '# 还原：把归档里的文件按归档日志复制回最初的位置（归档目录本身保留）',
    '# 用法：powershell -ExecutionPolicy Bypass -File 还原到原位置.ps1',
    '',
    "$ErrorActionPreference = 'Stop'",
    "Write-Host '即将把文件复制回原位置，按 Ctrl+C 可取消…' -ForegroundColor Yellow",
    'Start-Sleep -Seconds 3',
    '$n = 0',
    '',
  ]
  for (const rec of latest.values()) {
    ps.push(
      `if (Test-Path -LiteralPath "${rec.to}") {`,
      `  New-Item -ItemType Directory -Path "${path.dirname(rec.from)}" -Force | Out-Null`,
      `  Copy-Item -LiteralPath "${rec.to}" -Destination "${rec.from}" -Force`,
      '  $n++',
      '}',
    )
  }
  ps.push('', 'Write-Host ("已还原 $n 个文件到最初位置") -ForegroundColor Green')
  await fs.writeFile(path.join(indexDir, '还原到原位置.ps1'), '\ufeff' + ps.join('\r\n'), 'utf8')

  return { indexDir, count: sorted.length }
}

// ---------------------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------------------

const planParameters = {
  type: 'object',
  properties: {
    sources: {
      type: 'array',
      items: { type: 'string' },
      description:
        '要整理的目录，绝对路径，可以多个。若与 target 相同，则表示「原地整理」这个目录自己。',
    },
    target: {
      type: 'string',
      description: '归档根目录的绝对路径，不存在会自动创建。',
    },
    rules: {
      type: 'array',
      description:
        '自定义分类规则，按顺序匹配，第一条命中生效。省略则用内置规则（课程作业、课程资料、项目、演示文稿、电子书）。',
      items: {
        type: 'object',
        properties: {
          match: {
            type: 'array',
            items: { type: 'string' },
            description: '文件名或相对路径里包含任一关键字就命中。',
          },
          dir: { type: 'string', description: '命中的文件放进这个子目录，可用 A/B 表示层级。' },
          note: { type: 'string', description: '写进索引「说明」列的一句话。' },
        },
        required: ['match', 'dir'],
        additionalProperties: false,
      },
    },
  },
  required: ['sources', 'target'],
  additionalProperties: false,
}

const applyParameters = {
  type: 'object',
  properties: {
    planId: { type: 'string', description: 'office_archive_plan 返回的方案 id。' },
    confirm: {
      type: 'boolean',
      description: '必须显式传 true，表示用户已经看过方案并同意执行。',
    },
    mode: {
      type: 'string',
      enum: ['copy', 'move'],
      description: 'copy 保留源文件（默认）；move 会在校验通过后删除源文件。原地整理强制 move。',
    },
    target: {
      type: 'string',
      description: '方案的归档根目录。方案文件按 target 存放，若方案不是本进程生成的，需要它来定位。',
    },
  },
  required: ['planId', 'confirm'],
  additionalProperties: false,
}

const planTool = {
  name: 'office_archive_plan',
  description:
    '只读扫描若干目录，按「大类 / 项目 / 修改时间」生成一份 Office 文件归档方案：每个文件会去哪儿、是否重名、是否内容重复。不移动、不复制任何文件。sources 与 target 相同时表示原地整理该目录。用户确认后，再用 office_archive_apply 执行。',
  parameters: planParameters,
  isConcurrencySafe: () => true,
  output: {
    schema: { type: 'object' },
    render: (_args, value) => text(value?.summary ?? ''),
  },
  async execute(args) {
    const sources = Array.isArray(args?.sources) ? args.sources.filter(Boolean) : []
    if (!sources.length) throw new Error('sources 不能为空')
    if (!args?.target) throw new Error('target 不能为空')

    const rules = Array.isArray(args.rules) && args.rules.length
      ? args.rules.map((r) => ({
          match: (r.match ?? []).map(String).filter(Boolean),
          dir: String(r.dir),
          note: r.note ? String(r.note) : '',
        }))
      : DEFAULT_RULES

    const plan = await buildPlan({ sources, target: args.target, rules })
    const empty = !plan.entries.length
    const summary = empty
      ? `${plan.inplace ? `${plan.target} 里所有文件都已归位` : `在 ${sources.join('、')} 里没有找到任何文件`}。` +
        (plan.warnings.length ? `\n${plan.warnings.join('\n')}` : '') +
        `\n\n方案 ${plan.id} 仍然有效：执行它只会刷新索引，不会移动任何文件。`
      : planSummary(plan)
    let planFile = null
    try {
      planFile = await savePlan(plan)
    } catch {
      planFile = null
    }

    return {
      summary,
      planId: plan.id,
      target: plan.target,
      inplace: plan.inplace,
      total: plan.entries.length,
      bytes: plan.entries.reduce((s, e) => s + e.size, 0),
      warnings: plan.warnings,
      planFile,
      groups: [...new Set(plan.entries.map((e) => e.dir))].sort().map((dir) => ({
        dir,
        count: plan.entries.filter((e) => e.dir === dir).length,
      })),
    }
  },
}

const applyTool = {
  name: 'office_archive_apply',
  description:
    '执行 office_archive_plan 生成的归档方案：复制（或移动）文件到方案指定的位置，逐个校验 SHA256，并刷新 00_索引 下的文件索引、迁移清单和还原脚本。必须带上方案 id 且 confirm=true。',
  parameters: applyParameters,
  isConcurrencySafe: () => false,
  timeoutMs: 600000,
  output: {
    schema: { type: 'object' },
    render: (_args, value) => text(value?.summary ?? ''),
  },
  async execute(args) {
    const planId = String(args?.planId ?? '').trim()
    if (!planId) throw new Error('planId 不能为空')
    if (args?.confirm !== true) {
      throw new Error('没有确认就不执行。请先把方案给用户看，得到同意后再传 confirm=true。')
    }

    const target = args?.target ? path.resolve(args.target) : null
    const plan = target ? await loadPlan(target, planId) : null
    if (!plan) throw new Error(`找不到方案 ${planId}，请重新运行 office_archive_plan。`)
    if (plan.appliedAt) throw new Error(`方案 ${planId} 已于 ${plan.appliedAt} 执行过，请重新生成方案。`)
    if (Date.now() - new Date(plan.createdAt).getTime() > PLAN_TTL_MS) {
      throw new Error('方案已超过 6 小时，文件可能已经变化，请重新生成。')
    }

    // 原地整理没有「保留源文件」这个概念，一律移动
    const mode = plan.inplace ? 'move' : args?.mode === 'move' ? 'move' : 'copy'

    const done = await applyPlan(plan, mode)
    plan.appliedAt = new Date().toISOString()
    plan.appliedMode = mode
    try {
      await savePlan(plan)
    } catch {
      /* 方案记录写不进去不影响归档结果 */
    }

    const total = done.reduce((s, d) => s + d.size, 0)
    const already = done.filter((d) => d.status === 'already').length
    const renamed = done.filter((d) => path.basename(d.dst) !== d.name).length
    if (!done.length) {
      return {
        summary: `没有需要移动的文件，索引已按当前目录刷新。\n\n索引：${path.join(plan.target, INDEX_DIR)}`,
        total: 0,
        mode,
        inplace: plan.inplace,
        alreadyArchived: 0,
        indexDir: path.join(plan.target, INDEX_DIR),
      }
    }
    const lines = [
      `已归档 ${done.length} 个文件 / ${mb(total)} → ${plan.target}`,
      `方式：${plan.inplace ? '原地整理（移动）' : mode === 'move' ? '移动（源文件已删除）' : '复制（源文件保留）'}`,
      `校验：${done.length}/${done.length} SHA256 一致`,
    ]
    if (already) lines.push(`其中 ${already} 个此前已归位，内容一致，未重复处理`)
    if (mode === 'copy' && !already) lines.push('源目录未做任何改动。')
    if (renamed) lines.push(`有 ${renamed} 个文件因目标重名额外加了后缀`)
    lines.push('', `索引：${path.join(plan.target, INDEX_DIR)}`)
    lines.push('  - 文件索引.csv / 文件索引.md　（整库快照，每次重写）')
    lines.push('  - 迁移清单.csv　（这一批的 原位置 → 新位置 + SHA256）')
    lines.push('  - 归档日志.jsonl　（累积日志，还原脚本按它生成）')
    lines.push('  - 还原到原位置.ps1　（把文件复制回最初位置）')

    return {
      summary: lines.join('\n'),
      total: done.length,
      mode,
      inplace: plan.inplace,
      alreadyArchived: already,
      indexDir: path.join(plan.target, INDEX_DIR),
    }
  },
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(planTool))
  ctx.effect(() => ctx.tools.register(applyTool))
}
