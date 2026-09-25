/**
 * Settings → Plugins (spec §31, §51; docs/05 §5, §10; docs/07 §4, §10).
 *
 * The screen a shopkeeper uses to switch capabilities on and off. Three things
 * about it are deliberate:
 *
 *  * **Nothing here is hard-coded per plugin.** The list comes from
 *    `plugin_catalog()` — what the *server* ships — and the settings form is
 *    rendered from the plugin's own `settingsSchema`. Adding a plugin to this
 *    bundle never means editing this file (spec §51).
 *  * **Switching on is a decision, so it is previewed.** `plugin_impact()`
 *    answers the question a permission list cannot: which roles would gain
 *    these permissions *silently*, because they hold a wildcard. A shopkeeper
 *    who learns that from an incident report has lost trust in the system.
 *  * **Switching off is not deletion.** Migrations, tables, data and grants
 *    all survive; only the behaviour stops. The confirm dialog says so, and
 *    the plugin's data comes back when it is switched on again.
 *
 * A plugin that fails to load is shown as *needing attention* with the error
 * the host recorded, and one button to try again — never a silent absence.
 */

import { h, icon, mount } from '../../components/ui/h'
import { button, iconButton, spinner } from '../../components/ui/button'
import { badge, card, emptyState, stat } from '../../components/ui/card'
import { checkbox, field, input, searchInput, select } from '../../components/ui/input'
import { confirm, modal } from '../../components/feedback/modal'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { getRepositories } from '../../app/data'
import { activeOrganization, can } from '../../app/state/session'
import { pluginRegistry, pluginConfig, rememberConfig, syncPlugins } from '../../app/plugins'
import { translateError } from '../../app/platform/errors'
import type { PluginCatalogEntry, PluginImpactRole } from '../../shared/repositories/contracts'

type Filter = 'all' | 'on' | 'off' | 'attention'

const CATEGORY_LABELS: Record<PluginCatalogEntry['category'], string> = {
  core: 'Core',
  optional: 'Optional',
  industry: 'Industry',
}

const CATEGORY_ORDER: PluginCatalogEntry['category'][] = ['core', 'optional', 'industry']

