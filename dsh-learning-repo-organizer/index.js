/**
 * Host half of the Learning repos bundle.
 *
 * Three contributions share one resolved configuration:
 *  - the `learning-repo-organizer` skill from `skills/learning-repo-organizer/`
 *    (copied from the original skill folder; the original is never touched);
 *  - the `learning_repo_status` and `learning_repo_run_tests` tools;
 *  - an authenticated JSON route (`/learnrepo/api`) consumed by the Client
 *    dashboard registered in `client.js`.
 */
import { existsSync } from 'node:fs'
import { mkdir, open, readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from 'schemastery'

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = join(PACKAGE_ROOT, 'skills', 'learning-repo-organizer')
const SKILL_NAME = 'learning-repo-organizer'

const DEFAULT_LANGUAGES = {
  c: 'c',
  h: 'c',
  py: 'python',
  ino: 'arduino',
}

/** Files and folders never walked, counted, or scanned. */
const SKIP_NAMES = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  'build',
  '.pio',
])
const SKIP_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'zip', '7z', 'rar', 'gz',
  'exe', 'dll', 'o', 'obj', 'a', 'lib', 'pyc', 'class', 'jar', 'mp3', 'mp4', 'wav',
  'xlsx', 'xls', 'doc', 'docx', 'ppt', 'pptx', 'ttf', 'otf', 'woff', 'woff2',
])

const ASSIGN = String.raw`\s*[:=(]\s*`
const QUOTED_VALUE = String.raw`(['"]?)([^'"\s]{6,})\1`
const PRIVACY_RULES = [
  // Arduino and Python code often uses identifiers such as WiFi_SSID, so the
  // ssid rule matches the suffix instead of requiring a word boundary.
  { id: 'ssid', label: 'ssid', pattern: new RegExp(String.raw`(?:^|[^A-Za-z0-9])[A-Za-z0-9_]*(?:ssid|wifi_?name|wifi_?ssid)` + ASSIGN + String.raw`(['"]?)([^'"\s,;}{]{1,64})\1`, 'gim') },
  { id: 'wifiPassword', label: 'password', pattern: new RegExp(String.raw`[A-Za-z0-9_]{0,24}(?:pass(?:word|wd)?|pwd)` + ASSIGN + QUOTED_VALUE, 'gi') },
  { id: 'apiKey', label: 'api key', pattern: new RegExp(String.raw`[A-Za-z0-9_]{0,16}(?:api[_-]?key|apikey)` + ASSIGN + QUOTED_VALUE, 'gi') },
  { id: 'cookie', label: 'cookie', pattern: new RegExp(String.raw`[A-Za-z0-9_]{0,16}cookie` + ASSIGN + QUOTED_VALUE, 'gi') },
  { id: 'token', label: 'token', pattern: new RegExp(String.raw`[A-Za-z0-9_]{0,16}token` + ASSIGN + QUOTED_VALUE, 'gi') },
  { id: 'secret', label: 'secret', pattern: new RegExp(String.raw`[A-Za-z0-9_]{0,16}secret` + ASSIGN + QUOTED_VALUE, 'gi') },
  { id: 'credential', label: 'credential', pattern: new RegExp(String.raw`[A-Za-z0-9_]{0,16}credential` + ASSIGN + QUOTED_VALUE, 'gi') },
]
// Values that are clearly placeholders or code noise, not real credentials.
const PLACEHOLDER = String.raw`^(your[_<]|xxx+[<]?$|[<{[$]|\.\.\.|changeme|replace|todo|placeholder|example|none|null|undefined|nil|true|false|input|str\(|os\.|getenv|environ|\*+$)`

// ---------------------------------------------------------------------------
// configuration

function normalizeStringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim() !== '') : []
}

/** Merge the row config with the shipped defaults; every path is resolved absolute. */
export function resolveConfig(config) {
  const source = config && typeof config === 'object' ? config : {}
  const rawRepositories = Array.isArray(source.repositories) ? source.repositories : []
  const repositories = rawRepositories
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.path === 'string' && entry.path.trim() !== '')
    .map((entry, index) => {
      const id = typeof entry.id === 'string' && entry.id.trim() !== '' ? entry.id.trim() : `repo-${index + 1}`
      return {
        id,
        label: typeof entry.label === 'string' && entry.label.trim() !== '' ? entry.label : id,
        path: resolve(entry.path),
        remote: typeof entry.remote === 'string' ? entry.remote : '',
        languages: normalizeStringList(entry.languages),
      }
    })
  return {
    repositories,
    sourceDirectories: normalizeStringList(source.sourceDirectories).map((path) => resolve(path)),
    testTimeoutMs: Math.min(Math.max(Number(source.testTimeoutMs) || 30000, 1000), 300000),
  }
}

