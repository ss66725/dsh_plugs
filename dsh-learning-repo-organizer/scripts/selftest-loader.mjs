// Test-only resolver: maps bare `schemastery` to the DSH installation's copy,
// which is what the Loader provides at runtime.
const SCHEMA = 'file:///C:/Users/Thinkpad/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/schemastery/lib/index.mjs'
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'schemastery') return { url: SCHEMA, shortCircuit: true }
  return nextResolve(specifier, context)
}
