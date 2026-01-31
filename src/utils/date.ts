/**
 * Central date utility module.
 *
 * ALL business date construction and formatting goes through this module.
 * Internally uses UTC to avoid timezone drift — `new Date('2026-02-28')` in a
 * non-UTC timezone can shift to Feb 27 or Mar 1, so we always construct via
 * Date.UTC and format manually.
 *
 * No other module should call `new Date()` directly for business dates.
 */

/**
 * Formats a Date object as a YYYY-MM-DD string.
 * Uses UTC components to avoid timezone shifts.
 */
export function toDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses a YYYY-MM-DD string into a Date object (UTC midnight).
 * Throws on invalid format or invalid date values.
 */
export function parseDate(str: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!match) {
    throw new Error(`Invalid date format: "${str}". Expected YYYY-MM-DD.`);
  }

  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const day = parseInt(match[3]!, 10);

  if (month < 1 || month > 12) {
    throw new Error(`Invalid month ${month} in date "${str}".`);
  }

  // Construct in UTC and verify the date didn't overflow
  // (e.g., Feb 30 would roll to Mar 2)
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date: "${str}" does not exist.`);
  }

  return date;
}

/**
 * Adds (or subtracts) N calendar days from a date. Returns a new Date.
 */
export function addDays(date: Date, n: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + n));
}

/**
 * Returns the last day of the given month (1-indexed).
 * E.g., lastDayOfMonth(2026, 2) = 28, lastDayOfMonth(2028, 2) = 29.
 */
export function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of *this* month
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Computes the monthly due date for a loan.
 *
 * `monthly_due_day` is immutable — set once at disbursement. The computed due
 * date adapts to short months but "bounces back" when the month is long enough.
 *
 * Examples with monthly_due_day = 31:
 *   getDueDate(31, 2026, 1) -> Jan 31
 *   getDueDate(31, 2026, 2) -> Feb 28
 *   getDueDate(31, 2026, 3) -> Mar 31 (bounces back)
 */
export function getDueDate(monthlyDueDay: number, year: number, month: number): Date {
  const last = lastDayOfMonth(year, month);
  const day = Math.min(monthlyDueDay, last);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Returns today's date as a YYYY-MM-DD string (UTC).
 */
export function today(): string {
  return toDateString(new Date());
}

/**
 * Calculates the number of days between two dates (date2 - date1).
 * Both dates are treated as UTC dates; time components are ignored.
 */
export function daysBetween(date1: Date, date2: Date): number {
  const utc1 = Date.UTC(date1.getUTCFullYear(), date1.getUTCMonth(), date1.getUTCDate());
  const utc2 = Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth(), date2.getUTCDate());
  return Math.round((utc2 - utc1) / (1000 * 60 * 60 * 24));
}