// ---------------------------------------------------------------------------
// scanning

function languageOf(name) {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return undefined
  return DEFAULT_LANGUAGES[name.slice(dot + 1).toLowerCase()]
}

function isSkipped(name) {
  const lower = name.toLowerCase()
  if (SKIP_NAMES.has(lower)) return true
  const dot = lower.lastIndexOf('.')
  return dot >= 0 && SKIP_EXTENSIONS.has(lower.slice(dot + 1))
}

async function readTextHead(file, limit = 120000) {
  let handle
  try {
    handle = await open(file, 'r')
    const buffer = Buffer.alloc(limit)
    const { bytesRead } = await handle.read(buffer, 0, limit, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    // A NUL byte in the head means binary content; skip it instead of scanning noise.
    return text.includes('\u0000') ? '' : text
  } catch {
    return ''
  } finally {
    await handle?.close().catch(() => {})
  }
}

function isPlaceholder(value) {
  const trimmed = value.trim().replace(/^["'`]+|["'`]+$/g, '')
  if (trimmed === '') return true
  if (new RegExp(PLACEHOLDER, 'i').test(trimmed)) return true
  return false
}

function scanTextForPrivacy(text) {
  const hits = []
  for (const rule of PRIVACY_RULES) {
    rule.pattern.lastIndex = 0
    for (const match of text.matchAll(rule.pattern)) {
      const value = match[2] ?? ''
      if (isPlaceholder(value)) continue
      const line = text.slice(0, match.index).split('\n').length
      hits.push({ rule: rule.id, label: rule.label, line, value: value.length > 40 ? `${value.slice(0, 40)}…` : value })
      if (hits.length >= 25) return hits
    }
  }
  return hits
}

function toPosix(value) {
  return value.split(sep).join('/')
}

async function readGitHead(path) {
  try {
    const head = (await readFile(join(path, '.git', 'HEAD'), 'utf8')).trim()
    return head.startsWith('ref: ') ? head.slice(5) : head
  } catch {
    return undefined
  }
}

/**
 * Read-only inventory of one repository: language files plus the tests/ folders
 * that `run_tests.py` understands.
 */
export async function scanRepository(repository) {
  const result = {
    id: repository.id,
    label: repository.label,
    path: repository.path,
    remote: repository.remote,
    exists: false,
    isGit: false,
    branch: undefined,
    files: [],
    fileCount: 0,
    languageCounts: {},
    languages: new Set(),
    dayFolders: [],
    testFiles: [],
    latest: undefined,
    latestMtime: undefined,
    privacyHits: [],
    untracked: 0,
    modified: 0,
    truncated: false,
    error: undefined,
  }
  let info
  try {
    info = await stat(repository.path)
  } catch (error) {
    result.error = error.code === 'ENOENT' ? 'missing' : String(error.message)
    return result
  }
  if (!info.isDirectory()) {
    result.error = 'not-a-directory'
    return result
  }
  result.exists = true
  result.isGit = existsSync(join(repository.path, '.git'))
  result.branch = result.isGit ? await readGitHead(repository.path) : undefined

  const known = new Set(repository.languages.length > 0 ? repository.languages : Object.values(DEFAULT_LANGUAGES))
  const dayFolders = new Set()
  const languages = new Set()
  const queue = [repository.path]
  let visited = 0
  const maxFiles = 20000

  while (queue.length > 0 && visited < maxFiles) {
    const current = queue.shift()
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const name = entry.name
      if (name.startsWith('.') && name !== '.gitignore' && name !== '.gitattributes') continue
      if (isSkipped(name)) continue
      const full = join(current, name)
      const rel = toPosix(relative(repository.path, full))
      if (entry.isDirectory()) {
        if (/^\d{6}$/.test(name) && dirname(full) === repository.path) dayFolders.add(name)
        queue.push(full)
        continue
      }
      if (!entry.isFile()) continue
      visited += 1
      if (visited > maxFiles) {
        result.truncated = true
        break
      }
      const depth = rel.split('/').length
      const language = languageOf(name)
      const parentIsTests = depth >= 2 && rel.split('/')[depth - 2] === 'tests'
      const isTestFile = depth >= 2 && parentIsTests && name.endsWith('.txt')
      const isCode = language !== undefined && known.has(language)
      if (!isCode && !isTestFile) {
        if (name === 'README.md' && depth === 1) {
          // Root README participates in the latest-change summary only.
        } else {
          continue
        }
      }
      if (isCode) {
        languages.add(language)
        result.languageCounts[language] = (result.languageCounts[language] ?? 0) + 1
      }
      let mtime = 0
      try {
        mtime = (await stat(full)).mtimeMs
      } catch {
        continue
      }
      const record = {
        path: rel,
        name,
        language: language ?? 'test',
        mtime,
        isTest: isTestFile && !isCode,
      }
      if (isTestFile) {
        const base = rel.slice(0, -4)
        // run_tests.py looks for the program beside the tests/ folder.
        const programFolder = programFolderOf(`${repository.path}/${rel}`)
        const stemName = base.split('/').pop()
        const hasProgram = ['.c', '.py', '.ino'].some((ext) => existsSync(join(programFolder, `${stemName}${ext}`)))
        result.testFiles.push({ path: rel, program: hasProgram })
      }
      if (isCode) {
        result.files.push(record)
        if (result.latestMtime === undefined || mtime > result.latestMtime) {
          result.latestMtime = mtime
          result.latest = { path: rel, name, mtime }
        }
      }
    }
  }

  result.dayFolders = [...dayFolders].sort().reverse()
  result.languages = [...languages].sort()
  result.fileCount = result.files.length
  result.files.sort((a, b) => b.mtime - a.mtime)
  result.files = result.files.slice(0, 60)

  const textExtensions = new Set(['c', 'h', 'py', 'ino', 'txt', 'md', 'json', 'js', 'ts', 'env', 'yml', 'yaml', 'ini', 'cfg', 'conf'])
  for (const record of result.files.slice(0, 400)) {
    const extension = record.name.slice(record.name.lastIndexOf('.') + 1).toLowerCase()
    if (!textExtensions.has(extension)) continue
    const text = await readTextHead(join(repository.path, record.path))
    if (text === '') continue
    for (const hit of scanTextForPrivacy(text)) {
      result.privacyHits.push({ path: record.path, ...hit })
    }
    if (result.privacyHits.length >= 25) break
  }

  if (result.isGit) {
    try {
      const index = await readFile(join(repository.path, '.git', 'index'))
      result.modified = Math.max(0, index.readUInt32BE(8) - 1)
    } catch {
      result.modified = 0
    }
  }
  return result
}

function publicRepo(scan) {
  return {
    id: scan.id,
    label: scan.label,
    path: scan.path,
    remote: scan.remote,
    exists: scan.exists,
    isGit: scan.isGit,
    branch: scan.branch,
    error: scan.error,
    fileCount: scan.fileCount,
    truncated: scan.truncated,
    languageCounts: scan.languageCounts,
    languages: scan.languages,
    dayFolders: scan.dayFolders.slice(0, 40),
    testFiles: scan.testFiles.length,
    testsWithoutProgram: scan.testFiles.filter((file) => !file.program).length,
    latest: scan.latest ?? null,
    files: scan.files.slice(0, 12).map((file) => ({ path: file.path, language: file.language, mtime: file.mtime })),
    privacyHits: scan.privacyHits,
    untracked: 0,
    tracked: scan.modified,
  }
}

// ---------------------------------------------------------------------------
// test runner (the same contract as scripts/run_tests.py)

function parseCases(text) {
  const cases = []
  let current = null
  let section = null
  for (const line of text.split(/\r?\n/)) {
    if (line === 'input:') {
      if (current !== null) cases.push(current)
      current = { input: [], output: [] }
      section = 'input'
    } else if (line === 'output:') {
      section = 'output'
    } else if (line === '---') {
      section = null
    } else if (current !== null && section !== null) {
      current[section].push(line)
    }
  }
  if (current !== null) cases.push(current)
  return cases
}

function normalizeOutput(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim()
}

function findPython() {
  const envValue = process.env.PYTHON
  if (envValue && envValue.trim() !== '') return envValue
  return process.platform === 'win32' ? 'python' : 'python3'
}

const OUTPUT_LIMIT = 512 * 1024

/**
 * Run one command through the Host subprocess service, waiting for its exit and
 * reading the collected output. `subprocess` is required for this to be used;
 * without it the caller returns a clear diagnostic instead of guessing.
 */
async function runCommand(subprocess, spec, { cwd, stdin, timeoutMs }) {
  const handle = subprocess.spawn({
    argv: spec,
    cwd,
    stdio: {
      stdin: stdin === undefined ? 'ignore' : { data: stdin },
      stdout: { maxBytes: OUTPUT_LIMIT },
      stderr: { maxBytes: OUTPUT_LIMIT },
    },
    graceMs: 2000,
  })
  let timer
  let timedOut = false
  const timeout = new Promise((resolveTimeout) => {
    timer = setTimeout(() => {
      timedOut = true
      handle.terminate()
      resolveTimeout(undefined)
    }, timeoutMs)
  })
  let outcome
  try {
    outcome = await Promise.race([handle.done, timeout])
  } finally {
    clearTimeout(timer)
  }
  const read = (reader) => {
    if (reader === undefined) return ''
    try {
      return reader.readFrom(0).text
    } catch {
      return ''
    }
  }
  if (timedOut) {
    await handle.waitForExit().catch(() => {})
  }
  return {
    exitCode: outcome?.exitCode ?? null,
    timedOut,
    stdout: read(handle.collected.stdout),
    stderr: read(handle.collected.stderr),
  }
}

async function listTestFiles(root, filter) {
  const found = []
  async function walk(current) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === '.git') continue
      const full = join(current, entry.name)
      if (entry.name === 'tests') {
        const parent = dirname(full)
        let files = []
        try {
          files = (await readdir(full, { withFileTypes: true })).filter((file) => file.isFile() && file.name.endsWith('.txt'))
        } catch {
          continue
        }
        for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
          const rel = toPosix(relative(root, join(full, file.name)))
          if (filter !== '' && !rel.startsWith(filter)) continue
          const programFolder = programFolderOf(join(full, file.name))
          const stem = file.name.slice(0, -4)
          const program = ['.c', '.py', '.ino']
            .map((ext) => join(programFolder, `${stem}${ext}`))
            .find((candidate) => existsSync(candidate))
          found.push({ rel, testFile: join(full, file.name), program })
        }
        continue
      }
      await walk(full)
    }
  }
  await walk(root)
  return found.sort((a, b) => a.rel.localeCompare(b.rel))
}

