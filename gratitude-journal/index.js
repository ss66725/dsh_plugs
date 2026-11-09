/**
 * 幸福课 · 三件好事
 *
 * 每天一份 Markdown：记三件让自己感到幸运或开心的事。
 * 三个工具：
 *   gratitude_today   确保今天的文件存在，返回模板 / 已记几条
 *   gratitude_add     往今天（或指定日期）的模板里填一条
 *   gratitude_review  最近 N 天记录情况 + 连续天数
 *
 * 数据只落在本地一个目录里：<dataDir>/YYYY-MM/YYYY-MM-DD.md
 */

import fs from 'node:fs/promises'
import path from 'node:path'

export const inject = ['tools']

const DEFAULT_DATA_DIR = 'D:\\02ai_practice\\幸福课'
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const SLOTS = 3
const HEADING_ENTRIES = '## 三件好事'
const HEADING_WHY = '## 为什么它们会发生（可选）'

// ---------------------------------------------------------------------------
// 纯函数：日期与模板（selftest 直接调这些）
// ---------------------------------------------------------------------------

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** 本地日期 → 2026-11-09 */
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function weekdayOf(key) {
  const [year, month, day] = key.split('-').map(Number)
  return WEEKDAYS[new Date(year, month - 1, day).getDay()]
}

/** 数据目录 + 日期 → 文件绝对路径，按月分文件夹 */
export function dayFile(dataDir, key) {
  return path.join(dataDir, key.slice(0, 7), `${key}.md`)
}

export function renderTemplate(key) {
  return [
    `# ${key} · ${weekdayOf(key)}`,
    '',
    '> 幸福课 · 每天记三件让自己感到幸运或开心的事。',
    '',
    HEADING_ENTRIES,
    '',
    '1. ',
    '2. ',
    '3. ',
    '',
    HEADING_WHY,
    '',
    '',
    '## 今天的心情',
    '',
    '- [ ] 很好　- [ ] 不错　- [ ] 一般　- [ ] 低落',
    '',
    '---',
    '',
  ].join('\n')
}

/** 某个二级标题下的所有行（不含标题本身） */
function sectionRange(lines, heading) {
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) { end = i; break }
  }
  return { start, end }
}

/** 读「三件好事」里已写的内容，忽略编号但空着的行 */
export function readEntries(content) {
  const lines = content.split(/\r?\n/)
  const range = sectionRange(lines, HEADING_ENTRIES)
  if (range === null) return []
  const out = []
  for (let i = range.start + 1; i < range.end; i += 1) {
    const matched = lines[i].match(/^\d+\.\s+(.+?)\s*$/)
    if (matched && matched[1].trim() !== '') out.push(matched[1].trim())
  }
  return out
}

/**
 * 填第一条还空着的编号；三条都满了就在后面追加第 4 条。
 * 传了 slot 就填指定的那一条（已写过则报错，避免覆盖）。
 * 返回新内容与落在第几号。
 */
export function fillSlot(content, text, slot) {
  const lines = content.split(/\r?\n/)
  const range = sectionRange(lines, HEADING_ENTRIES)
  if (range === null) return null

  if (slot !== undefined) return fillSlotAt(lines, range, Number(slot), text, content)

  for (let i = range.start + 1; i < range.end; i += 1) {
    const matched = lines[i].match(/^(\d+)\.\s*(.*)$/)
    if (matched && matched[2].trim() === '') {
      lines[i] = `${matched[1]}. ${text}`
      return { content: lines.join('\n'), slot: Number(matched[1]) }
    }
  }

  // 三条都写满了：接在最后一条编号后面
  let lastNumbered = null
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (/^\d+\.\s+\S/.test(lines[i])) lastNumbered = i
  }
  const existing = readEntries(lines.join('\n')).length
  const nextSlot = existing + 1
  const insertAt = (lastNumbered ?? range.start) + 1
  lines.splice(insertAt, 0, `${nextSlot}. ${text}`)
  return { content: lines.join('\n'), slot: nextSlot }
}

