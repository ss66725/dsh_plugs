// Local check for the plugin's pure helpers; not shipped to the runtime.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { __internal, resolveConfig, scanRepository } from '../index.js'

const { parseCases, normalizeOutput, scanTextForPrivacy, parseFrontMatter, loadSkill } = __internal
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE = fileURLToPath(new URL('../.lro-selftest-fixture', import.meta.url))

const failed = []
function check(name, condition, detail) {
  if (condition) {
    console.log(`ok   ${name}`)
  } else {
    failed.push(name)
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

// parseCases mirrors scripts/run_tests.py: a block starts at "input:", switches
// at "output:", and ends at "---".
const text = ['input:', '3 9 5', 'output:', 'The largest number is 9', '---', 'input:', '1 2 3', 'output:', 'The largest number is 3'].join('\n')
const cases = parseCases(text)
check('parseCases counts', cases.length === 2, JSON.stringify(cases))
check('parseCases input', cases[0].input.join('|') === '3 9 5')
check('parseCases output', cases[1].output.join('|') === 'The largest number is 3')
check('normalizeOutput trailing ws', normalizeOutput('a  \r\nb\t\n\n') === 'a\nb')

const hits = scanTextForPrivacy('#define WIFI_SSID "HomeWiFi"\nconst char* password = "YOUR_PASSWORD_HERE";\ntoken = "abc123456"\n')
check('privacy finds token', hits.some((hit) => hit.rule === 'token'), JSON.stringify(hits))
check('privacy ignores placeholder', !hits.some((hit) => hit.value.includes('YOUR_PASSWORD')), JSON.stringify(hits))

const skillRaw = await readFile(`${PACKAGE_ROOT}skills/learning-repo-organizer/SKILL.md`, 'utf8')
const front = parseFrontMatter(skillRaw)
check('front matter name', front.data.name === 'learning-repo-organizer', front.data.name)
check('front matter description', typeof front.data.description === 'string' && front.data.description.length > 10)
const skill = await loadSkill()
check('skill content includes body', skill.content.includes('# 学习仓库整理'))
check('skill content includes resource note', skill.content.includes('dsh-learning-repo-organizer'))
check('skill invocation', skill.invocation.modelInvocable && skill.invocation.userInvocable)

const cfg = resolveConfig({
  repositories: [{ id: 'c', label: 'C', path: 'D:\\01c', languages: ['c'] }],
  sourceDirectories: ['D:\\summer_practice'],
  testTimeoutMs: 500,
  dashboardPath: '/learnrepo/',
})
check('resolveConfig id', cfg.repositories[0].id === 'c')
check('resolveConfig absolute path', cfg.repositories[0].path.toLowerCase().endsWith('01c'))
check('resolveConfig source', cfg.sourceDirectories.length === 1)
check('resolveConfig timeout clamp', cfg.testTimeoutMs === 1000, String(cfg.testTimeoutMs))

const scan = await scanRepository({ id: 'fixture', label: 'Fixture', path: FIXTURE, remote: '', languages: [] })

console.log(failed.length === 0 ? '\nall checks passed' : `\n${failed.length} failed: ${failed.join(', ')}`)
process.exitCode = failed.length === 0 ? 0 : 1
