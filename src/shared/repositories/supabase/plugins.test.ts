/**
 * The plugin repository's two reads, against a fake client.
 *
 * `catalog` and `state` call different RPCs because they answer to different
 * people: the admin screen shows everything the server ships (needs
 * `plugins.view`), while loading the app needs only what this shop has
 * switched on — which a cashier must be able to do. Wiring the app to the
 * admin call was a real bug in this phase, and it was invisible until the
 * deployed bundle was searched for the RPC it should have been calling. So
 * both mappings are pinned here, and which call the app makes is pinned by
 * the migration validator.
 */

import { describe, it, expect } from 'vitest'
import { createPlugins } from './index'
import type { SupabaseClient } from '@supabase/supabase-js'

const ORG = '11111111-1111-1111-1111-111111111111'

/** Records the RPCs asked for and answers with the payloads given. */
function fakeClient(responses: Record<string, unknown>): {
  client: SupabaseClient
  calls: Array<{ fn: string; args: Record<string, unknown> }>
} {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args })
      const data = responses[fn]
      if (data instanceof Error) return Promise.resolve({ data: null, error: data })
      return Promise.resolve({ data, error: null })
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('plugin state', () => {
  it('asks for what is switched on, and reads every field the host needs', async () => {
    const { client, calls } = fakeClient({
      plugin_state: [
        {
          key: 'loyalty-lite',
          version: '1.0.0',
          enabled: true,
          status: 'ok',
          last_error: null,
          config: { points_per_currency: 2 },
        },
        {
          key: 'batch-expiry',
          version: '1.0.0',
          enabled: false,
          status: 'error',
          last_error: 'boom',
          config: null,
        },
      ],
    })

    const state = await createPlugins(client).state(ORG)

    expect(calls).toEqual([{ fn: 'plugin_state', args: { p_organization_id: ORG } }])
    expect(state[0]).toEqual({
      key: 'loyalty-lite',
      version: '1.0.0',
      enabled: true,
      status: 'ok',
      lastError: null,
      config: { points_per_currency: 2 },
    })
    // A missing config is an empty one, never `null`: a plugin asking for a
    // setting must get its default, not a type error.
    expect(state[1]?.config).toEqual({})
    expect(state[1]?.status).toBe('error')
    expect(state[1]?.lastError).toBe('boom')
  })

  it('treats a non-array answer as no plugins rather than throwing', async () => {
    const { client } = fakeClient({ plugin_state: null })
    expect(await createPlugins(client).state(ORG)).toEqual([])
  })
})

describe('plugin catalog', () => {
  it('asks for the admin list and sorts it by name', async () => {
    const { client, calls } = fakeClient({
      plugin_catalog: [
        {
          key: 'loyalty-lite',
          name: 'Loyalty (lite)',
          category: 'optional',
          version: '1.0.0',
          core_api_version: '^1.0.0',
          description: 'Points.',
          dependencies: [],
          conflicts: [],
          installed: true,
          enabled: true,
          status: 'ok',
          last_error: null,
          config: {},
          enabled_at: '2026-09-25T10:00:00Z',
          permissions: [{ key: 'loyalty-lite.view', label: 'See', category: 'customers', description: null }],
          migrations_total: 2,
          migrations_pending: 1,
        },
        {
          key: 'batch-expiry',
          name: 'Batch & expiry',
          category: 'optional',
          version: '1.0.0',
          core_api_version: '^1.0.0',
          description: 'Batches.',
          dependencies: [],
          conflicts: [],
          installed: false,
          enabled: false,
          status: 'ok',
          last_error: null,
          config: {},
          enabled_at: null,
          permissions: [],
          migrations_total: 0,
          migrations_pending: 0,
        },
      ],
    })

    const catalog = await createPlugins(client).catalog(ORG)

    expect(calls[0]?.fn).toBe('plugin_catalog')
    expect(catalog.map((entry) => entry.name)).toEqual(['Batch & expiry', 'Loyalty (lite)'])
    const loyalty = catalog.find((entry) => entry.key === 'loyalty-lite')
    expect(loyalty?.migrationsPending).toBe(1)
    expect(loyalty?.permissions[0]?.key).toBe('loyalty-lite.view')

    // `installed` means "this shop has a row for it", which is what decides
    // whether its settings can be edited — the settings live in that row.
    expect(loyalty?.installed).toBe(true)
    expect(catalog.find((entry) => entry.key === 'batch-expiry')?.installed).toBe(false)
  })
})
