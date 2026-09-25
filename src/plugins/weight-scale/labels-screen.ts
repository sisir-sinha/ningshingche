/**
 * Weighing scale — the screen behind the sidebar item.
 *
 * A shopkeeper opens this for exactly two reasons: *"the till does not read my
 * labels"* and *"which of my items can the scale not sell?"*. So the screen is
 * built around a box you can scan into, and the layout list that box is reading
 * — not around a form full of numbers that only make sense once they are right.
 *
 * The test box is the honest core of it. A shopkeeper cannot tell whether a
 * layout is correct by reading `22 + 5 PLU + 5 g + check`; they can tell by
 * pointing the scanner at the roll of labels on the counter. So the box takes
 * both: type or scan a real label, and it says what the till would make of it —
 * or, when the answer is "nothing", shows what each layout *would* have looked
 * like so the difference is visible.
 *
 * Everything here writes to `plugins.config` through `api.settings`, which is
 * also what the till reads on every scan and what the plugin's server half
 * reads when a report is built. One place, three readers, no drift.
 */

import { badge, card, cardHeader, emptyState, panel, skeleton, stat } from '../../components/ui/card'
import { button, iconButton } from '../../components/ui/button'
import { checkbox, field, input } from '../../components/ui/input'
import { h, mount } from '../../components/ui/h'
import { confirm } from '../../components/feedback/modal'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import type {
  PluginDb,
  PluginPageContext,
  PluginPageModule,
  PluginSettings,
} from '../../shared/registry/plugin-types'
import {
  DEFAULT_FORMATS,
  decodeLabel,
  normaliseFormats,
  draftOf,
  emptyDraft,
  formatIdFor,
  formatSummary,
  formatsFromSettings,
  describeError,
  labelExample,
  labelValueText,
  pluVariants,
  totalDigits,
  usingBuiltinLayouts,
  validateFormat,
  weightText,
  type FormatDraft,
  type LabelFormat,
} from './helpers'
import { FORMATS_KEY } from './manifest'

export interface ScreenDeps {
  settings: PluginSettings
  db: PluginDb
}

/** What the dashboard tile and the header read from `overview`. */
interface Overview {
  month: { lines: number; qty: number }
  month_label: string
  today: { lines: number; qty: number }
  codes: {
    all: number
    ready: number
    attention: number
    no_code: number
    by_piece: number
    other_code: number
    whole_label: number
  }
  layouts: number
  using_builtin: boolean
}

