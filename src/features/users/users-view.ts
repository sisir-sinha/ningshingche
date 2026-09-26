/** Staff access management (Phase 4). */

import { h, mount } from '../../components/ui/h'
import { button, spinner } from '../../components/ui/button'
import { badge, emptyState } from '../../components/ui/card'
import { field, input, select } from '../../components/ui/input'
import { confirm, modal } from '../../components/feedback/modal'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { getRepositories } from '../../app/data'
import { can } from '../../app/state/session'
import { translateError } from '../../app/platform/errors'
import type { RoleRow, StaffRow } from '../../shared/repositories/contracts'

export function usersView(): HTMLElement {
  const repos = getRepositories()
  let staff: StaffRow[] = []
  let roles: RoleRow[] = []
  let branches: { id: string; name: string; code: string | null; is_primary: boolean }[] = []
  let loading = true

  const root = h('div', { class: 'p-3 sm:p-6' })
  const content = h('div', { class: 'mx-auto max-w-4xl space-y-4' })

  function render(): void {
    if (loading) {
      mount(content, h('div', { class: 'flex justify-center p-12' }, spinner()))
      return
    }
    const invite = can('users.create') ? button('Invite staff', { variant: 'primary', icon: 'person_add', onClick: () => openInvite() }) : null
    mount(content,
      h('div', { class: 'flex flex-wrap items-end justify-between gap-3' },
        h('div', {},
          h('h1', { class: 'text-lg font-semibold text-content', text: 'Staff' }),
          h('p', { class: 'mt-1 text-sm text-content-muted', text: 'Invite people, assign roles and revoke access without deleting their account.' })
        ),
        invite
      ),
      staff.length > 0
        ? h('div', { class: 'divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface' }, ...staff.map((row) => staffRow(row)))
        : emptyState('No staff yet', { description: 'Invite a cashier, manager or accountant to start sharing the shop.', iconName: 'group', action: invite })
    )
  }

  function staffRow(row: StaffRow): HTMLElement {
    const roleText = row.roles.map((role) => role.name).join(', ') || 'No role'
    const branchText = row.branches.length > 0 ? row.branches.map((branch) => branch.name).join(', ') : 'All branches'
    return h('div', { class: 'flex flex-wrap items-center gap-3 p-4' },
      h('div', { class: 'flex min-w-0 flex-1 items-center gap-3' },
        h('div', { class: 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary', text: row.name.charAt(0).toUpperCase() }),
        h('div', { class: 'min-w-0' },
          h('p', { class: 'truncate font-medium text-content', text: row.name }),
          h('p', { class: 'truncate text-sm text-content-muted', text: row.email }),
          h('p', { class: 'truncate text-xs text-content-subtle', text: `${roleText} · ${branchText}` })
        )
      ),
      h('div', { class: 'flex items-center gap-2' },
        badge(row.kind === 'pending' ? 'Invite pending' : row.isActive ? 'Active' : 'Disabled', { tone: row.kind === 'pending' ? 'warning' : row.isActive ? 'success' : 'neutral' }),
        row.kind === 'member' && can('users.edit') ? button('Edit role', { variant: 'ghost', onClick: () => openRoles(row) }) : null,
        row.kind === 'member' && can('users.delete') ? button('Remove', { variant: 'ghost', onClick: () => void remove(row) }) : null
      )
    )
  }

  function openInvite(): void {
    const email = input({ type: 'email', autofocus: true, placeholder: 'cashier@example.com' })
    const role = select({ options: roles.map((item) => ({ value: item.id, label: item.name })), placeholder: 'Choose a role…' })
    const branch = select({ options: branches.map((item) => ({ value: item.id, label: item.name })), placeholder: 'All branches' })
    const error = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
    const save = button('Send invite', { variant: 'primary', fullWidth: true, size: 'lg' })
    const dialog = modal({ title: 'Invite staff', subtitle: 'They receive a secure Supabase sign-in link.', iconName: 'person_add', size: 'sm', footer: [h('div', { class: 'w-full' }, save)] })
    dialog.body.replaceChildren(h('div', { class: 'space-y-4' }, field('Email address', email, { required: true }), field('Role', role, { required: true }), field('Branch access', branch, { hint: 'Leave blank to grant access to every branch.' }), error))
    save.addEventListener('click', () => {
      void (async () => {
        if (!email.value.includes('@') || !role.value) {
          error.textContent = 'Enter a valid email and choose a role.'
          error.classList.remove('hidden')
          return
        }
        save.disabled = true
        try {
          await repos.organization.inviteStaff(email.value.trim(), role.value, branch.value || null)
          dialog.close()
          toastSuccess(`A sign-in link was sent to ${email.value.trim()}.`)
          await reload()
        } catch (err) {
          error.textContent = translateError(err).message
          error.classList.remove('hidden')
          save.disabled = false
        }
      })()
    })
  }

  function openRoles(row: StaffRow): void {
    const role = select({ options: roles.map((item) => ({ value: item.id, label: item.name })), value: row.roles[0]?.id, placeholder: 'No role' })
    const branch = select({ options: branches.map((item) => ({ value: item.id, label: item.name })), value: row.branches[0]?.id, placeholder: 'All branches' })
    const error = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
    const save = button('Save access', { variant: 'primary', fullWidth: true, size: 'lg' })
    const dialog = modal({ title: `Access for ${row.name}`, iconName: 'admin_panel_settings', size: 'sm', footer: [h('div', { class: 'w-full' }, save)] })
    dialog.body.replaceChildren(h('div', { class: 'space-y-4' }, field('Role', role, { required: true }), field('Branch access', branch, { hint: 'Leave blank for all branches.' }), error))
    save.addEventListener('click', () => {
      void (async () => {
        if (!role.value || !row.userId) return
        save.disabled = true
        try {
          await repos.organization.setStaffRoles(row.userId, [role.value], branch.value || null)
          dialog.close()
          toastSuccess('Staff access updated')
          await reload()
        } catch (err) {
          error.textContent = translateError(err).message
          error.classList.remove('hidden')
          save.disabled = false
        }
      })()
    })
  }

  async function remove(row: StaffRow): Promise<void> {
    if (!row.userId) return
    const yes = await confirm(`Remove ${row.name}?`, { message: 'They will lose access to this shop, but their auth account and audit history remain.', confirmLabel: 'Remove access', tone: 'danger', iconName: 'person_remove' })
    if (!yes) return
    try {
      await repos.organization.removeStaff(row.userId)
      toastSuccess('Access removed')
      await reload()
    } catch (error) {
      toastError(translateError(error).message)
    }
  }

  async function reload(): Promise<void> {
    loading = true
    render()
    try {
      ;[staff, roles, branches] = await Promise.all([
        repos.organization.listStaff(),
        repos.organization.listRoles(),
        repos.organization.listBranches(),
      ])
    } catch (error) {
      mount(content, emptyState('Staff could not be loaded', { description: translateError(error).message, iconName: 'error' }))
    } finally {
      loading = false
      render()
    }
  }

  void reload()
  mount(root, content)
  return root
}

export default usersView
