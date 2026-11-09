import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolveConfig, runRepositoryTests, scanRepository } from '../index.js'

// Local runner smoke test: a throwaway fixture, then remove it. Needs a Host
// subprocess service; pass a small adapter over node:child_process as argv[2].
const root = join(tmpdir(), `lro-smoke-${process.pid}`)
await mkdir(join(root, 'tests'), { recursive: true })
await writeFile(join(root, 'tests', 'm.py'), "import sys\nprint(int(sys.stdin.read().split()[0]) + 1)\n")
await writeFile(join(root, 'tests', 'm.txt'), 'input:\n1\noutput:\n2\n')
const c = resolveConfig({ repositories: [{ id: 'smoke', path: root, languages: ['python'] }] })
const scan = await scanRepository(c.repositories[0])
console.log('scan:', JSON.stringify({ files: scan.fileCount, ways: scan.dayFolders, tests: scan.testFiles }))

const { spawn } = await import('node:child_process')
const subprocess = {
  spawn({ argv, cwd, stdio }) {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (typeof stdio.stdin === 'object') child.stdin.end(stdio.stdin.data)
    else child.stdin.end()
    const chunksOut = []
    const chunksErr = []
    child.stdout.on('data', (chunk) => chunksOut.push(chunk))
    child.stderr.on('data', (chunk) => chunksErr.push(chunk))
    const reader = (chunks) => ({ readFrom: () => ({ text: Buffer.concat(chunks).toString('utf8'), nextOffset: 0, lossy: false }) })
    const done = new Promise((resolve) => child.on('close', (code) => resolve({ exitCode: code, signal: null })))
    return {
      done,
      collected: { stdout: reader(chunksOut), stderr: reader(chunksErr) },
      terminate: () => child.kill(),
      waitForExit: () => done.then(() => true),
    }
  },
}
const result = await runRepositoryTests(subprocess, c.repositories[0], { timeoutMs: 5000 })
console.log('tests:', result.status, result.passed, result.failed, JSON.stringify(result.cases.map((item) => [item.test, item.status, item.reason, item.actual?.slice(0, 200)])))
const result2 = await runRepositoryTests(subprocess, c.repositories[0], { timeoutMs: 5000 })
console.log('again:', result2.status, result2.passed, result2.failed)
await rm(root, { recursive: true, force: true })
console.log('fixture removed from', root)