/** 指定编号写入：空位就填，已写过就返回 error，编号不存在则追加 */
function fillSlotAt(lines, range, slot, text, original) {
  if (!Number.isInteger(slot) || slot < 1) return { error: `第几号要写正整数，收到的是 ${slot}` }
  for (let i = range.start + 1; i < range.end; i += 1) {
    const matched = lines[i].match(/^(\d+)\.\s*(.*)$/)
    if (matched && Number(matched[1]) === slot) {
      if (matched[2].trim() !== '') return { error: `第 ${slot} 条已经写了：${matched[2].trim()}` }
      lines[i] = `${slot}. ${text}`
      return { content: lines.join('\n'), slot }
    }
  }
  let lastNumbered = null
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (/^\d+\.\s+\S/.test(lines[i])) lastNumbered = i
  }
  const insertAt = (lastNumbered ?? range.start) + 1
  lines.splice(insertAt, 0, `${slot}. ${text}`)
  return { content: lines.join('\n'), slot }
}

/** 把「为什么」挂到对应条目的说明区 */
export function fillWhy(content, slot, why) {
  const lines = content.split(/\r?\n/)
  const range = sectionRange(lines, HEADING_WHY)
  if (range === null) return content
  let insertAt = range.end
  while (insertAt - 1 > range.start && lines[insertAt - 1].trim() === '') insertAt -= 1
  lines.splice(insertAt, 0, `- 第 ${slot} 条：${why}`)
  return lines.join('\n')
}

export function resolveConfig(config) {
  const raw = config && typeof config === 'object' ? config.dataDir : undefined
  const dataDir = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : DEFAULT_DATA_DIR
  return { dataDir }
}

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

/** 读今天的文件；不存在就按模板建一份 */
export async function ensureDay(cfg, key = dayKey()) {
  const file = dayFile(cfg.dataDir, key)
  try {
    const content = await fs.readFile(file, 'utf8')
    return { file, key, created: false, content }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await fs.mkdir(path.dirname(file), { recursive: true })
    const content = renderTemplate(key)
    await fs.writeFile(file, content, 'utf8')
    return { file, key, created: true, content }
  }
}

export async function addEntry(cfg, { text, why, key = dayKey(), slot }) {
  const day = await ensureDay(cfg, key)
  const filled = fillSlot(day.content, text, slot)
  if (filled === null) throw new Error(`${day.file} 里没有「${HEADING_ENTRIES}」这一段，请先修好模板`)
  if (filled.error) throw new Error(filled.error)
  let content = filled.content
  if (typeof why === 'string' && why.trim() !== '') content = fillWhy(content, filled.slot, why.trim())
  await fs.writeFile(day.file, content, 'utf8')
  return { file: day.file, key: day.key, slot: filled.slot, entries: readEntries(content), content }
}

function shiftKey(key, delta) {
  const [year, month, day] = key.split('-').map(Number)
  const shifted = new Date(year, month - 1, day + delta)
  return dayKey(shifted)
}

