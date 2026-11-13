import { describe, expect, it } from 'vitest';
import {
  officeBookingsPath,
  officePath,
  officePlanPath,
  officeSettingsPath,
  parseOfficeRoute,
} from './routes';

describe('office workspace navigation', () => {
  it('opens the constructor directly at the office URL', () => {
    expect(parseOfficeRoute('/admin/offices/office-1')).toEqual({
      officeId: 'office-1',
      view: 'plan',
    });
    expect(officePlanPath('office-1')).toBe(officePath('office-1'));
  });

  it('keeps old plan links valid and separates bookings from settings', () => {
    expect(parseOfficeRoute('/admin/offices/office-1/plan')?.view).toBe('plan');
    expect(parseOfficeRoute(officeBookingsPath('office-1'))?.view).toBe('bookings');
    expect(parseOfficeRoute(officeSettingsPath('office-1'))?.view).toBe('settings');
  });

  it('preserves an encoded office identity through every section', () => {
    const id = 'Офис / №2';
    for (const path of [officePath(id), officeBookingsPath(id), officeSettingsPath(id)]) {
      expect(parseOfficeRoute(path)?.officeId).toBe(id);
    }
  });

  it('does not recognize malformed or unrelated administrative routes', () => {
    for (const path of [
      '/admin/offices',
      '/admin/users',
      '/admin/offices/%E0%A4%A',
      '/admin/offices/id/settings/other',
    ]) {
      expect(parseOfficeRoute(path)).toBeNull();
    }
  });
});
