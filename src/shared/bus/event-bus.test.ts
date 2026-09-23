/**
 * EventBus tests.
 *
 * The guarantees that matter are the ones a caller cannot see: that a throwing
 * handler does not silently swallow its siblings, that `once` really
 * unsubscribes, and that a domain event delivered twice is applied once.
 */

import { describe, it, expect, vi } from 'vitest'
import { EventBus, dedupe } from './event-bus'
import type { SaleCompletedData, DomainEvent } from './events'

function saleEvent(id: string, total = '750'): DomainEvent<'sale', 'sale.completed', SaleCompletedData> {
  return {
    id,
    organization_id: 'org-1',
    aggregate: 'sale',
    type: 'sale.completed',
    data: { sale_id: 'sale-1', invoice_no: 'INV-2026-000001', branch_id: 'b-1', customer_id: null, total },
    created_at: '2026-01-01T00:00:00Z',
    version: 1,
  }
}

describe('EventBus', () => {
  it('delivers an event to an exact-match listener', () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.on('sale.completed', (event) => seen.push(event.data.invoice_no))

    bus.emit('sale.completed', saleEvent('e1'))

    expect(seen).toEqual(['INV-2026-000001'])
  })

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    const off = bus.on('sale.completed', listener)

    bus.emit('sale.completed', saleEvent('e1'))
    off()
    bus.emit('sale.completed', saleEvent('e2'))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(bus.listenerCount).toBe(0)
  })

  it('fires once() exactly once', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.once('sale.completed', listener)

    bus.emit('sale.completed', saleEvent('e1'))
    bus.emit('sale.completed', saleEvent('e2'))

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('unsubscribing from once() before it fires prevents delivery', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    const off = bus.once('sale.completed', listener)
    off()

    bus.emit('sale.completed', saleEvent('e1'))

    expect(listener).not.toHaveBeenCalled()
  })

  it('routes onDomain to every event in that aggregate', () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.onDomain('sale', (event) => seen.push(event.type))

    bus.emit('sale.created', {
      id: 'e1',
      organization_id: 'org-1',
      aggregate: 'sale',
      type: 'sale.created',
      data: { sale_id: 's1', invoice_no: 'INV-1' },
      created_at: '2026-01-01T00:00:00Z',
      version: 1,
    })
    bus.emit('sale.completed', saleEvent('e2'))
    bus.emit('stock.adjusted', {
      id: 'e3',
      organization_id: 'org-1',
      aggregate: 'stock',
      type: 'stock.adjusted',
      data: { product_id: 'p1', variant_id: 'v1', branch_id: 'b1', quantity: '2', reason: 'damage' },
      created_at: '2026-01-01T00:00:00Z',
      version: 1,
    })

    expect(seen).toEqual(['sale.created', 'sale.completed'])
  })

  it('matches a `*` pattern against every event', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.onPattern('*', listener)

    bus.emit('ui.toast', { type: 'ui.toast', data: { message: 'hi', tone: 'info' } })
    bus.emit('sale.completed', saleEvent('e1'))

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not let `sale.*` match `sales.*` — the prefix is anchored', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.onPattern('sale.*', listener)

    bus.emit('session.changed', { type: 'session.changed', data: { organization_id: 'o' } })

    expect(listener).not.toHaveBeenCalled()
  })

  it('isolates a throwing handler so its siblings still run', () => {
    const bus = new EventBus()
    const errors: unknown[] = []
    bus.onError = (error) => errors.push(error)

    const second = vi.fn()
    bus.on('sale.completed', () => {
      throw new Error('handler exploded')
    })
    bus.on('sale.completed', second)

    bus.emit('sale.completed', saleEvent('e1'))

    expect(second).toHaveBeenCalledTimes(1)
    expect(errors).toHaveLength(1)
    expect(bus.stats.errors).toBe(1)
  })

  it('clear() drops every listener, so nothing outlives logout', () => {
    const bus = new EventBus()
    bus.on('sale.completed', () => undefined)
    bus.onPattern('*', () => undefined)
    expect(bus.listenerCount).toBe(2)

    bus.clear()

    expect(bus.listenerCount).toBe(0)
  })

  it('counts deliveries for diagnostics', () => {
    const bus = new EventBus()
    bus.on('sale.completed', () => undefined)
    bus.onPattern('sale.*', () => undefined)

    bus.emit('sale.completed', saleEvent('e1'))

    expect(bus.stats.emitted).toBe(1)
    expect(bus.stats.delivered).toBe(2)
  })
})

describe('dedupe', () => {
  it('applies the first delivery of an event id and ignores repeats', () => {
    const applied: string[] = []
    const handler = dedupe((event: { id: string }) => applied.push(event.id))

    handler(saleEvent('e1'))
    handler(saleEvent('e1'))
    handler(saleEvent('e2'))
    handler(saleEvent('e1'))

    // This is the Realtime double-delivery case: the same outbox row arrives
    // locally and again over the socket.
    expect(applied).toEqual(['e1', 'e2'])
  })

  it('evicts the oldest ids once past capacity', () => {
    const applied: string[] = []
    const handler = dedupe((event: { id: string }) => applied.push(event.id), 2)

    handler(saleEvent('a'))
    handler(saleEvent('b'))
    handler(saleEvent('c')) // evicts 'a'
    handler(saleEvent('a')) // 'a' is forgotten, so it applies again

    expect(applied).toEqual(['a', 'b', 'c', 'a'])
  })

  it('returns undefined for a suppressed delivery so callers can branch', () => {
    const handler = dedupe((event: { id: string }) => event.id)

    expect(handler(saleEvent('e1'))).toBe('e1')
    expect(handler(saleEvent('e1'))).toBeUndefined()
  })
})