/** 最近 N 天：每天记了几条、连续天数、哪几天缺 */
export async function review(cfg, { days = 7, key = dayKey() } = {}) {
  const total = Math.min(Math.max(Number(days) || 7, 1), 120)
  const rows = []
  for (let offset = total - 1; offset >= 0; offset -= 1) {
    const dayKeyValue = shiftKey(key, -offset)
    const file = dayFile(cfg.dataDir, dayKeyValue)
    let entries = []
    try {
      entries = readEntries(await fs.readFile(file, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    rows.push({
      date: dayKeyValue,
      weekday: weekdayOf(dayKeyValue),
      entries: entries.length,
      done: entries.length >= SLOTS,
      text: entries,
    })
  }

  // 连续天数：从今天往回数；今天还没写就从昨天开始数
  let streak = 0
  let cursor = rows.length - 1
  if (cursor >= 0 && rows[cursor].entries === 0) cursor -= 1
  while (cursor >= 0 && rows[cursor].entries > 0) {
    streak += 1
    cursor -= 1
  }

  return {
    days: rows,
    total,
    streak,
    completed: rows.filter((row) => row.done).length,
    recorded: rows.filter((row) => row.entries > 0).length,
    missing: rows.filter((row) => row.entries === 0).map((row) => row.date),
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const text = (value) => [{ type: 'text', text: value }]
const output = (render) => ({ schema: { type: 'object' }, render: (_args, value) => text(render(value)) })

const HEADER = '幸福课 · 三件好事'

function progressLine(entries) {
  const filled = Math.min(entries, SLOTS)
  return `${HEADER}：已记 ${entries}/${SLOTS}` + (entries >= SLOTS ? ' ✓ 今天完成' : filled === 0 ? '（还没开始）' : '')
}

const todayTool = {
  name: 'gratitude_today',
  description:
    '幸福课「三件好事」：确保今天（或指定日期）的记录文件存在，不存在就按模板创建，然后返回文件路径、当前已记几条、以及模板内容。调用它之后，用户口述三件事，再用 gratitude_add 逐条写入。',
  parameters: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: '日期，YYYY-MM-DD。省略表示今天。',
      },
    },
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  output: output((value) =>
    [
      value.summary,
      '',
      `文件：${value.file}`,
      '',
      '```markdown',
      value.content.trimEnd(),
      '```',
    ].join('\n'),
  ),
  async execute(args = {}) {
    const cfg = configRef
    const key = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : dayKey()
    const day = await ensureDay(cfg, key)
    const entries = readEntries(day.content)
    const summary = progressLine(entries.length) + (day.created ? '（今天新建了一份）' : '')
    return {
      date: day.key,
      weekday: weekdayOf(day.key),
      file: day.file,
      created: day.created,
      entries: entries.length,
      missing: Math.max(SLOTS - entries.length, 0),
      summary,
      content: day.content,
    }
  },
}

const addTool = {
  name: 'gratitude_add',
  description:
    '把一条「好事」写进今天（或指定日期）的记录文件：自动填到第一个还空着的编号下，三条都满了就追加。可选 why 说明这件事为什么会发生。写入前请先把用户的原话复述一遍确认。',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '这一件好事，一两句话，用用户自己的说法。' },
      why: { type: 'string', description: '可选：为什么它会发生在你身上。' },
      slot: { type: 'number', description: '可选：写到第几条（1~3）。省略就填第一个空位；指定的位置已经写过会报错，不会覆盖。' },
      date: { type: 'string', description: '日期 YYYY-MM-DD，省略表示今天。' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  output: output((value) => value.summary),
  async execute(args = {}) {
    const text_ = typeof args.text === 'string' ? args.text.trim() : ''
    if (text_ === '') throw new Error('text 不能为空')
    const key = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : dayKey()
    const cfg = configRef
    const result = await addEntry(cfg, { text: text_, why: args.why, key, slot: args.slot })
    const summary = [
      `第 ${result.slot} 条已写入 → ${result.file}`,
      progressLine(result.entries.length),
    ].join('\n')
    return {
      summary,
      date: result.key,
      file: result.file,
      slot: result.slot,
      entries: result.entries.length,
      entriesText: result.entries,
    }
  },
}

const reviewTool = {
  name: 'gratitude_review',
  description:
    '查看最近 N 天「三件好事」的记录情况：每天记了几条、连续多少天、哪几天空着。只读，不创建文件。',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', description: '往回看几天，默认 7，范围 1~120。' },
    },
    additionalProperties: false,
  },
  isConcurrencySafe: () => true,
  output: output((value) => value.summary),
  async execute(args = {}) {
    const cfg = configRef
    const result = await review(cfg, { days: args.days })
    const lines = [`最近 ${result.total} 天：记录 ${result.recorded} 天，写满三条 ${result.completed} 天，连续 ${result.streak} 天`]
    for (const row of result.days) {
      const mark = row.done ? '✓' : row.entries > 0 ? '·' : ' '
      lines.push(`${mark} ${row.date} ${row.weekday}　${row.entries}/${SLOTS}`)
    }
    if (result.missing.length) lines.push(`空着的：${result.missing.join('、')}`)
    return { ...result, summary: lines.join('\n') }
  },
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

let configRef = resolveConfig(undefined)

export function apply(ctx, config) {
  configRef = resolveConfig(config)
  ctx.effect(() => ctx.tools.register(todayTool))
  ctx.effect(() => ctx.tools.register(addTool))
  ctx.effect(() => ctx.tools.register(reviewTool))
}

export const __internal = { readEntries, fillSlot, fillWhy, renderTemplate, sectionRange }
