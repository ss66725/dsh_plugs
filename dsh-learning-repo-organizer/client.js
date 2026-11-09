window.__ModuleLoader__.load({
  id: 'dsh-learning-repo-organizer',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'learning-repo-organizer'
    const DASHBOARD_PATH = '/learnrepo'
    const SETTINGS_ID = 'learning-repo-organizer'

    const CSS = `
.lro-root{display:flex;flex-direction:column;gap:12px;padding:4px 0 24px;color:var(--dsw-alias-label-primary);font:inherit}
.lro-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lro-head-text{display:flex;flex-direction:column;gap:2px;margin-right:auto}
.lro-title{font-size:15px;font-weight:600;line-height:1.3}
.lro-sub{font-size:12px;color:var(--dsw-alias-label-secondary)}
.lro-hint{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.lro-button{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;line-height:1.4;cursor:pointer}
.lro-button:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.lro-button:disabled{opacity:.55;cursor:default}
.lro-button[data-variant="primary"]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.lro-button[data-variant="ghost"]{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}
.lro-button[data-variant="ghost"]:hover{border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
.lro-link{color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:12px}
.lro-link:hover{text-decoration:underline}
.lro-cards{display:flex;flex-direction:column;gap:10px}
.lro-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.lro-card-head{display:flex;align-items:flex-start;gap:10px}
.lro-card-title{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.lro-name{font-size:14px;font-weight:600}
.lro-path{font-size:11px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
.lro-badges{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.lro-badge{font-size:11px;line-height:1;padding:4px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap}
.lro-badge[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}
.lro-badge[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
.lro-badge[data-tone="ok"]{color:var(--dsw-alias-state-success-primary)}
.lro-badge[data-tone="idle"]{color:var(--dsw-alias-state-idle-primary)}
.lro-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
.lro-stat{display:flex;flex-direction:column;gap:1px}
.lro-stat-value{font-size:13px;font-weight:600}
.lro-stat-label{font-size:11px;color:var(--dsw-alias-label-secondary)}
.lro-list{display:flex;flex-direction:column;gap:3px;font-size:12px}
.lro-row{display:flex;gap:8px;align-items:baseline;min-width:0}
.lro-row-name{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;overflow-wrap:anywhere}
.lro-row-meta{color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:auto;white-space:nowrap}
.lro-note{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.lro-error{font-size:12px;color:var(--dsw-alias-state-error-primary)}
.lro-empty{border:1px dashed var(--dsw-alias-border-l1);border-radius:12px;padding:16px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
`

    function formatTime(value, locale) {
      if (!value) return ''
      try {
        return new Date(value).toLocaleString(locale || undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      } catch {
        return String(value)
      }
    }

    function formatDate(mtime, locale) {
      if (!mtime) return ''
      try {
        return new Date(mtime).toLocaleDateString(locale || undefined)
      } catch {
        return ''
      }
    }

    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) => (values != null && values[key] !== undefined ? String(values[key]) : match))
    }

    function useDict(ctx) {
      const translate = React.useMemo(() => {
        try {
          return ctx.locale.bind(NS)
        } catch {
          return undefined
        }
      }, [ctx.locale])
      const subscribe = React.useCallback((listener) => {
        try {
          return ctx.locale.subscribe(listener)
        } catch {
          return () => {}
        }
      }, [ctx.locale])
      React.useSyncExternalStore(subscribe, () => {
        try {
          const snapshot = ctx.locale.getSnapshot()
          return snapshot && typeof snapshot === 'object' ? `${snapshot.id ?? snapshot.locale ?? ''}` : ''
        } catch {
          return ''
        }
      })
      return React.useCallback((key, values) => {
        let text
        try {
          text = translate === undefined ? key : translate(key, values)
        } catch {
          text = key
        }
        if (values && typeof text === 'string') return fill(text, values)
        return typeof text === 'string' ? text : key
      }, [translate])
    }

    function useDashboard(fetchStatus) {
      const [state, setState] = React.useState({ loading: true, error: undefined, data: undefined })
      const load = React.useCallback(async () => {
        setState((previous) => ({ loading: true, error: undefined, data: previous.data }))
        try {
          const data = await fetchStatus()
          setState({ loading: false, error: undefined, data })
        } catch (error) {
          setState((previous) => ({ loading: false, error: error, data: previous.data }))
        }
      }, [fetchStatus])
      React.useEffect(() => {
        let cancelled = false
        ;(async () => {
          try {
            const data = await fetchStatus()
            if (!cancelled) setState({ loading: false, error: undefined, data })
          } catch (error) {
            if (!cancelled) setState({ loading: false, error: error, data: undefined })
          }
        })()
        return () => {
          cancelled = true
        }
      }, [fetchStatus])
      return [state, load]
    }

    async function fetchDashboard() {
      const response = await fetch(`${DASHBOARD_PATH}/api`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    function Badge(props) {
      return h('span', { className: 'lro-badge', 'data-tone': props.tone ?? 'neutral' }, props.children)
    }

    function Stat(props) {
      return h('div', { className: 'lro-stat' },
        h('span', { className: 'lro-stat-value' }, props.value),
        h('span', { className: 'lro-stat-label' }, props.label))
    }

    function RepositoryCard(props) {
      const { repository, t, locale } = props
      const languages = repository.languages && repository.languages.length > 0 ? repository.languages.join(' · ') : '—'
      const latest = repository.latest
      const privacyTone = repository.privacyHits.length > 0 ? 'warn' : 'ok'
      return h('div', { className: 'lro-card' },
        h('div', { className: 'lro-card-head' },
          h('div', { className: 'lro-card-title' },
            h('span', { className: 'lro-name' }, repository.label),
            h('span', { className: 'lro-path', title: repository.path }, repository.path)),
          h('div', { className: 'lro-badges' },
            repository.exists ? null : h(Badge, { tone: 'error' }, t('missing')),
            repository.isGit ? h(Badge, null, repository.branch ?? 'git') : (repository.exists ? h(Badge, { tone: 'idle' }, t('notGit')) : null),
            repository.remote ? h(Badge, { tone: 'idle' }, t('upstream', { name: repository.remote.replace(/^https?:\/\/github\.com\//, '') })) : h(Badge, { tone: 'idle' }, t('noUpstream')))),
        repository.error !== undefined && repository.error !== 'missing'
          ? h('div', { className: 'lro-error' }, repository.error)
          : null,
        h('div', { className: 'lro-stats' },
          h(Stat, { value: repository.fileCount, label: `${languages} · ${t('totalFiles', { count: repository.fileCount })}` }),
          h(Stat, { value: repository.dayFolders.length, label: t('dayFolders', { count: repository.dayFolders.length }) }),
          h(Stat, { value: repository.testFiles, label: t('testFiles', { count: repository.testFiles }) }),
          repository.tests !== undefined
            ? h(Stat, {
                value: repository.tests.status === 'unavailable' ? '—' : t('tests', { passed: repository.tests.passed, failed: repository.tests.failed }),
                label: repository.tests.skipped > 0 ? t('testsSkipped', { count: repository.tests.skipped }) : 'tests/',
              })
            : null),
        repository.dayFolders.length > 0
          ? h('div', { className: 'lro-badges' }, repository.dayFolders.slice(0, 12).map((folder) => h(Badge, { key: folder }, folder)))
          : null,
        latest
          ? h('div', { className: 'lro-note' }, t('lastActivity', { name: `${latest.path} · ${formatDate(latest.mtime, locale)}` }))
          : null,
        h('div', { className: 'lro-badges' },
          h(Badge, { tone: privacyTone }, repository.privacyHits.length > 0
            ? t('privacyHits', { count: repository.privacyHits.length })
            : t('privacyClean'))),
        repository.privacyHits.length > 0
          ? h('div', { className: 'lro-list' }, repository.privacyHits.slice(0, 6).map((hit, index) =>
              h('div', { className: 'lro-row', key: `${hit.path}:${hit.line}:${index}` },
                h('span', { className: 'lro-row-name' }, `${hit.path}:${hit.line}`),
                h('span', { className: 'lro-row-meta' }, `${hit.label} = ${hit.value}`))))
          : h('div', { className: 'lro-note' }, t('privacyHint')))
    }

    function Dashboard(props) {
      const { ctx } = props
      const t = useDict(ctx)
      const [state, reload] = useDashboard(fetchDashboard)
      const locale = (() => {
        try {
          const snapshot = ctx.locale.getSnapshot()
          return snapshot?.id ?? snapshot?.locale
        } catch {
          return undefined
        }
      })()
      const data = state.data
      return h("div", { className: "lro-root" },
        h("div", { className: "lro-head" },
          h("div", { className: "lro-head-text" },
            h("span", { className: "lro-title" }, t("name")),
            h("span", { className: "lro-sub" }, data?.scannedAt ? t("scannedAt", { time: formatTime(data.scannedAt, locale) }) : (state.loading ? t("refreshing") : t("never")))),
          h("button", {
            type: "button",
            className: "lro-button",
            disabled: state.loading,
            onClick: () => { void reload() },
          }, state.loading ? t("refreshing") : t("scan"))),
        state.error !== undefined ? h("div", { className: "lro-error" }, String(state.error?.message ?? state.error)) : null,
        data === undefined && state.loading ? h("div", { className: "lro-empty" }, t("refreshing")) : null,
        data !== undefined && data.repositories.length === 0 ? h("div", { className: "lro-empty" }, t("empty")) : null,
        data !== undefined && data.repositories.length > 0
          ? h("div", { className: "lro-cards" }, data.repositories.map((repository) =>
              h(RepositoryCard, { key: repository.id, repository, t, locale })))
          : null,
        data !== undefined && data.sources !== undefined && data.sources.length > 0
          ? h("div", { className: "lro-list" },
              h("span", { className: "lro-stat-label" }, t("sourceFolders")),
              data.sources.map((source) => h("div", { className: "lro-row", key: source.path },
                h("span", { className: "lro-row-name" }, source.path),
                h("span", { className: "lro-row-meta" }, source.exists ? "" : t("missing")))),
              h("div", { className: "lro-note" }, t("sourceHint")))
          : null,
        h("div", { className: "lro-hint" }, t("privacyHint")))
    }

    function SettingsSection(props) {
      return h(Dashboard, { ctx: props.ctx })
    }

    return {
      inject: ["slots", "locale"],
      apply(ctx) {
        if (typeof styles !== "undefined" && styles && typeof styles.insert === "function") {
          ctx.effect(() => styles.insert(CSS), "learning-repo-organizer: styles")
        }
        ctx.slots.inject("settings.section", () => ctx.slots.register({
          name: "settings.section",
          id: SETTINGS_ID,
          order: 60,
          label: () => {
            try {
              return ctx.locale.bind(NS)("name")
            } catch {
              return "Learning repos"
            }
          },
        }, SettingsSection))
      },
    }
  },
})
