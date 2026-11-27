import { BadRequestException } from '@nestjs/common';
import {
  parseOptionalDate,
  resolveDateRange,
  buildReportEnvelope,
} from './reports.common';

describe('reports.common helpers', () => {
  // ----------------------------------------------------------------
  // parseOptionalDate
  // ----------------------------------------------------------------
  describe('parseOptionalDate', () => {
    it('returns undefined for undefined input', () => {
      expect(parseOptionalDate(undefined, 'startDate')).toBeUndefined();
    });

    it('returns undefined for null input', () => {
      expect(parseOptionalDate(null as any, 'startDate')).toBeUndefined();
    });

    it('returns undefined for empty string input', () => {
      expect(parseOptionalDate('', 'startDate')).toBeUndefined();
    });

    it('returns the same Date instance when passed a Date', () => {
      const d = new Date('2024-01-15T00:00:00.000Z');
      const result = parseOptionalDate(d, 'startDate');
      expect(result).toBe(d);
    });

    it('parses a valid ISO string into a Date', () => {
      const result = parseOptionalDate('2024-06-01T00:00:00.000Z', 'startDate');
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe('2024-06-01T00:00:00.000Z');
    });

    it('throws BadRequestException for an unparseable string containing the field name', () => {
      expect(() => parseOptionalDate('not-a-date', 'startDate')).toThrow(
        BadRequestException,
      );
      expect(() => parseOptionalDate('not-a-date', 'startDate')).toThrow(
        'startDate',
      );
    });

    it('throws BadRequestException with the custom field name in the message', () => {
      expect(() => parseOptionalDate('bad', 'endDate')).toThrow('endDate');
    });
  });

  // ----------------------------------------------------------------
  // resolveDateRange
  // ----------------------------------------------------------------
  describe('resolveDateRange', () => {
    it('returns empty range when called with no arguments', () => {
      const result = resolveDateRange();
      expect(result.startDate).toBeUndefined();
      expect(result.endDate).toBeUndefined();
    });

    it('returns empty range when called with an empty object', () => {
      const result = resolveDateRange({});
      expect(result.startDate).toBeUndefined();
      expect(result.endDate).toBeUndefined();
    });

    it('resolves only startDate when only startDate is provided', () => {
      const result = resolveDateRange({ startDate: '2024-01-01' });
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeUndefined();
    });

    it('resolves only endDate when only endDate is provided', () => {
      const result = resolveDateRange({ endDate: '2024-12-31' });
      expect(result.endDate).toBeInstanceOf(Date);
      expect(result.startDate).toBeUndefined();
    });

    it('resolves both bounds when a valid range is provided', () => {
      const result = resolveDateRange({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
      expect(result.startDate!.getTime()).toBeLessThan(result.endDate!.getTime());
    });

    it('throws BadRequestException when startDate is after endDate', () => {
      expect(() =>
        resolveDateRange({ startDate: '2024-12-31', endDate: '2024-01-01' }),
      ).toThrow(BadRequestException);
      expect(() =>
        resolveDateRange({ startDate: '2024-12-31', endDate: '2024-01-01' }),
      ).toThrow('startDate must be before endDate');
    });
  });

  // ----------------------------------------------------------------
  // buildReportEnvelope
  // ----------------------------------------------------------------
  describe('buildReportEnvelope', () => {
    it('wraps data in an envelope with an empty meta by default', () => {
      const result = buildReportEnvelope([1, 2, 3]);
      expect(result.data).toEqual([1, 2, 3]);
      expect(result.meta).toEqual({});
    });

    it('includes provided meta in the envelope', () => {
      const meta = { total: 5, page: 1 };
      const result = buildReportEnvelope({ key: 'value' }, meta);
      expect(result.data).toEqual({ key: 'value' });
      expect(result.meta).toEqual(meta);
    });

    it('handles null/undefined data gracefully', () => {
      const result = buildReportEnvelope(null);
      expect(result.data).toBeNull();
    });
  });
});
