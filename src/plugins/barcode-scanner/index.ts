/**
 * Barcode Scanner — behaviour.
 *
 * One screen: the thresholds that decide whether a burst of keystrokes was a
 * scanner or a person typing, and a live test that says which one the device
 * in the shopkeeper's hand is producing.
 *
 * The till's own scan listening is core and stays core — it works with this
 * plugin off, on defaults. This only writes the settings that listener reads,
 * in this device's storage.
 *
 * This file imports nothing from `src/features/` and nothing from another
 * plugin. If adding it ever requires editing a feature, the architecture has
 * failed (spec §51).
 */

import type { Plugin, PluginAPI, PluginPageModule } from '../../shared/registry/plugin-types'
import { barcodeScannerManifest } from './manifest'

export const barcodeScannerPlugin: Plugin = {
  id: barcodeScannerManifest.id,
  name: barcodeScannerManifest.name,
  version: barcodeScannerManifest.version,
  description: barcodeScannerManifest.description,
  icon: 'barcode_scanner',

  register(api: PluginAPI): void {
    api.registerNav({
      id: 'barcode-scanner',
      label: 'Barcode scanner',
      icon: 'barcode_scanner',
      section: 'admin',
      route: '/plugins/barcode-scanner',
      permission: 'settings.view',
      order: 60,
    })

    api.registerRoute({
      path: '/plugins/barcode-scanner',
      title: 'Barcode scanner setup',
      permission: 'settings.view',
      load: async (): Promise<PluginPageModule> => {
        const view = await import('./scanner-setup-view')
        return { render: () => view.scannerSetupView() }
      },
    })
  },
}