// "C:/repo/261016/tests/char_shift.txt" has the test's parent folder
// (".../261016") as its program folder. Never compare against "tests".
function programFolderOf(testPath) {
  const normalized = testPath.split('\\').join('/')
  const segments = normalized.split('/')
  let index = segments.length - 3
  if (segments[index] === 'tests') index -= 1
  return toPosix(segments.slice(0, index + 1).join('/'))
}

/**
 * Run the `tests/<program>.txt` cases of one repository. Mirrors
 * `scripts/run_tests.py`: one case per `input:`/`output:` block, trailing
 * whitespace normalized, C programs compiled with `-Wall -Wextra -lm`.
 *
 * `subprocess` is the Host subprocess service; every child process goes
 * through it so the profile's own containment and teardown apply.
 */
export async function runRepositoryTests(subprocess, repository, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000
  const filter = typeof options.filter === 'string' ? options.filter.replace(/\\/g, '/') : ''
  const limit = Math.min(Math.max(Number(options.limit) || 40, 1), 200)
  if (subprocess === undefined) {
    return {
      repository: repository.id,
      label: repository.label,
      path: repository.path,
      status: 'unavailable',
      error: 'The Host subprocess service is not mounted in this profile, so tests cannot run.',
      cases: [],
      passed: 0,
      failed: 0,
      skipped: 0,
      output: '',
    }
  }
  const info = await stat(repository.path).catch(() => undefined)
  if (info === undefined || !info.isDirectory()) {
    return { repository: repository.id, label: repository.label, path: repository.path, status: 'missing', cases: [], passed: 0, failed: 0, skipped: 0, output: '' }
  }
  const python = findPython()
  const testFiles = await listTestFiles(repository.path, filter)
  const cases = []
  let passed = 0
  let failed = 0
  let skipped = 0
  const workDirBase = join(repository.path, '.learnrepo-tmp')
  await mkdir(workDirBase, { recursive: true }).catch(() => {})

  try {
    for (const entry of testFiles) {
      if (cases.length >= limit) {
        skipped += 1
        continue
      }
      if (entry.program === undefined) {
        cases.push({ test: entry.rel, status: 'skip', reason: 'no matching program' })
        skipped += 1
        continue
      }
      let text = ''
      try {
        text = await readFile(entry.testFile, 'utf8')
      } catch (error) {
        cases.push({ test: entry.rel, status: 'fail', expected: '', actual: String(error.message) })
        failed += 1
        continue
      }
      const parsed = parseCases(text)
      let command
      if (entry.program.endsWith('.c')) {
        const safeName = `${repository.id}-${entry.rel.replace(/[^a-zA-Z0-9]+/g, '_')}`
        const exe = join(workDirBase, `${safeName}.exe`)
        const compiled = await runCommand(subprocess, ['gcc', '-std=c11', '-Wall', '-Wextra', '-o', exe, entry.program, '-lm'], {
          cwd: repository.path,
          timeoutMs,
        }).catch((error) => ({ exitCode: 1, stderr: String(error?.message ?? error) }))
        if (compiled.exitCode !== 0 || compiled.timedOut === true) {
          cases.push({ test: entry.rel, status: 'fail', reason: 'compile failed', expected: '', actual: compiled.stderr.slice(0, 4000) })
          failed += parsed.length || 1
          continue
        }
        command = { file: exe, python: false }
      } else if (entry.program.endsWith('.py')) {
        // 子进程经管道拿不到控制台编码，Windows 下 Python 默认按 cp936 输出，
        // 中文会变成乱码、与被记录的 UTF-8 期望值对不上。`-X utf8` 直接把
        // stdio 切到 UTF-8，不依赖环境变量，是最稳的做法。
        // PYTHONHASHSEED 无法用命令行开关设定，只能靠环境变量，用于固定
        // set 的迭代顺序（部分用例会打印 set，顺序随机就会间歇性失败）。
        if (process.env.PYTHONHASHSEED === undefined) process.env.PYTHONHASHSEED = '0'
        if (process.env.PYTHONIOENCODING === undefined) process.env.PYTHONIOENCODING = 'utf-8'
        command = { file: python, args: ['-X', 'utf8', entry.program], python: true }
      } else {
        cases.push({ test: entry.rel, status: 'skip', reason: 'Arduino sketch has no host runner' })
        skipped += 1
        continue
      }
      for (const [index, testCase] of parsed.entries()) {
        if (cases.length >= limit) {
          skipped += 1
          continue
        }
        const stdinText = testCase.input.length > 0 ? `${testCase.input.join('\n')}\n` : ''
        const expected = testCase.output.join('\n')
        const argv = command.python ? [command.file, ...command.args] : [command.file]
        const run = await runCommand(subprocess, argv, { cwd: repository.path, stdin: stdinText, timeoutMs })
        let actual = run.stdout
        if (!run.timedOut && run.exitCode !== 0 && run.stderr.trim() !== '') {
          actual = `${actual}\n[stderr]\n${run.stderr.slice(0, 2000)}`
        }
        if (run.timedOut) actual = '<timeout>'
        const ok = !run.timedOut && normalizeOutput(actual) === normalizeOutput(expected)
        if (ok) passed += 1
        else failed += 1
        cases.push({
          test: entry.rel,
          case: index + 1,
          program: toPosix(relative(repository.path, entry.program)),
          status: ok ? 'pass' : 'fail',
          expected: expected.slice(0, 4000),
          actual: actual.slice(0, 4000),
        })
      }
    }
  } finally {
    await rm(workDirBase, { recursive: true, force: true }).catch(() => {})
  }

  const summary = `${passed} passed, ${failed} failed${skipped > 0 ? `, ${skipped} skipped` : ''}`
  return {
    repository: repository.id,
    label: repository.label,
    path: repository.path,
    status: failed > 0 ? 'failed' : 'passed',
    passed,
    failed,
    skipped,
    summary,
    cases,
    truncated: cases.length >= limit && testFiles.length > cases.length,
    output: `${repository.label}: ${summary}`,
  }
}

