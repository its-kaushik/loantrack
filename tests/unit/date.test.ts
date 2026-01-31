import { toDateString, parseDate, addDays, getDueDate, daysBetween, lastDayOfMonth } from '../../src/utils/date';

describe('Date Utility', () => {
  describe('toDateString', () => {
    it('formats a UTC date as YYYY-MM-DD', () => {
      const date = new Date(Date.UTC(2026, 0, 15)); // Jan 15, 2026
      expect(toDateString(date)).toBe('2026-01-15');
    });

    it('pads single-digit months and days', () => {
      const date = new Date(Date.UTC(2026, 2, 5)); // Mar 5, 2026
      expect(toDateString(date)).toBe('2026-03-05');
    });
  });

  describe('parseDate', () => {
    it('parses a valid YYYY-MM-DD string to a UTC Date', () => {
      const date = parseDate('2026-02-28');
      expect(date.getUTCFullYear()).toBe(2026);
      expect(date.getUTCMonth()).toBe(1); // 0-indexed
      expect(date.getUTCDate()).toBe(28);
    });

    it('round-trips correctly regardless of timezone', () => {
      // This is the critical timezone safety test
      expect(toDateString(parseDate('2026-02-28'))).toBe('2026-02-28');
      expect(toDateString(parseDate('2026-01-01'))).toBe('2026-01-01');
      expect(toDateString(parseDate('2026-12-31'))).toBe('2026-12-31');
    });

    it('throws on invalid format', () => {
      expect(() => parseDate('2026/02/28')).toThrow('Invalid date format');
      expect(() => parseDate('28-02-2026')).toThrow('Invalid date format');
      expect(() => parseDate('not-a-date')).toThrow('Invalid date format');
    });

    it('throws on invalid date values', () => {
      expect(() => parseDate('2026-02-30')).toThrow('does not exist');
      expect(() => parseDate('2026-13-01')).toThrow('Invalid month');
      expect(() => parseDate('2026-00-15')).toThrow('Invalid month');
    });

    it('handles leap year Feb 29', () => {
      // 2028 is a leap year
      const date = parseDate('2028-02-29');
      expect(toDateString(date)).toBe('2028-02-29');

      // 2026 is NOT a leap year
      expect(() => parseDate('2026-02-29')).toThrow('does not exist');
    });
  });

  describe('addDays', () => {
    it('adds days correctly', () => {
      const date = parseDate('2026-01-30');
      expect(toDateString(addDays(date, 1))).toBe('2026-01-31');
      expect(toDateString(addDays(date, 2))).toBe('2026-02-01');
    });

    it('subtracts days with negative values', () => {
      const date = parseDate('2026-03-01');
      expect(toDateString(addDays(date, -1))).toBe('2026-02-28');
    });

    it('handles crossing year boundaries', () => {
      const date = parseDate('2025-12-31');
      expect(toDateString(addDays(date, 1))).toBe('2026-01-01');
    });
  });

  describe('lastDayOfMonth', () => {
    it('returns correct last day for various months', () => {
      expect(lastDayOfMonth(2026, 1)).toBe(31); // January
      expect(lastDayOfMonth(2026, 2)).toBe(28); // February (non-leap)
      expect(lastDayOfMonth(2028, 2)).toBe(29); // February (leap)
      expect(lastDayOfMonth(2026, 4)).toBe(30); // April
      expect(lastDayOfMonth(2026, 12)).toBe(31); // December
    });
  });

  describe('getDueDate', () => {
    it('returns the due day when the month has enough days', () => {
      expect(toDateString(getDueDate(15, 2026, 1))).toBe('2026-01-15');
      expect(toDateString(getDueDate(15, 2026, 3))).toBe('2026-03-15');
    });

    it('clamps to last day for short months', () => {
      // Due day 31 in February -> Feb 28
      expect(toDateString(getDueDate(31, 2026, 2))).toBe('2026-02-28');
      // Due day 30 in February -> Feb 28
      expect(toDateString(getDueDate(30, 2026, 2))).toBe('2026-02-28');
    });

    it('bounces back after short months', () => {
      // Due day 31: Feb clamps to 28, but March goes back to 31
      expect(toDateString(getDueDate(31, 2026, 2))).toBe('2026-02-28');
      expect(toDateString(getDueDate(31, 2026, 3))).toBe('2026-03-31');
    });

    it('handles leap year February with due day 29', () => {
      // 2028 is a leap year
      expect(toDateString(getDueDate(29, 2028, 2))).toBe('2028-02-29');
      // 2026 is not
      expect(toDateString(getDueDate(29, 2026, 2))).toBe('2026-02-28');
    });
  });

  describe('daysBetween', () => {
    it('calculates positive days between dates', () => {
      const d1 = parseDate('2026-01-01');
      const d2 = parseDate('2026-01-31');
      expect(daysBetween(d1, d2)).toBe(30);
    });

    it('returns negative when date2 is before date1', () => {
      const d1 = parseDate('2026-01-31');
      const d2 = parseDate('2026-01-01');
      expect(daysBetween(d1, d2)).toBe(-30);
    });

    it('returns 0 for same date', () => {
      const d = parseDate('2026-06-15');
      expect(daysBetween(d, d)).toBe(0);
    });
  });
});
