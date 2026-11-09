// 自检：不碰真实数据目录，全部在临时目录里跑。
// 用法：node scripts/selftest.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  addEntry,
  dayFile,
  dayKey,
  ensureDay,
  fillSlot,
  fillWhy,
  readEntries,
  renderTemplate,
  resolveConfig,
  review,
  weekdayOf,
} from '../index.js'

const results = []
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gratitude-selftest-'))
const cfg = { dataDir: dir }

function check(name, fn) {
  try {
    fn()
    results.push(`PASS  ${name}`)
  } catch (error) {
    results.push(`FAIL  ${name}\n      ${error.message}`)
    process.exitCode = 1
  }
}

// 1. 日期
check('dayKey 用本地日期补零', () => {
  assert.equal(dayKey(new Date(2026, 10, 9)), '2026-11-09')
  assert.equal(dayKey(new Date(2026, 0, 1)), '2026-01-01')
})

check('weekdayOf 对得上星期', () => {
  assert.equal(weekdayOf('2026-11-09'), '星期一')
  assert.equal(weekdayOf('2026-11-08'), '星期日')
})

check('dayFile 按月分文件夹', () => {
  const file = dayFile('D:\\x', '2026-11-09')
  assert.equal(file, path.join('D:\\x', '2026-11', '2026-11-09.md'))
})

// 2. 模板
check('模板含三段标题和三个空槽', () => {
  const content = renderTemplate('2026-11-09')
  assert.match(content, /## 三件好事/)
  assert.match(content, /## 为什么它们会发生/)
  assert.match(content, /^1\. $/m)
  assert.equal(readEntries(content).length, 0)
})

// 3. 填槽
check('依次填 1、2、3，然后追加第 4 条', () => {
  let content = renderTemplate('2026-11-09')
  const a = fillSlot(content, '第一件')
  assert.equal(a.slot, 1)
  content = a.content
  const b = fillSlot(content, '第二件')
  assert.equal(b.slot, 2)
  content = b.content
  const c = fillSlot(content, '第三件')
  assert.equal(c.slot, 3)
  content = c.content
  assert.deepEqual(readEntries(content), ['第一件', '第二件', '第三件'])
  const d = fillSlot(content, '第四件')
  assert.equal(d.slot, 4)
  assert.deepEqual(readEntries(d.content), ['第一件', '第二件', '第三件', '第四件'])
})

check('指定编号写入：第 3 条就是第 3 条', () => {
  let content = renderTemplate('2026-11-09')
  content = fillSlot(content, '一').content
  const third = fillSlot(content, '三', 3)
  assert.equal(third.slot, 3)
  assert.match(third.content, /^3\. 三$/m)
  const second = fillSlot(third.content, '二', 2)
  assert.equal(second.slot, 2)
  assert.deepEqual(readEntries(second.content), ['一', '二', '三'])
})

check('指定的位置已经写过就报错，不覆盖', () => {
  const content = fillSlot(renderTemplate('2026-11-09'), '一').content
  const again = fillSlot(content, '重复', 1)
  assert.ok(again.error)
  assert.match(again.error, /已经写了/)
})

check('fillWhy 挂在「为什么」段里', () => {
  const content = fillWhy(renderTemplate('2026-11-09'), 2, '因为我提前准备了')
  assert.match(content, /- 第 2 条：因为我提前准备了/)
})

// 4. 落盘
await (async () => {
  try {
    const key = '2026-11-09'
    const first = await ensureDay(cfg, key)
    assert.equal(first.created, true)
    const second = await ensureDay(cfg, key)
    assert.equal(second.created, false)
    results.push('PASS  ensureDay 首次创建、二次读取')
  } catch (error) {
    results.push(`FAIL  ensureDay 首次创建、二次读取\n      ${error.message}`)
    process.exitCode = 1
  }
})()

await (async () => {
  try {
    const key = '2026-11-09'
    await addEntry(cfg, { text: '室友带了饭', key })
    const withWhy = await addEntry(cfg, { text: '实验跑通了', why: '问了三个人', key })
    assert.equal(withWhy.slot, 2)
    assert.equal(withWhy.entries.length, 2)
    const content = await fs.readFile(dayFile(dir, key), 'utf8')
    assert.match(content, /1\. 室友带了饭/)
    assert.match(content, /2\. 实验跑通了/)
    assert.match(content, /- 第 2 条：问了三个人/)
    results.push('PASS  addEntry 写入文件并带上 why')
  } catch (error) {
    results.push(`FAIL  addEntry 写入文件并带上 why\n      ${error.message}`)
    process.exitCode = 1
  }
})()

await (async () => {
  try {
    const today = await review(cfg, { days: 3, key: '2026-11-10' })
    assert.equal(today.total, 3)
    assert.equal(today.days.at(-1).date, '2026-11-10')
    // 11-10 与 11-09 都算有记录的前提是 11-09 有两条、11-10 没有 → 连续从昨天算 1 天
    assert.equal(today.streak >= 1, true)
    assert.equal(today.missing.length >= 1, true)
    results.push('PASS  review 统计窗口与空缺')
  } catch (error) {
    results.push(`FAIL  review 统计窗口与空缺\n      ${error.message}`)
    process.exitCode = 1
  }
})()

await (async () => {
  try {
    const cfg2 = resolveConfig({ dataDir: '  ' })
    assert.equal(cfg2.dataDir, 'D:\\02ai_practice\\幸福课')
    const cfg3 = resolveConfig({ dataDir: 'E:\\日记' })
    assert.equal(cfg3.dataDir, 'E:\\日记')
    results.push('PASS  resolveConfig 空白走默认、自定义生效')
  } catch (error) {
    results.push(`FAIL  resolveConfig 空白走默认、自定义生效\n      ${error.message}`)
    process.exitCode = 1
  }
})()

await fs.rm(dir, { recursive: true, force: true })

console.log(results.filter(Boolean).join('\n'))
const failed = results.filter((line) => line.startsWith('FAIL')).length
console.log(`\n${results.length} 项：${results.length - failed} 通过，${failed} 失败`)
