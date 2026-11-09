// Local apply() check: exact fake services, then a context whose undeclared
// service properties throw like the Host proxy does.
import { apply } from '../index.js'

const registered = { skills: [], tools: [], routes: [] }
const services = {
  skills: { register: (skill) => { registered.skills.push(skill.name); return () => {} } },
  tools: { register: (definition) => { registered.tools.push(definition.name); return () => {} } },
  webServer: { register: (route) => { registered.routes.push(route.path); return () => {} } },
  subprocess: undefined,
}
let effects = 0
const fakeCtx = {
  effects: 0,
  get(name) {
    if (!(name in services)) throw new Error(`missing ${name}`)
    return services[name]
  },
  effect(callback) {
    effects += 1
    const dispose = callback()
    if (typeof dispose === 'function') return dispose
    return () => {}
  },
}
// Undeclared service property access must fail, as it does on the real proxy.
for (const name of ['tools', 'skills', 'webServer', 'subprocess', 'connection']) {
  Object.defineProperty(fakeCtx, name, {
    get() {
      throw new Error(`cannot get property "${name}" without inject`)
    },
  })
}

const config = {
  repositories: [{ id: 'demo', label: 'Demo', path: 'D:\\nope-not-a-real-folder', languages: ['c'] }],
  sourceDirectories: [],
}

await apply(fakeCtx, config)
console.log('registered:', JSON.stringify(registered), 'effects:', effects)

const ok = registered.skills.includes('learning-repo-organizer')
  && registered.tools.includes('learning_repo_status')
  && registered.tools.includes('learning_repo_run_tests')
  && registered.routes.includes('/learnrepo/api')
  && effects >= 3
console.log(ok ? 'apply check passed' : 'apply check FAILED')
process.exitCode = ok ? 0 : 1