/** What a plugin actually contributed to this session, read from the host. */
function contributions(pluginKey: string): string[] {
  const count = (items: readonly { source?: string }[]): number =>
    items.filter((item) => item.source === pluginKey).length

  const registry = pluginRegistry
  const parts: Array<[number, string]> = [
    [count(registry.nav.items), 'screen'],
    [count(registry.routes.items), 'route'],
    [count(registry.widgets.items), 'dashboard widget'],
    [count(registry.posPanels.items), 'POS panel'],
    [count(registry.saleTabs.items), 'sale tab'],
    [count(registry.formSections.items), 'form section'],
    [count(registry.productFields.items), 'product field'],
    [count(registry.permissions.items), 'permission'],
  ]

  return parts
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`)
}

export function pluginsView(): HTMLElement {
  const repos = getRepositories()
  const org = activeOrganization()
  const organizationId = org?.organization_id ?? ''
  const canManage = can('plugins.manage')

  let entries: PluginCatalogEntry[] = []
  let filter: Filter = 'all'
  let search = ''
  let loadError: string | null = null

  const headerSlot = h('div', { class: 'space-y-3 border-b border-border p-4' })
  const listSlot = h('div', { class: 'min-h-0 flex-1 overflow-y-auto p-4' })
  const root = h('div', { class: 'mx-auto flex h-full min-h-0 max-w-5xl flex-col' }, headerSlot, listSlot)

  const searchBox = searchInput('Search plugins…', (value) => {
    search = value
    render()
  })

  const filterBox = select({
    value: filter,
    options: [
      { value: 'all', label: 'All plugins' },
      { value: 'on', label: 'Switched on' },
      { value: 'off', label: 'Switched off' },
      { value: 'attention', label: 'Needs attention' },
    ],
    onChange: (value) => {
      filter = value as Filter
      render()
    },
    class: 'sm:max-w-[12rem]',
  })

  const reloadButton = iconButton('refresh', 'Reload the plugin list', {
    onClick: () => void load(),
  })

  let requestId = 0

  async function load(): Promise<void> {
    const id = ++requestId
    mount(listSlot, h('div', { class: 'flex justify-center p-8' }, spinner()))
    try {
      const catalog = await repos.plugins.catalog(organizationId)
      if (id !== requestId) return
      entries = catalog
      loadError = null
      for (const entry of catalog) rememberConfig(entry.key, entry.config)
    } catch (error) {
      if (id !== requestId) return
      loadError = translateError(error).message
    } finally {
      if (id === requestId) {
        renderHeader()
        render()
      }
    }
  }

  function renderHeader(): void {
    const on = entries.filter((entry) => entry.enabled).length
    const pending = entries.reduce((sum, entry) => sum + entry.migrationsPending, 0)
    const broken = entries.filter((entry) => entry.status === 'error').length

    mount(
      headerSlot,
      h(
        'div',
        { class: 'flex flex-wrap items-start justify-between gap-3' },
        h(
          'div',
          { class: 'min-w-0' },
          h('h2', { class: 'text-xl font-semibold text-content', text: 'Plugins' }),
          h('p', {
            class: 'mt-0.5 text-sm text-content-muted',
            text: 'Extra capabilities for this shop. Everything here is optional — the core shop works without any of it.',
          })
        ),
        reloadButton
      ),
      h('div', { class: 'grid gap-2 sm:grid-cols-3' }, [
        stat('Switched on', `${on} of ${entries.length}`),
        stat('Migrations to apply', pending === 0 ? 'None' : String(pending)),
        stat('Needs attention', broken === 0 ? 'None' : String(broken), broken ? { tone: 'danger' } : {}),
      ]),
      h(
        'div',
        { class: 'flex flex-col gap-2 sm:flex-row' },
        h('div', { class: 'sm:flex-1' }, searchBox),
        filterBox
      )
    )
  }

  function visibleEntries(): PluginCatalogEntry[] {
    const needle = search.trim().toLowerCase()
    return entries.filter((entry) => {
      if (filter === 'on' && !entry.enabled) return false
      if (filter === 'off' && entry.enabled) return false
      if (filter === 'attention' && entry.status !== 'error') return false
      if (!needle) return true
      return (
        entry.name.toLowerCase().includes(needle) ||
        entry.key.includes(needle) ||
        (entry.description ?? '').toLowerCase().includes(needle)
      )
    })
  }

  function render(): void {
    if (loadError) {
      mount(
        listSlot,
        emptyState('The plugin list could not be loaded', {
          description: loadError,
          iconName: 'error',
          action: button('Try again', { variant: 'primary', onClick: () => void load() }),
        })
      )
      return
    }

    if (entries.length === 0) {
      mount(
        listSlot,
        emptyState('This server ships no plugins', {
          description:
            'Plugins arrive with the server bundle. When one is published, it appears here with what it adds.',
          iconName: 'extension_off',
        })
      )
      return
    }

    const visible = visibleEntries()
    if (visible.length === 0) {
      mount(
        listSlot,
        emptyState('Nothing matches that', {
          description: 'Try a different search, or show all plugins.',
          iconName: 'search_off',
        })
      )
      return
    }

    mount(
      listSlot,
      h(
        'div',
        { class: 'space-y-4' },
        ...CATEGORY_ORDER.map((category) => {
          const group = visible.filter((entry) => entry.category === category)
          if (group.length === 0) return null
          return h(
            'section',
            { class: 'space-y-2' },
            h('h3', {
              class: 'text-xs font-semibold uppercase tracking-wide text-content-subtle',
              text: `${CATEGORY_LABELS[category]} (${group.length})`,
            }),
            ...group.map(pluginCard)
          )
        })
      )
    )
  }

  /** One row per plugin: what it is, what it added, and what it can do next. */
  function pluginCard(entry: PluginCatalogEntry): HTMLElement {
    const registration = pluginRegistry.get(entry.key)
    const hostError = registration?.error ?? null
    const failed = entry.status === 'error' || registration?.status === 'error'
    const blocked = registration?.status === 'blocked'
    const loaded = registration?.status === 'loaded'
    const parts = loaded ? contributions(entry.key) : []

    const statusBadge = failed
      ? badge('Needs attention', { tone: 'danger', iconName: 'error' })
      : blocked
        ? badge('Blocked', { tone: 'warning', iconName: 'block' })
        : entry.enabled
          ? badge('On', { tone: 'success', iconName: 'check_circle' })
          : badge('Off', { tone: 'neutral', iconName: 'power_settings_new' })

    const actions: HTMLElement[] = []
    if (canManage) {
      actions.push(
        entry.enabled
          ? button('Switch off', {
              variant: 'secondary',
              icon: 'toggle_off',
              onClick: () => void switchOff(entry),
            })
          : button('Switch on', {
              variant: 'primary',
              icon: 'toggle_on',
              onClick: () => void switchOn(entry),
            })
      )
    }
    // Settings live in `plugins.config`, which needs a row in `plugins` to
    // write to — so a plugin that has never been switched on offers the
    // switch, not a form that would fail on save.
    actions.push(
      button('Settings', {
        variant: 'ghost',
        icon: 'tune',
        disabled: !entry.installed,
        title: entry.installed ? 'Settings' : 'Switch this plugin on first',
        onClick: () => openSettings(entry),
      })
    )

    return card(
      h(
        'div',
        { class: 'flex flex-wrap items-start justify-between gap-3' },
        h(
          'div',
          { class: 'flex min-w-0 items-start gap-3' },
          h(
            'span',
            { class: 'grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-surface-muted' },
            icon(registration?.manifest.icon ?? 'extension', 'text-content-muted text-xl')
          ),
          h(
            'div',
            { class: 'min-w-0' },
            h(
              'div',
              { class: 'flex flex-wrap items-center gap-2' },
              h('p', { class: 'text-sm font-semibold text-content', text: entry.name }),
              badge(`v${entry.version}`, { tone: 'neutral' }),
              statusBadge,
              entry.migrationsPending > 0 ? badge(`${entry.migrationsPending} migration(s) pending`, { tone: 'info' }) : null
            ),
            h('p', { class: 'mt-1 text-sm text-content-muted', text: entry.description ?? '—' }),
            h('p', { class: 'mt-1 text-xs text-content-subtle', text: `id: ${entry.key}` })
          )
        ),
        h('div', { class: 'flex shrink-0 flex-wrap items-center gap-2' }, ...actions)
      ),
      parts.length > 0 ? h('p', { class: 'mt-3 text-xs text-content-muted', text: `Adds: ${parts.join(' · ')}` }) : null,
      entry.permissions.length > 0
        ? h(
            'p',
            { class: 'mt-1 text-xs text-content-subtle' },
            `Permissions: ${entry.permissions.map((permission) => permission.key).join(', ')}`
          )
        : null,
      entry.dependencies.length > 0
        ? h('p', {
            class: 'mt-1 text-xs text-content-subtle',
            text: `Needs: ${entry.dependencies.join(', ')}`,
          })
        : null,
      failed && (hostError ?? entry.lastError)
        ? h(
            'div',
            { class: 'mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3' },
            h('p', { class: 'text-xs font-medium text-danger', text: 'This plugin did not finish loading' }),
            h('p', { class: 'mt-1 text-xs text-content-muted', text: hostError ?? entry.lastError ?? '' }),
            h(
              'div',
              { class: 'mt-2' },
              button('Try again', {
                size: 'sm',
                icon: 'restart_alt',
                onClick: () => void retry(entry),
              })
            )
          )
        : null
    )
  }

  /** The permissions a wildcard role would gain — the reason to ask first. */
  function impactText(roles: PluginImpactRole[]): string {
    if (roles.length === 0) {
      return 'No role gains these permissions automatically; grants stay as they are.'
    }
    return roles
      .map((role) => `${role.roleName} (${role.wildcard}) gains ${role.permissions.join(', ')}`)
      .join('\n')
  }

  async function switchOn(entry: PluginCatalogEntry): Promise<void> {
    try {
      const impact = await repos.plugins.impact(organizationId, entry.key)

      const willEnable = dependenciesOf(entry.key)
      const ok = await confirm(`Switch on ${entry.name}?`, {
        message:
          `It adds ${entry.permissions.length} permission(s).\n\n` +
          impactText(impact) +
          (entry.migrationsPending > 0
            ? `\n\n${entry.migrationsPending} migration(s) will be applied to this shop's database.`
            : '') +
          (willEnable.length > 0 ? `\n\nAlso switched on: ${willEnable.join(', ')}.` : ''),
        confirmLabel: 'Switch on',
        iconName: 'extension',
      })
      if (!ok) return

      const result = await repos.plugins.enable(organizationId, entry.key, entry.version)
      await syncPlugins()
      toastSuccess(
        result.migrationsApplied > 0
          ? `${entry.name} is on — ${result.migrationsApplied} migration(s) applied.`
          : `${entry.name} is on.`
      )
      await load()
    } catch (error) {
      toastError(translateError(error).message)
      await load()
    }
  }

  async function switchOff(entry: PluginCatalogEntry): Promise<void> {
    const dependents = entries
      .filter((other) => other.enabled && other.dependencies.includes(entry.key))
      .map((other) => other.name)

    if (dependents.length > 0) {
      toastError(`${entry.name} is needed by ${dependents.join(', ')}. Switch those off first.`)
      return
    }

    const ok = await confirm(`Switch off ${entry.name}?`, {
      message:
        'Its screens and panels disappear from the shop straight away. Its tables, data and permissions are kept, ' +
        'so switching it back on restores everything.',
      confirmLabel: 'Switch off',
      tone: 'danger',
      iconName: 'toggle_off',
    })
    if (!ok) return

    try {
      await repos.plugins.disable(organizationId, entry.key)
      await syncPlugins()
      toastSuccess(`${entry.name} is off. Its data is still here.`)
      await load()
    } catch (error) {
      toastError(translateError(error).message)
    }
  }

  async function retry(entry: PluginCatalogEntry): Promise<void> {
    try {
      // Re-applying is idempotent: migrations already recorded are skipped, and
      // the plugin is switched on again — which is what "try again" means.
      await repos.plugins.enable(organizationId, entry.key, entry.version)
      await syncPlugins()
      toastSuccess(`${entry.name} reloaded.`)
      await load()
    } catch (error) {
      toastError(translateError(error).message)
    }
  }

  /** Names of plugins that must be on for this one to work. */
  function dependenciesOf(key: string, seen = new Set<string>()): string[] {
    if (seen.has(key)) return []
    seen.add(key)
    const entry = entries.find((other) => other.key === key)
    if (!entry) return []
    return entry.dependencies.flatMap((dependency) => [
      ...(entries.find((other) => other.key === dependency)?.enabled ? [] : [dependency]),
      ...dependenciesOf(dependency, seen),
    ])
  }

  /**
   * The settings form is built from the plugin's own schema (spec §36): a
   * plugin declares the fields, the core draws them, and an unknown key is
   * dropped rather than written into `plugins.config`.
   */
  function openSettings(entry: PluginCatalogEntry): void {
    const schema = pluginRegistry.get(entry.key)?.manifest.settingsSchema ?? []
    const current = pluginConfig(entry.key)
    const dialog = modal({
      title: `${entry.name} settings`,
      ...(schema.length > 0 ? { subtitle: 'Stored with the shop, shared by every device.' } : {}),
      iconName: 'tune',
      size: 'sm',
    })

    if (schema.length === 0) {
      mount(
        dialog.body,
        h('p', {
          class: 'text-sm text-content-muted',
          text: 'This plugin has no settings yet. Anything it needs it works out on its own.',
        }),
        h('div', { class: 'mt-4 flex justify-end' }, button('Close', { onClick: () => dialog.close() }))
      )
      return
    }

    const draft: Record<string, unknown> = { ...current }
    const controls: HTMLElement[] = []

    for (const setting of schema) {
      const value = current[setting.key] ?? setting.default
      if (setting.type === 'boolean') {
        controls.push(
          h(
            'div',
            { class: 'py-1' },
            checkbox({
              label: setting.label,
              checked: value === true,
              onChange: (checked) => {
                draft[setting.key] = checked
              },
            }),
            setting.helpText ? h('p', { class: 'mt-1 text-xs text-content-subtle', text: setting.helpText }) : null
          )
        )
        continue
      }

      if (setting.type === 'select') {
        const control = select({
          value: value === undefined || value === null ? '' : String(value),
          options: (setting.options ?? []).map((option) => ({ value: option.value, label: option.label })),
          ...(setting.placeholder ? { placeholder: setting.placeholder } : {}),
          onChange: (next) => {
            draft[setting.key] = next
          },
        })
        controls.push(
          field(setting.label, control, {
            ...(setting.helpText ? { hint: setting.helpText } : {}),
          })
        )
        continue
      }

      const isNumber = setting.type === 'number'
      const control = input({
        type: isNumber ? 'number' : 'text',
        value: value === undefined || value === null ? '' : String(value),
        ...(setting.placeholder ? { placeholder: setting.placeholder } : {}),
        ...(isNumber && setting.min !== undefined ? { min: setting.min } : {}),
        ...(isNumber && setting.max !== undefined ? { max: setting.max } : {}),
        ...(isNumber ? { step: setting.step ?? 'any' } : {}),
        onInput: (next) => {
          draft[setting.key] = isNumber ? (next === '' ? null : Number(next)) : next
        },
      })
      controls.push(
        field(setting.label, control, {
          ...(setting.helpText ? { hint: setting.helpText } : {}),
        })
      )
    }

    mount(
      dialog.body,
      h(
        'div',
        { class: 'space-y-3' },
        ...controls,
        h('div', { class: 'flex justify-end gap-2 pt-2' }, [
          button('Cancel', { onClick: () => dialog.close() }),
          button('Save', {
            variant: 'primary',
            icon: 'save',
            onClick: () => {
              void (async () => {
                try {
                  const saved = await repos.plugins.setConfig(organizationId, entry.key, draft)
                  rememberConfig(entry.key, saved.config)
                  // A settings change can change what the plugin draws, so the
                  // host is told to re-read rather than the page reloaded.
                  await syncPlugins()
                  toastSuccess(`${entry.name} settings saved.`)
                  dialog.close()
                  await load()
                } catch (error) {
                  toastError(translateError(error).message)
                }
              })()
            },
          }),
        ])
      )
    )
  }

  renderHeader()
  void load()

  return root
}