export function createWeightScaleScreen(deps: ScreenDeps): PluginPageModule {
  return {
    render: async (context: PluginPageContext): Promise<HTMLElement> => {
      const root = h('div', { class: 'space-y-4 p-4' })
      const headerHost = h('div')
      const glanceHost = h('div', { class: 'grid gap-3 sm:grid-cols-3' })
      const testHost = h('div', { class: 'mt-3' })
      const layoutsHost = h('div', { class: 'mt-3 space-y-3' })

      let probe = ''
      let editing: FormatDraft | null = null
      let problem = ''

      /** What the till reads: the shop's layouts, or the built-in one. */
      const saved = (): LabelFormat[] =>
        formatsFromSettings(deps.settings.get<unknown>(FORMATS_KEY, []))
      /**
       * What the shop has actually described.
       *
       * The built-in layout is a fallback, not a row the shop owns — the first
       * layout a shopkeeper saves *replaces* it, rather than being added beside
       * a layout nobody typed. (`saved()` is what the till and this screen show;
       * this is what a save writes from.)
       */
      const own = (): LabelFormat[] => normaliseFormats(deps.settings.get<unknown>(FORMATS_KEY, []))
      const builtin = (): boolean => usingBuiltinLayouts(deps.settings.get<unknown>(FORMATS_KEY, []))

      // ── The test box ────────────────────────────────────────────────────
      function renderProbe(): void {
        const code = probe.trim()
        if (code === '') {
          mount(
            testHost,
            h(
              'p',
              { class: 'text-xs text-content-subtle' },
              'Nothing read yet. Turn on the scanner, or type the digits from a label and press Enter.'
            )
          )
          return
        }

        const decoded = decodeLabel(code, saved())
        if (!decoded) {
          mount(
            testHost,
            h(
              'div',
              { class: 'rounded-md border border-warning/40 bg-warning/5 p-3' },
              h(
                'p',
                { class: 'text-sm font-medium text-content' },
                `No layout here reads ${code}.`
              ),
              h(
                'p',
                { class: 'mt-1 text-xs text-content-muted' },
                'Compare it with what each layout would print — a label that is one digit longer or shorter than these cannot be read, and that is the layout to fix, not the label:'
              ),
              h(
                'ul',
                { class: 'mt-2 space-y-1' },
                ...saved().map((format) =>
                  h(
                    'li',
                    { class: 'text-xs text-content-muted' },
                    h('span', { class: 'font-medium text-content' }, format.name),
                    ` — ${formatSummary(format)} · example ${labelExample(format, '00012')}`
                  )
                )
              )
            )
          )
          return
        }

        const variants = pluVariants(decoded.plu)
        mount(
          testHost,
          h(
            'div',
            { class: 'rounded-md border border-success/40 bg-success/5 p-3' },
            h(
              'p',
              { class: 'text-sm font-medium text-content' },
              `${decoded.format.name} reads that as ${labelValueText(decoded, context.currency)}`
            ),
            h(
              'p',
              { class: 'mt-1 text-sm text-content' },
              'The till will look up ',
              h('span', { class: 'font-mono font-medium' }, variants[0]),
              ' in this shop’s barcode table.'
            ),
            h(
              'p',
              { class: 'mt-1 text-xs text-content-muted' },
              variants.length > 1
                ? `If nothing is found, add ${variants[0]} as the product’s barcode — or check it is not entered as ${variants[1]} without the leading zero.`
                : 'Nothing found means no product carries that code yet: open the product and add it as a barcode.'
            ),
            decoded.kind === 'price'
              ? h(
                  'p',
                  { class: 'mt-2 text-xs text-content-muted' },
                  'This layout prints the price, not the weight. The till can read it but cannot charge a price the scale printed, so it is shown here and refused at the counter.'
                )
              : null
          )
        )
      }

      // ── The shops's layouts ─────────────────────────────────────────────
      function renderLayouts(): void {
        const formats = saved()
        const rows = h('div', { class: 'divide-y divide-border' })

        for (const [index, format] of formats.entries()) {
          rows.append(
            h(
              'div',
              { class: 'flex flex-wrap items-center gap-3 px-4 py-3' },
              h(
                'div',
                { class: 'min-w-0 flex-1' },
                h(
                  'div',
                  { class: 'flex items-center gap-2' },
                  h('p', { class: 'truncate text-sm font-medium text-content' }, format.name),
                  format.builtin ? badge('Built-in', { tone: 'info' }) : null
                ),
                h(
                  'p',
                  { class: 'mt-0.5 text-xs text-content-muted' },
                  `${formatSummary(format)} · ${totalDigits(format)} digits · example ${labelExample(
                    format,
                    '00012'
                  )}`
                )
              ),
              h(
                'div',
                { class: 'flex items-center gap-1' },
                button('Try it', {
                  size: 'sm',
                  variant: 'ghost',
                  onClick: () => {
                    probe = labelExample(format, '00012')
                    renderProbe()
                    const box = root.querySelector<HTMLInputElement>('input')
                    if (box) {
                      box.value = probe
                      box.focus()
                    }
                  },
                }),
                // The layout the plugin ships with is nobody's to edit: it is
                // what the till reads until the shop describes its own, and the
                // way to replace it is the button under this list.
                format.builtin
                  ? null
                  : iconButton('edit', `Edit ${format.name}`, {
                      size: 'sm',
                      variant: 'ghost',
                      onClick: () => {
                        editing = draftOf(format)
                        problem = ''
                        renderLayouts()
                      },
                    }),
                format.builtin
                  ? null
                  : iconButton('delete', `Remove ${format.name}`, {
                      size: 'sm',
                      variant: 'ghost',
                      onClick: () => void remove(index),
                    })
              )
            )
          )
        }

        mount(
          layoutsHost,
          rows,
          editing ? editor(editing, formats) : null,
          problem ? h('p', { class: 'px-4 pb-2 text-xs text-danger' }, problem) : null,
          h(
            'div',
            { class: 'flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3' },
            h(
              'p',
              { class: 'text-xs text-content-muted' },
              builtin()
                ? 'No layout saved yet, so the till is reading the standard in-store label.'
                : formatsNoteText(formats)
            ),
            button(builtin() ? 'Describe our scale' : 'Add a layout', {
              size: 'sm',
              variant: 'primary',
              icon: 'add',
              onClick: () => {
                editing = builtin()
                  ? { ...draftOf(DEFAULT_FORMATS[0]!), name: '', id: '' }
                  : emptyDraft()
                problem = ''
                renderLayouts()
              },
            })
          )
        )
      }

      function editor(draft: FormatDraft, formats: LabelFormat[]): HTMLElement {
        const nameInput = input({
          value: draft.name,
          placeholder: 'Produce scale',
          onInput: (value) => {
            draft.name = value
          },
        })
        const prefixInput = input({
          value: draft.prefix,
          inputmode: 'numeric',
          placeholder: '22',
          onInput: (value) => {
            draft.prefix = value
            preview()
          },
        })
        const pluInput = input({
          value: draft.pluDigits,
          inputmode: 'numeric',
          onInput: (value) => {
            draft.pluDigits = value
            preview()
          },
        })
        const valueInput = input({
          value: draft.valueDigits,
          inputmode: 'numeric',
          onInput: (value) => {
            draft.valueDigits = value
            preview()
          },
        })
        const kindSelect = h(
          'select',
          {
            class:
              'h-11 w-full rounded-md border border-input bg-surface px-3 text-base text-content sm:text-sm',
            onChange: () => {
              draft.valueKind = kindSelect.value === 'price' ? 'price' : 'weight'
              preview()
            },
          },
          h('option', { value: 'weight', selected: draft.valueKind === 'weight' }, 'Weight, in grams'),
          h('option', { value: 'price', selected: draft.valueKind === 'price' }, 'Price of the package')
        )
        const previewHost = h('p', { class: 'mt-2 text-xs text-content-muted' })

        function preview(): void {
          const normalised = normaliseDraft(draft, formats)
          if (!normalised) {
            previewHost.textContent = ''
            return
          }
          const example = labelExample(normalised, '00012')
          const decoded = decodeLabel(example, [normalised])
          previewHost.textContent = decoded
            ? `A label from this layout looks like ${example} — the till would read ${labelValueText(
                decoded,
                context.currency
              )} and look up ${decoded.plu}.`
            : `A label from this layout looks like ${example}, which this layout cannot read back — check the digit counts.`
        }

        const save = (): void => {
          const message = validateFormat(draft, own())
          if (message) {
            problem = message
            renderLayouts()
            return
          }
          const normalised = normaliseDraft(draft, formats)
          if (!normalised) {
            problem = 'Those digit counts do not describe a label.'
            renderLayouts()
            return
          }
          const others = own().filter((format) => format.id !== draft.id)
          void persist([...others, { ...normalised, id: formatIdFor(draft.prefix, draft.pluDigits, draft.valueDigits) }])
        }

        preview()

        return panel(
          cardHeader(editing?.id ? 'Edit layout' : 'A new layout', {
            subtitle: 'Copy the numbers from a label your scale has already printed.',
            iconName: 'edit',
          }),
          h(
            'div',
            { class: 'space-y-3 px-4 pb-4' },
            field('Name it', nameInput, {
              hint: 'How the shop will recognise it later — “Produce scale”.',
            }),
            h(
              'div',
              { class: 'grid gap-3 sm:grid-cols-3' },
              field('Prefix', prefixInput, { hint: 'The first digits, before the PLU.' }),
              field('PLU digits', pluInput, { hint: 'How many digits your scale uses for the PLU.' }),
              field('Value digits', valueInput, {
                hint: draft.valueKind === 'weight' ? 'Weight digits, read as grams.' : 'Digits that hold the price.',
              })
            ),
            h(
              'div',
              { class: 'grid gap-3 sm:grid-cols-2' },
              field('The value digits mean', kindSelect),
              h(
                'div',
                { class: 'flex items-end pb-2' },
                checkbox({
                  checked: draft.checkDigit,
                  label: 'The label ends in an EAN-13 check digit',
                  onChange: (checked) => {
                    draft.checkDigit = checked
                    preview()
                  },
                })
              )
            ),
            previewHost,
            h(
              'div',
              { class: 'flex items-center gap-2 pt-1' },
              button('Save layout', { variant: 'primary', size: 'sm', icon: 'save', onClick: save }),
              button('Cancel', {
                size: 'sm',
                onClick: () => {
                  editing = null
                  problem = ''
                  renderLayouts()
                },
              })
            )
          )
        )
      }

      async function persist(next: LabelFormat[]): Promise<void> {
        try {
          await deps.settings.set(FORMATS_KEY, next)
          editing = null
          problem = ''
          renderHeader()
          renderLayouts()
          toastSuccess('The till reads labels with this layout from now on.')
        } catch (error) {
          toastError(describeError(error))
        }
      }

      async function remove(index: number): Promise<void> {
        const formats = saved()
        const gone = formats[index]
        if (!gone) return
        const sure = await confirm(`Remove “${gone.name}”?`, {
          message: 'The till stops reading labels from this layout. Nothing already sold changes.',
          confirmLabel: 'Remove',
          tone: 'danger',
          iconName: 'delete',
        })
        if (!sure) return
        await persist(formats.filter((_format, at) => at !== index))
      }

      // ── The month ───────────────────────────────────────────────────────
      async function renderGlance(): Promise<void> {
        mount(glanceHost, skeleton('h-24 w-full'), skeleton('h-24 w-full'), skeleton('h-24 w-full'))
        try {
          const data = await deps.db.rpc<Overview>('overview', {
            branch_id: context.branchId,
          })
          mount(
            glanceHost,
            stat(
              context.branchId ? 'Weighed here this month' : 'Weighed this month',
              weightText(Math.round((data.month?.qty ?? 0) * 1000)),
              {
                iconName: 'scale',
                hint: `${data.month?.lines ?? 0} line${(data.month?.lines ?? 0) === 1 ? '' : 's'}${
                  data.month_label ? ` · ${data.month_label}` : ''
                }`,
              }
            ),
            stat('Weighed today', weightText(Math.round((data.today?.qty ?? 0) * 1000)), {
              iconName: 'today',
              hint: `${data.today?.lines ?? 0} line${(data.today?.lines ?? 0) === 1 ? '' : 's'}`,
            }),
            stat('Items to fix', String(data.codes?.attention ?? 0), {
              iconName: data.codes?.attention ? 'error' : 'check_circle',
              tone: data.codes?.attention ? 'warning' : 'success',
              hint:
                (data.codes?.attention ?? 0) === 0
                  ? 'Every weighed item has a code the scale can print.'
                  : `Of ${data.codes?.all ?? 0} weighed items — see Reports → Scale codes.`,
            })
          )
        } catch (error) {
          mount(
            glanceHost,
            card(
              emptyState('The month could not be read', {
                description: error instanceof Error ? error.message : 'Try again in a moment.',
                iconName: 'error',
              })
            )
          )
        }
      }

      // ── Draw it ─────────────────────────────────────────────────────────
      const probeInput = input({
        value: '',
        placeholder: 'Scan or type a label — e.g. 2212340007504',
        inputmode: 'numeric',
        leadingIcon: 'barcode_scanner',
        onInput: (value) => {
          probe = value
          renderProbe()
        },
        onEnter: (value) => {
          probe = value
          renderProbe()
        },
      })

      function renderHeader(): void {
        mount(
          headerHost,
          card(
            cardHeader('Weighing scale', {
              iconName: 'scale',
              subtitle: builtin()
                ? 'The till is reading the standard in-store label. Describe your own and it will read that instead.'
                : `The till reads ${saved().length} label layout${saved().length === 1 ? '' : 's'} this shop described.`,
              actions: h(
                'div',
                { class: 'flex items-center gap-2' },
                badge(`${saved().length} layout${saved().length === 1 ? '' : 's'}`, {
                  tone: builtin() ? 'neutral' : 'success',
                  iconName: 'barcode_scanner',
                })
              ),
            })
          )
        )
      }

      renderHeader()

      mount(
        root,
        headerHost,
        glanceHost,
        panel(
          cardHeader('Read a label', {
            subtitle: 'The cashier’s scanner types into the till. Do the same here to see what the till would do.',
            iconName: 'barcode_reader',
          }),
          h(
            'div',
            { class: 'px-4 pb-4' },
            field(undefined, probeInput, {
              hint: 'Type or scan, then press Enter. Nothing is scanned into a sale here.',
            }),
            testHost
          )
        ),
        panel(
          cardHeader('This shop’s label layouts', {
            subtitle: 'One row per scale. The till tries them in this order.',
            iconName: 'list',
          }),
          layoutsHost
        )
      )

      renderProbe()
      renderLayouts()
      void renderGlance()

      return root
    },
  }
}