// ---------------------------------------------------------------------------
// status snapshot for the tool and the dashboard

async function buildStatus(cfg, subprocess, options = {}) {
  const repositories = []
  for (const repository of cfg.repositories) {
    const scan = await scanRepository(repository)
    const entry = publicRepo(scan)
    if (options.runTests && scan.exists && scan.testFiles.length > 0) {
      entry.tests = await runRepositoryTests(subprocess, repository, { timeoutMs: cfg.testTimeoutMs, limit: options.testLimit ?? 40 })
    }
    repositories.push(entry)
  }
  const sources = []
  for (const path of cfg.sourceDirectories) {
    const info = await stat(path).catch(() => undefined)
    sources.push({ path, exists: info?.isDirectory() === true })
  }
  return {
    scannedAt: new Date().toISOString(),
    repositories,
    sources,
    skill: { name: SKILL_NAME, installed: true, path: SKILL_DIR },
    testTimeoutMs: cfg.testTimeoutMs,
  }
}

// ---------------------------------------------------------------------------
// skill

function parseFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (match === null) return { data: {}, body: text }
  const data = {}
  const lines = match[1].split(/\r?\n/)
  let currentKey
  for (const line of lines) {
    const keyMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (keyMatch !== null) {
      currentKey = keyMatch[1]
      data[currentKey] = keyMatch[2].replace(/^["']|["']$/g, '')
      continue
    }
    if (currentKey !== undefined && /^\s+/.test(line)) {
      data[currentKey] = `${data[currentKey]} ${line.trim()}`.trim()
    }
  }
  return { data, body: text.slice(match[0].length) }
}

async function loadSkill() {
  const file = join(SKILL_DIR, 'SKILL.md')
  const raw = await readFile(file, 'utf8')
  const { data, body } = parseFrontMatter(raw)
  const resourceNote = [
    '',
    '---',
    '',
    '## 插件资源',
    '',
    `这个技能由 DSH 插件 \`dsh-learning-repo-organizer\` 内置，原始目录在 \`${SKILL_DIR}\`。`,
    '按 `SKILL.md` 里的相对路径读取：`references/c.md`、`references/python.md`、`references/arduino.md`、`scripts/run_tests.py`。',
    '也可以调用插件工具 `learning_repo_status`（扫描仓库、隐私检查、汇总统计）和 `learning_repo_run_tests`（运行 tests/ 下的期望输出测试），它们与 `run_tests.py` 的规则一致。',
    '',
  ].join('\n')
  return {
    name: typeof data.name === 'string' && data.name.trim() !== '' ? data.name.trim() : SKILL_NAME,
    description: typeof data.description === 'string' && data.description.trim() !== ''
      ? data.description.trim()
      : '整理学习代码仓库（C、Python、Arduino）',
    content: `${body.trimEnd()}\n${resourceNote}`,
    invocation: { modelInvocable: true, userInvocable: true },
    metadata: {
      origin: 'dsh-learning-repo-organizer',
      skillDir: SKILL_DIR,
      files: ['SKILL.md', 'references/c.md', 'references/python.md', 'references/arduino.md', 'scripts/run_tests.py'],
    },
  }
}

async function registerSkill(ctx) {
  const skills = ctx.get('skills')
  if (skills === undefined) return
  let skill
  try {
    skill = await loadSkill()
  } catch {
    return
  }
  ctx.effect(() => skills.register(skill), 'learning-repo-organizer: embedded skill')
}

// ---------------------------------------------------------------------------
// tools

// `parameters` is the author-facing property map (one value schema per
// argument, `required: true` on the entry), not a raw JSON Schema object: the
// Host compiles it into the object schema it validates model arguments against.
const STATUS_PARAMETERS = {
  repository: {
    type: 'string',
    description: 'Repository id or label (c, python, arduino). Omit to scan every configured repository.',
  },
  runTests: {
    type: 'boolean',
    description: 'Also run the tests/ sample-output cases. Defaults to false.',
  },
  testLimit: {
    type: 'number',
    description: 'Maximum test cases to run per repository when runTests is true (default 40, max 200).',
  },
}

const TESTS_PARAMETERS = {
  repository: {
    type: 'string',
    required: true,
    description: 'Repository id or label (c, python, arduino). Required.',
  },
  filter: {
    type: 'string',
    description: 'Only run test files whose path starts with this prefix, such as 261108.',
  },
  limit: {
    type: 'number',
    description: 'Maximum test cases to run (default 40, max 200).',
  },
}

// Output contracts. The registry validates every tool value against its
// `output.schema` before rendering, so these must describe the exact snapshot
// shapes: the top-level fields are required, per-repository and per-case
// details stay open (additionalProperties) because they vary by repository and
// by whether tests ran.
const STATUS_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    scannedAt: { type: 'string' },
    repositories: { type: 'array', items: { type: 'object', additionalProperties: true } },
    sources: { type: 'array', items: { type: 'object', additionalProperties: true } },
    skill: { type: 'object', additionalProperties: true },
    testTimeoutMs: { type: 'number' },
  },
  required: ['scannedAt', 'repositories', 'sources', 'skill', 'testTimeoutMs'],
}

