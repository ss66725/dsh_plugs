// Verifies the plugin against DSH's real tool-output contract: the schema
// subset assertion, value validation, and the render projection. Run it after
// touching either tool registration or a DSH upgrade:
//
//   node scripts/verify-output-contract.mjs
//
// It imports the bundled plugin and the installed @deepseek-ai/dsh-tools, so a
// failure here is the same class of failure the Host reports as "tool ... must
// declare output { schema, render, presentationMeta? }".
import { register } from 'node:module'

register(new URL('./selftest-loader.mjs', import.meta.url))

const DSH_TOOLS_FALLBACK = 'file:///C:/Users/Thinkpad/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'

async function loadDshTools() {
  try {
    return await import('@deepseek-ai/dsh-tools')
  } catch {
    return await import(DSH_TOOLS_FALLBACK)
  }
}

const { assertSupportedJsonSchema, validateArgs, validateJsonSchemaValue } = await loadDshTools()
const { apply } = await import('../index.js')

const failures = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(name)
}

const services = {
  skills: { register: () => () => {} },
  webServer: { register: () => () => {} },
  connection: undefined,
}
const makeCtx = (capture, subprocess) => ({
  get: (name) => (name === 'tools' ? { register: (definition) => { capture.push(definition); return () => {} } } : name === 'subprocess' ? subprocess : services[name]),
  effect: (callback) => { const dispose = callback(); return typeof dispose === 'function' ? dispose : () => {} },
})

const config = {
  repositories: [
    { id: 'c', label: 'C', path: 'D:\\nope-not-a-real-folder', languages: ['c'] },
    { id: 'py', label: 'Python', path: 'D:\\nope-either', languages: ['python'] },
  ],
  sourceDirectories: ['D:\\nope-source'],
}

const captured = []
await apply(makeCtx(captured, undefined), config)
check('two tools registered', captured.length === 2, String(captured.length))

for (const definition of captured) {
  check(`${definition.name}: render is a function`, typeof definition.output?.render === 'function')
  let ok = true
  try {
    assertSupportedJsonSchema(definition.output.schema)
  } catch (error) {
    ok = false
    check(`${definition.name}: schema in supported subset`, false, error.message)
  }
  if (ok) check(`${definition.name}: schema in supported subset`, true)
}

const byName = new Map(captured.map((definition) => [definition.name, definition]))

// Arguments validate at call time, so the parameter schemas must survive the
// same subset conversion the Host applies to model arguments.
check('status: parameters accept {}', validateArgs(byName.get('learning_repo_status').parameters, {}).length === 0)
check('status: parameters accept a repository', validateArgs(byName.get('learning_repo_status').parameters, { repository: 'c', runTests: true }).length === 0)
check('run_tests: parameters accept a repository', validateArgs(byName.get('learning_repo_run_tests').parameters, { repository: 'c' }).length === 0)
check('run_tests: parameters reject empty input', validateArgs(byName.get('learning_repo_run_tests').parameters, {}).length > 0)

// status: the value must validate and render back to the same JSON.
const statusTool = byName.get('learning_repo_status')
const statusValue = await statusTool.execute({}, { signal: undefined })
const statusViolations = validateJsonSchemaValue(statusTool.output.schema, statusValue, 'value')
check('status: value validates', statusViolations.length === 0, statusViolations.join('; '))
const statusBlocks = statusTool.output.render({}, statusValue)
check('status: render returns one text block', Array.isArray(statusBlocks) && statusBlocks.length === 1 && statusBlocks[0].type === 'text' && statusBlocks[0].text.startsWith('{'))
check('status: render parses back to the value', JSON.stringify(JSON.parse(statusBlocks[0].text)) === JSON.stringify(statusValue))

let unknownThrew = false
try { await statusTool.execute({ repository: 'nope' }, { signal: undefined }) } catch { unknownThrew = true }
check('status: unknown repository throws', unknownThrew)

// run_tests: without a subprocess it reports that tests cannot run.
const testsTool = byName.get('learning_repo_run_tests')
let unavailableThrew = false
try { await testsTool.execute({ repository: 'c' }, { signal: undefined }) } catch (error) { unavailableThrew = /subprocess service is not mounted/.test(error.message) }
check('run_tests: no subprocess throws', unavailableThrew)

// With a subprocess mounted, a missing folder is reported before anything runs.
const captured2 = []
await apply(makeCtx(captured2, {}), config)
const testsTool2 = captured2.find((definition) => definition.name === 'learning_repo_run_tests')
let missingThrew = false
try { await testsTool2.execute({ repository: 'c' }, { signal: undefined }) } catch (error) { missingThrew = /Repository folder not found/.test(error.message) }
check('run_tests: missing folder throws', missingThrew)

let unknownTestsThrew = false
try { await testsTool.execute({ repository: 'nope' }, { signal: undefined }) } catch { unknownTestsThrew = true }
check('run_tests: unknown repository throws', unknownTestsThrew)

// Synthetic success value: schema + the preserved report format.
const synthetic = {
  repository: 'c', label: 'C', path: 'D:\\01c', status: 'passed',
  passed: 1, failed: 1, skipped: 0, summary: '1 passed, 1 failed',
  truncated: false, output: 'C: 1 passed, 1 failed',
  cases: [
    { test: 'tests/a.txt', case: 1, program: 'a.c', status: 'pass', expected: '1', actual: '1' },
    { test: 'tests/a.txt', case: 2, program: 'a.c', status: 'fail', expected: '2', actual: '3' },
    { test: 'tests/b.txt', case: 1, program: 'b.c', status: 'skip', reason: 'Arduino sketch has no host runner' },
  ],
}
const syntheticViolations = validateJsonSchemaValue(testsTool.output.schema, synthetic, 'value')
check('run_tests: synthetic value validates', syntheticViolations.length === 0, syntheticViolations.join('; '))
const report = testsTool.output.render({}, synthetic)[0].text
check('run_tests: report keeps the old format', report.split('\n')[0] === 'C: 1 passed, 1 failed, 0 skipped'
  && report.includes('PASS  tests/a.txt #1') && report.includes('FAIL  tests/a.txt #2')
  && report.includes('      expected: 2') && report.includes('SKIP  tests/b.txt #1'))

console.log(failures.length === 0 ? '\nALL CHECKS PASSED' : `\n${failures.length} FAILED: ${failures.join(', ')}`)
process.exitCode = failures.length === 0 ? 0 : 1