// ── Small helpers, kept out of the render functions ────────────────────────

/** A draft that describes a real label, or null while it still does not. */
function normaliseDraft(draft: FormatDraft, formats: LabelFormat[]): LabelFormat | null {
  const candidate: LabelFormat = {
    id: formatIdFor(draft.prefix, draft.pluDigits, draft.valueDigits),
    name: draft.name.trim() === '' ? 'Label' : draft.name.trim(),
    prefix: draft.prefix.replace(/[^0-9]/g, ''),
    pluDigits: Number(draft.pluDigits.replace(/[^0-9]/g, '')),
    valueDigits: Number(draft.valueDigits.replace(/[^0-9]/g, '')),
    valueKind: draft.valueKind,
    checkDigit: draft.checkDigit,
  }
  if (candidate.prefix === '') return null
  if (!Number.isInteger(candidate.pluDigits) || candidate.pluDigits < 1 || candidate.pluDigits > 8) return null
  if (!Number.isInteger(candidate.valueDigits) || candidate.valueDigits < 1 || candidate.valueDigits > 6) return null
  if (formats.some((format) => format.id === candidate.id && format.id !== draft.id)) return null
  return candidate
}

function formatsNoteText(formats: LabelFormat[]): string {
  return `The till will try ${formats.map((format) => format.name).join(', then ')}.`
}