const TESTS_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    repository: { type: 'string' },
    label: { type: 'string' },
    path: { type: 'string' },
    status: { type: 'string', enum: ['passed', 'failed', 'missing', 'unavailable'] },
    summary: { type: 'string' },
    passed: { type: 'integer' },
    failed: { type: 'integer' },
    skipped: { type: 'integer' },
    truncated: { type: 'boolean' },
    output: { type: 'string' },
    cases: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
  required: ['repository', 'label', 'path', 'status', 'passed', 'failed', 'skipped', 'cases', 'output'],
}

function pickRepository(cfg, query) {
  if (typeof query !== 'string' || query.trim() === '') return undefined
  const needle = query.trim().toLowerCase()
  return cfg.repositories.find((repository) => repository.id.toLowerCase() === needle || repository.label.toLowerCase() === needle)
}

/**
 * The tool registry requires every result to be lossless JSON: an `undefined`
 * property makes the whole value invalid. A JSON round-trip drops those keys
 * (scan snapshots carry optional `branch`/`error`/`latest` fields).
 */
function jsonValue(value) {
  return JSON.parse(JSON.stringify(value))
}

/** Project a plain string as the model-facing content blocks of one tool result. */
function textBlocks(text) {
  return [{ type: 'text', text }]
}

/** Build the human-readable test report shared by the tool result and the error path. */
function formatTestReport(result) {
  const lines = [`${result.label}: ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped`]
  for (const testCase of result.cases) {
    const name = testCase.case === undefined ? testCase.test : `${testCase.test} #${testCase.case}`
    if (testCase.status === 'pass') lines.push(`PASS  ${name}`)
    else if (testCase.status === 'skip') lines.push(`SKIP  ${name}  (${testCase.reason ?? ''})`)
    else {
      lines.push(`FAIL  ${name}${testCase.reason !== undefined ? `  (${testCase.reason})` : ''}`)
      if (testCase.expected !== undefined && testCase.expected !== '') lines.push(`      expected: ${testCase.expected}`)
      if (testCase.actual !== undefined && testCase.actual !== '') lines.push(`      actual:   ${testCase.actual}`)
    }
  }
  return lines.join('\n')
}

