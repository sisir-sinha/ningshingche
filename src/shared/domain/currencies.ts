/**
 * ISO 4217 currencies, as a list a shop can pick from.
 *
 * Currency used to be a free-text box with a three-letter `maxlength`, which
 * is a quiz: type the right code from memory and the receipts are right,
 * typo it and every price in the shop renders with a broken symbol. A list
 * cannot be mistyped.
 *
 * Not the full ISO register — the register contains testing codes, metals
 * (XAU) and currencies no counter will ever take. This is every currency a
 * Mekholi shop plausibly prices in: South Asia first, because that is the
 * market, then the rest of the world by usage.
 *
 * `symbol` is here rather than fetched from `Intl` so the picker reads the
 * same on a device with a thin ICU build (several Android WebViews), where
 * `Intl` answers with the bare code.
 */

export interface CurrencyOption {
  /** ISO 4217 alphabetic code. */
  readonly code: string
  /** English name, as shown in the picker. */
  readonly name: string
  /** What a receipt prints in front of the amount. */
  readonly symbol: string
  /** Minor units in one major unit — 2 for taka, 0 for yen. */
  readonly decimals: number
}

export const CURRENCIES: readonly CurrencyOption[] = [
  // ── South Asia ─────────────────────────────────────────────────────────
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', decimals: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2 },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', decimals: 2 },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', decimals: 2 },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'रू', decimals: 2 },
  { code: 'BTN', name: 'Bhutanese Ngultrum', symbol: 'Nu.', decimals: 2 },
  { code: 'MVR', name: 'Maldivian Rufiyaa', symbol: 'ރ.', decimals: 2 },
  { code: 'AFN', name: 'Afghan Afghani', symbol: '؋', decimals: 2 },

  // ── Gulf & Middle East (where a great many remittances come from) ──────
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimals: 2 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', decimals: 2 },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق', decimals: 2 },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك', decimals: 3 },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: '.د.ب', decimals: 3 },
  { code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع.', decimals: 3 },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'د.ا', decimals: 3 },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪', decimals: 2 },
  { code: 'IRR', name: 'Iranian Rial', symbol: '﷼', decimals: 2 },
  { code: 'IQD', name: 'Iraqi Dinar', symbol: 'ع.د', decimals: 3 },
  { code: 'LBP', name: 'Lebanese Pound', symbol: 'ل.ل', decimals: 2 },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', decimals: 2 },

  // ── Major reserve currencies ───────────────────────────────────────────
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'GBP', name: 'Pound Sterling', symbol: '£', decimals: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', decimals: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2 },

  // ── Asia-Pacific ───────────────────────────────────────────────────────
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', decimals: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimals: 2 },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', decimals: 2 },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', decimals: 2 },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', decimals: 2 },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', decimals: 0 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', decimals: 0 },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', decimals: 2 },
  { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$', decimals: 2 },
  { code: 'MMK', name: 'Myanmar Kyat', symbol: 'K', decimals: 2 },
  { code: 'KHR', name: 'Cambodian Riel', symbol: '៛', decimals: 2 },
  { code: 'LAK', name: 'Lao Kip', symbol: '₭', decimals: 2 },
  { code: 'BND', name: 'Brunei Dollar', symbol: 'B$', decimals: 2 },
  { code: 'MNT', name: 'Mongolian Tugrik', symbol: '₮', decimals: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', decimals: 2 },
  { code: 'FJD', name: 'Fijian Dollar', symbol: 'FJ$', decimals: 2 },
  { code: 'PGK', name: 'Papua New Guinean Kina', symbol: 'K', decimals: 2 },

  // ── Central Asia & the Caucasus ────────────────────────────────────────
  { code: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸', decimals: 2 },
  { code: 'UZS', name: 'Uzbekistani Som', symbol: "so'm", decimals: 2 },
  { code: 'AZN', name: 'Azerbaijani Manat', symbol: '₼', decimals: 2 },
  { code: 'GEL', name: 'Georgian Lari', symbol: '₾', decimals: 2 },
  { code: 'AMD', name: 'Armenian Dram', symbol: '֏', decimals: 2 },

  // ── Europe ─────────────────────────────────────────────────────────────
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', decimals: 2 },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', decimals: 2 },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', decimals: 2 },
  { code: 'ISK', name: 'Icelandic Króna', symbol: 'kr', decimals: 0 },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł', decimals: 2 },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', decimals: 2 },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', decimals: 2 },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei', decimals: 2 },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв', decimals: 2 },
  { code: 'RSD', name: 'Serbian Dinar', symbol: 'дин', decimals: 2 },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', decimals: 2 },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', decimals: 2 },

  // ── Africa ─────────────────────────────────────────────────────────────
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', decimals: 2 },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'د.م.', decimals: 2 },
  { code: 'DZD', name: 'Algerian Dinar', symbol: 'د.ج', decimals: 2 },
  { code: 'TND', name: 'Tunisian Dinar', symbol: 'د.ت', decimals: 3 },
  { code: 'LYD', name: 'Libyan Dinar', symbol: 'ل.د', decimals: 3 },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', decimals: 2 },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', decimals: 2 },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', decimals: 2 },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', decimals: 2 },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', decimals: 0 },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br', decimals: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimals: 2 },
  { code: 'MUR', name: 'Mauritian Rupee', symbol: '₨', decimals: 2 },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA', decimals: 0 },
  { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA', decimals: 0 },

  // ── Americas ───────────────────────────────────────────────────────────
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimals: 2 },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'Mex$', decimals: 2 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', decimals: 2 },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$', decimals: 2 },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$', decimals: 0 },
  { code: 'COP', name: 'Colombian Peso', symbol: '$', decimals: 2 },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', decimals: 2 },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U', decimals: 2 },
  { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs', decimals: 2 },
  { code: 'DOP', name: 'Dominican Peso', symbol: 'RD$', decimals: 2 },
  { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$', decimals: 2 },
  { code: 'TTD', name: 'Trinidad & Tobago Dollar', symbol: 'TT$', decimals: 2 },
]

const BY_CODE = new Map(CURRENCIES.map((entry) => [entry.code, entry]))

export function findCurrency(code: string | null | undefined): CurrencyOption | null {
  return BY_CODE.get((code ?? '').trim().toUpperCase()) ?? null
}

/**
 * Picker labels: `BDT — Bangladeshi Taka (৳)`.
 *
 * The code leads because that is what the shop's accountant and the database
 * both use; the name and symbol are there so nobody has to recognise it.
 */
export function currencyLabel(entry: CurrencyOption): string {
  return `${entry.code} — ${entry.name} (${entry.symbol})`
}

/**
 * Options for a `<select>`, with the shop's current code guaranteed present.
 *
 * A row saved before this list existed — or seeded by a migration with
 * something exotic — must not silently change currency just because the
 * picker cannot show it.
 */
export function currencyOptions(includeCode?: string | null): { value: string; label: string }[] {
  const options = CURRENCIES.map((entry) => ({ value: entry.code, label: currencyLabel(entry) }))
  const code = (includeCode ?? '').trim().toUpperCase()
  if (code && !BY_CODE.has(code)) options.unshift({ value: code, label: code })
  return options
}
