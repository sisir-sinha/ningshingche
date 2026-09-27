/**
 * Devices — what is left in the core.
 *
 * The setup screens moved out to the Printer Setup and Barcode Scanner
 * plugins: most shops print nothing and scan on the defaults, so carrying
 * pairing dialogs and an ESC/POS test page in every bundle was the wrong
 * trade. What stays here is the one thing a sale needs — telling a cashier
 * that a device is not ready, and where to go about it.
 *
 * The hardware itself is described in `shared/devices` and the receipt in
 * `shared/receipt`, both core, both usable with every plugin switched off.
 */

export { promptDeviceSetup, reportPrintFailure, requirePrinterSetup, type DeviceKind } from './setup-prompt'
