import type { Locale } from "./types";

const numberFormatCache = new Map<string, Intl.NumberFormat>();
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormatCache = new Map<string, Intl.RelativeTimeFormat>();
const pluralRulesCache = new Map<string, Intl.PluralRules>();

export function getNumberFormat(locale: Locale, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let formatter = numberFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatCache.set(key, formatter);
  }
  return formatter;
}

export function getDateTimeFormat(locale: Locale, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let formatter = dateTimeFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeFormatCache.set(key, formatter);
  }
  return formatter;
}

export function getRelativeTimeFormat(
  locale: Locale,
  options?: Intl.RelativeTimeFormatOptions
): Intl.RelativeTimeFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let formatter = relativeTimeFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, options ?? { numeric: "auto" });
    relativeTimeFormatCache.set(key, formatter);
  }
  return formatter;
}

export function getPluralRules(locale: Locale, options?: Intl.PluralRulesOptions): Intl.PluralRules {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let rules = pluralRulesCache.get(key);
  if (!rules) {
    rules = new Intl.PluralRules(locale, options);
    pluralRulesCache.set(key, rules);
  }
  return rules;
}

export function formatTimeShort(date: Date | string | number, locale: Locale): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return getDateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
}

export function formatDateShort(date: Date | string | number, locale: Locale): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return getDateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return getNumberFormat(locale, options).format(value);
}
