/**
 * IANA time zones, as a list a shop can pick from.
 *
 * Time zone decides which day a sale belongs to. Typed by hand it was one
 * keystroke away from `Asia/Dahka`, which Postgres rejects and the shop
 * discovers at the end of a reporting month.
 *
 * The full list comes from the runtime — `Intl.supportedValuesOf('timeZone')`
 * returns every zone the browser's ICU knows, which is the same set Postgres
 * accepts and is always current without this file shipping a tzdata copy.
 * Where that is missing (older Safari, thin Android WebViews) a curated
 * fallback covers the regions Mekholi is used in, so the control degrades to
 * "fewer choices" rather than "empty select".
 */

/** Zones worth having even when the runtime cannot enumerate its own. */
const FALLBACK_ZONES: readonly string[] = [
  'Asia/Dhaka',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Kathmandu',
  'Asia/Colombo',
  'Asia/Thimphu',
  'Asia/Kabul',
  'Asia/Yangon',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Kuala_Lumpur',
  'Asia/Singapore',
  'Asia/Manila',
  'Asia/Ho_Chi_Minh',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Qatar',
  'Asia/Kuwait',
  'Asia/Bahrain',
  'Asia/Muscat',
  'Asia/Tehran',
  'Asia/Baghdad',
  'Asia/Amman',
  'Asia/Jerusalem',
  'Asia/Tashkent',
  'Asia/Almaty',
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/Rome',
  'Europe/Vienna',
  'Europe/Prague',
  'Europe/Warsaw',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Helsinki',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Kyiv',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Africa/Algiers',
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Addis_Ababa',
  'Africa/Johannesburg',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Pacific/Auckland',
  'Pacific/Fiji',
  'Australia/Perth',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Australia/Adelaide',
  'Atlantic/Reykjavik',
  'UTC',
]

let cached: readonly string[] | null = null

/** Every zone this runtime will accept, sorted. */
export function timeZones(): readonly string[] {
  if (cached) return cached
  let zones: string[] = []
  try {
    const supported = (
      Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf
    if (typeof supported === 'function') zones = supported.call(Intl, 'timeZone')
  } catch {
    zones = []
  }
  if (zones.length === 0) zones = [...FALLBACK_ZONES]
  if (!zones.includes('UTC')) zones.push('UTC')
  cached = [...new Set(zones)].sort((a, b) => a.localeCompare(b))
  return cached
}

/** The device's own zone, for a shop being set up for the first time. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Current UTC offset of a zone, as `+06:00`.
 *
 * Computed rather than tabulated because it moves: half the world changes it
 * twice a year, and a hard-coded table is wrong for six months at a time.
 */
export function utcOffset(zone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    }).formatToParts(at)
    const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
    // "GMT+6" / "GMT+06:00" / "GMT" for UTC itself.
    const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(raw)
    if (!match) return '+00:00'
    const [, sign, hours, minutes = '00'] = match
    return `${sign}${(hours ?? '0').padStart(2, '0')}:${minutes}`
  } catch {
    return '+00:00'
  }
}

/** Picker label: `(UTC+06:00) Asia/Dhaka`. */
export function timeZoneLabel(zone: string, at: Date = new Date()): string {
  return `(UTC${utcOffset(zone, at)}) ${zone.replace(/_/g, ' ')}`
}

/**
 * Options for a `<select>`, ordered by offset then name, with the shop's
 * saved zone guaranteed present even if this runtime has never heard of it.
 */
export function timeZoneOptions(includeZone?: string | null): { value: string; label: string }[] {
  const at = new Date()
  const zones = [...timeZones()]
  const wanted = (includeZone ?? '').trim()
  if (wanted && !zones.includes(wanted)) zones.unshift(wanted)
  return zones
    .map((zone) => ({ zone, offset: utcOffset(zone, at) }))
    .sort((a, b) => minutesOf(a.offset) - minutesOf(b.offset) || a.zone.localeCompare(b.zone))
    .map(({ zone }) => ({ value: zone, label: timeZoneLabel(zone, at) }))
}

function minutesOf(offset: string): number {
  const match = /([+-])(\d{2}):(\d{2})/.exec(offset)
  if (!match) return 0
  const [, sign, hours, minutes] = match
  const total = Number(hours) * 60 + Number(minutes)
  return sign === '-' ? -total : total
}
