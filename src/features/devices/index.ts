import type { Route } from '../../app/router/router'
import { printerSetupView } from './printer-setup-view'
import { scannerSetupView } from './scanner-setup-view'

/**
 * Hardware setup.
 *
 * Gated on `settings.view` rather than a new permission: the permission
 * catalogue is checked against the database by `tools/validate-migrations.mjs`,
 * so inventing `devices.manage` here would fail the build until a migration
 * added it — and "who may configure the printer" is the same question as "who
 * may configure the shop", which this key already answers.
 */
export function deviceRoutes(): Route[] {
  return [
    {
      path: '/printer-setup',
      title: 'Printer setup',
      permission: 'settings.view',
      render: () => printerSetupView(),
    },
    {
      path: '/scanner-setup',
      title: 'Barcode scanner setup',
      permission: 'settings.view',
      render: () => scannerSetupView(),
    },
  ]
}

export { printerSetupView, scannerSetupView }

// The till needs these: a print that fails for want of setup, or a scanner
// mode this browser cannot honour, is reported by the POS but answered by
// these pages. Public so `features/pos` never reaches into this folder.
export { promptDeviceSetup, reportPrintFailure, requirePrinterSetup, type DeviceKind } from './setup-prompt'
