/**
 * Printer Setup — behaviour.
 *
 * Two screens' worth of configuration for the shops that print: pairing over
 * Bluetooth, USB or a LAN bridge, a test page that goes through exactly the
 * path a real receipt takes, and the invoice designer that decides what the
 * paper says.
 *
 * It registers a nav item and one route. Everything it configures is read by
 * the core through `shared/devices` and `shared/receipt`, so a sale printed
 * with this plugin switched off still prints — through the browser dialog,
 * with the default design. Nothing here is on the path of a sale.
 *
 * This file imports nothing from `src/features/` and nothing from another
 * plugin. If adding it ever requires editing a feature, the architecture has
 * failed (spec §51).
 */

import type { Plugin, PluginAPI, PluginPageModule } from '../../shared/registry/plugin-types'
import { printerSetupManifest } from './manifest'

export const printerSetupPlugin: Plugin = {
  id: printerSetupManifest.id,
  name: printerSetupManifest.name,
  version: printerSetupManifest.version,
  description: printerSetupManifest.description,
  icon: 'print',

  register(api: PluginAPI): void {
    api.registerNav({
      id: 'printer-setup',
      label: 'Printer setup',
      icon: 'print',
      section: 'admin',
      route: '/plugins/printer-setup',
      permission: 'settings.view',
      order: 55,
    })

    api.registerRoute({
      path: '/plugins/printer-setup',
      title: 'Printer setup',
      permission: 'settings.view',
      load: async (): Promise<PluginPageModule> => {
        const view = await import('./printer-setup-view')
        const design = await import('./invoice-design-card')
        return {
          render: (ctx) => {
            // The host knows the shop; a plugin may not read the session for
            // itself. This is only the default — the design's own shop name
            // wins whenever the shopkeeper has set one.
            const page = view.printerSetupView({ shopName: ctx.organizationName })
            page.append(design.invoiceDesignCard({ shopName: ctx.organizationName }))
            return page
          },
        }
      },
    })
  },
}