// `Schema` arrives as a runtime object (z); without an annotation its shorthand
// methods (`Schema`, `natural()`, `.default()`) are not callable.
export const Config = Schema.object({
  repositories: Schema.array(Schema.object({
    id: Schema.string(),
    label: Schema.string().default(''),
    path: Schema.string().required(),
    remote: Schema.string().default(''),
    languages: Schema.array(Schema.string()).default([]),
  })).default([]),
  sourceDirectories: Schema.array(Schema.string()).default([]),
  testTimeoutMs: Schema.natural().min(1000).max(300000).default(30000),
  dashboardPath: Schema.string().default('/learnrepo'),
})

export const inject = ['skills', 'webServer']

export async function apply(ctx, config) {
  const cfg = resolveConfig(config)
  const dashboardPath = typeof config?.dashboardPath === 'string' && config.dashboardPath.startsWith('/')
    ? config.dashboardPath.replace(/\/+$/, '') || '/learnrepo'
    : '/learnrepo'
  const subprocess = ctx.get('subprocess')

  await registerSkill(ctx, cfg)

  // Tools ---------------------------------------------------------------
  // Read services through ctx.get(): a service not declared in inject is not
  // available as a property on this context's proxy.
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    ctx.effect(() => tools.register({
      name: 'learning_repo_status',
      description: 'Scan the configured learning repositories (C, Python, Arduino): language files, date folders, tests/ expectations, the latest change, and a privacy scan for credentials. With runTests, also runs the sample-output cases. Read-only.',
      parameters: STATUS_PARAMETERS,
      output: {
        schema: STATUS_OUTPUT_SCHEMA,
        render: (_args, value) => textBlocks(JSON.stringify(value, null, 2)),
      },
      async execute(args = {}, exec) {
        const signal = exec?.signal
        const wanted = pickRepository(cfg, args.repository)
        if (args.repository !== undefined && wanted === undefined) {
          throw new Error(`Unknown repository "${args.repository}". Configured: ${cfg.repositories.map((repository) => repository.id).join(', ') || '(none)'}`)
        }
        const subset = { ...cfg, repositories: wanted === undefined ? cfg.repositories : [wanted] }
        const status = await buildStatus(subset, subprocess, { runTests: args.runTests === true, testLimit: args.testLimit })
        if (signal?.aborted) throw new Error('Cancelled')
        return jsonValue(status)
      },
    }), 'learning-repo-organizer: status tool')

    ctx.effect(() => tools.register({
      name: 'learning_repo_run_tests',
      description: 'Run the tests/<program>.txt expected-output cases of one learning repository, using the same rules as scripts/run_tests.py (C compiled with gcc -std=c11 -Wall -Wextra -lm; Python with PYTHONHASHSEED=0 and PYTHONIOENCODING=utf-8; trailing whitespace normalized). Returns every case with pass/fail and the diff.',
      parameters: TESTS_PARAMETERS,
      output: {
        schema: TESTS_OUTPUT_SCHEMA,
        render: (_args, value) => textBlocks(formatTestReport(value)),
      },
      async execute(args = {}) {
        const repository = pickRepository(cfg, args.repository)
        if (repository === undefined) {
          throw new Error(`Unknown repository "${args.repository}". Configured: ${cfg.repositories.map((item) => item.id).join(', ') || '(none)'}`)
        }
        const result = await runRepositoryTests(subprocess, repository, { timeoutMs: cfg.testTimeoutMs, filter: args.filter, limit: args.limit })
        if (result.status === 'missing') throw new Error(`Repository folder not found: ${repository.path}`)
        if (result.status === 'unavailable') throw new Error(result.error)
        // A failed case run keeps the old behaviour: the report travels as the
        // error message so the result still shows up as a failure to the model.
        if (result.failed > 0) throw new Error(formatTestReport(result))
        return jsonValue(result)
      },
    }), 'learning-repo-organizer: test tool')
  }

  // Dashboard route ------------------------------------------------------
  const webServer = ctx.get('webServer')
  let connection
  try {
    connection = ctx.get('connection')
  } catch {
    connection = undefined
  }
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: `${dashboardPath}/api`,
      resource: async (request) => {
        if (connection !== undefined) {
          const admission = connection.admit(request)
          if (admission.rejection !== undefined) {
            return new Response(JSON.stringify({ error: 'unauthorized' }), { status: admission.rejection, headers: { 'content-type': 'application/json' } })
          }
        }
        if (request.method !== 'GET') {
          return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { 'content-type': 'application/json' } })
        }
        const url = new URL(request.url)
        try {
          if (url.searchParams.get('skill') === '1') {
            const skill = await loadSkill()
            return Response.json({ name: skill.name, description: skill.description, path: join(SKILL_DIR, 'SKILL.md'), resourceBase: SKILL_DIR })
          }
          const status = await buildStatus(cfg, subprocess)
          return Response.json({ dashboardPath, ...status })
        } catch (error) {
          return new Response(JSON.stringify({ error: String(error?.message ?? error) }), { status: 500, headers: { 'content-type': 'application/json' } })
        }
      },
    }), 'learning-repo-organizer: dashboard api')
  }
}

// Exposed for local checks only; not part of the plugin contract.
export const __internal = { parseCases, normalizeOutput, scanTextForPrivacy, parseFrontMatter, isPlaceholder, loadSkill }
