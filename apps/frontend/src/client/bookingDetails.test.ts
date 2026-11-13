import { describe, expect, it } from 'vitest';
import { createDemoConfig } from '../model';
import type { ClientBooking } from './types';
import {
  getBookingCancellationMessage,
  getBookingResourceDetails,
  getBookingReviewMessages,
  getBookingWarningMessages,
  isBookingHistorical,
} from './bookingDetails';

const booking = (extra: Partial<ClientBooking> = {}): ClientBooking => ({
  id: 'booking',
  buildingId: 'office-demo',
  floorId: 'removed-floor',
  resourceId: 'shared-id',
  date: '2026-11-12',
  start: 600,
  end: 660,
  ownerId: 'employee',
  ownerName: 'Анна Соколова',
  status: 'active',
  ...extra,
});

describe('historical booking labels', () => {
  it('uses the saved room and floor after removal, without borrowing an ID from another floor or office', () => {
    const office = createDemoConfig();
    const resource = office.floors[0].elements.find((item) => item.kind === 'room')!;
    resource.id = 'shared-id';
    resource.name = 'Другое помещение';
    const row = booking({
      resourceSnapshot: {
        name: 'Прежняя переговорная',
        floor_id: 'removed-floor',
        floor_name: 'Старый этаж',
      },
    });
    expect(getBookingResourceDetails(row, office)).toMatchObject({
      name: 'Прежняя переговорная',
      floorName: 'Старый этаж',
      removed: true,
      snapshot: true,
    });
    expect(
      getBookingResourceDetails(
        { ...row, floorId: office.floors[0].id, buildingId: 'another-office' },
        office,
      ),
    ).toMatchObject({ name: 'Прежняя переговорная', floorName: 'Старый этаж', removed: true });
  });

  it('keeps historical names after rename while current bookings use the live plan', () => {
    const office = createDemoConfig();
    const resource = office.floors[0].elements.find((item) => item.kind === 'room')!;
    resource.name = 'Новое название';
    const row = booking({
      floorId: office.floors[0].id,
      resourceId: resource.id,
      resourceSnapshot: { name: 'Название при бронировании', floor_name: 'Этаж при бронировании' },
    });
    expect(getBookingResourceDetails(row, office).name).toBe('Новое название');
    expect(getBookingResourceDetails(row, office, { preferSnapshot: true })).toMatchObject({
      name: 'Название при бронировании',
      floorName: 'Этаж при бронировании',
      snapshot: true,
    });
  });

  it('supports legacy missing snapshots with neutral names and keeps the record unchanged', () => {
    const row = booking();
    const before = JSON.stringify(row);
    expect(getBookingResourceDetails(row, createDemoConfig())).toMatchObject({
      name: 'Пространство',
      floorName: 'Прежний этаж',
      snapshot: false,
    });
    expect(getBookingReviewMessages(row)).toEqual([]);
    expect(getBookingWarningMessages(row)).toEqual([]);
    expect(getBookingCancellationMessage(row)).toBeNull();
    expect(JSON.stringify(row)).toBe(before);
  });

  it('recognizes Moscow historical intervals and server cancellation independently of the scheduled date', () => {
    expect(isBookingHistorical(booking(), Date.parse('2026-11-12T08:00:00Z'))).toBe(true);
    expect(isBookingHistorical(booking(), Date.parse('2026-11-12T07:59:59Z'))).toBe(false);
    expect(
      isBookingHistorical(
        booking({ status: 'cancelled', date: '2027-01-01' }),
        Date.parse('2026-11-12T08:00:00Z'),
      ),
    ).toBe(true);
  });
});

describe('booking condition messages', () => {
  it('explains every current review reason and safely merges unknown future reasons', () => {
    const reasons = [
      'working_hours_changed',
      'resource_hierarchy_changed',
      'resource_type_changed',
      'resource_unavailable',
      'private_future_code',
      'private_future_code',
    ];
    const messages = getBookingReviewMessages(
      booking({ needsReview: true, reviewReasons: reasons }),
    );
    expect(messages).toHaveLength(5);
    expect(messages.join(' ')).toContain('рабочие часы');
    expect(messages.join(' ')).toContain('состав помещения');
    expect(messages.join(' ')).toContain('тип пространства');
    expect(messages.join(' ')).toContain('больше недоступно');
    for (const reason of reasons) expect(messages.join(' ')).not.toContain(reason);
    expect(getBookingReviewMessages(booking({ needsReview: true }))).toHaveLength(1);
    expect(
      getBookingReviewMessages(booking({ needsReview: false, reviewReasons: reasons })),
    ).toEqual([]);
  });

  it('explains owner, administrator and access cancellation without displaying internal codes', () => {
    expect(
      getBookingCancellationMessage(
        booking({ status: 'cancelled', cancellationReason: 'user_cancelled' }),
      ),
    ).toContain('владельцем');
    expect(
      getBookingCancellationMessage(
        booking({ status: 'cancelled', cancellationReason: 'admin_cancelled' }),
      ),
    ).toContain('администратором');
    for (const reason of ['access_revoked', 'building_access_revoked', 'building_access_removed'])
      expect(
        getBookingCancellationMessage(booking({ status: 'cancelled', cancellationReason: reason })),
      ).toContain('доступ к офису отозван');
    expect(
      getBookingCancellationMessage(
        booking({ status: 'cancelled', cancellationReason: 'user_disabled' }),
      ),
    ).toContain('учётная запись');
    const unknown = getBookingCancellationMessage(
      booking({ status: 'cancelled', cancellationReason: 'private_future_code' }),
    );
    expect(unknown).toContain('сохранена в истории');
    expect(unknown).not.toContain('private_future_code');
    expect(getBookingCancellationMessage(booking({ status: 'cancelled' }))).toContain('отменена');
  });

  it('calls a truncated running booking ended early only with valid ordered server timestamps', () => {
    const row = booking({
      status: 'cancelled',
      cancellationReason: 'admin_cancelled',
      startsAt: '2026-11-12T07:00:00Z',
      endsAt: '2026-11-12T07:20:03Z',
      scheduledEndsAt: '2026-11-12T08:00:00Z',
    });
    expect(getBookingCancellationMessage(row)).toBe('Бронь досрочно завершена администратором.');
    expect(getBookingCancellationMessage({ ...row, endsAt: row.startsAt })).toBe(
      'Бронь отменена администратором.',
    );
    expect(getBookingCancellationMessage({ ...row, endsAt: 'invalid' })).toBe(
      'Бронь отменена администратором.',
    );
  });

  it('shows a nonblocking capacity warning including zero seats and safely handles future warnings', () => {
    const row = booking({
      participants: 8,
      warnings: [{ code: 'capacity_exceeded', capacity: 0, participants: 8 }],
    });
    expect(getBookingWarningMessages(row)).toEqual([
      'Участников: 8. Сидячих мест: 0. Бронь сохранена; участников больше, чем мест.',
    ]);
    expect(
      getBookingWarningMessages(booking({ warnings: [{ code: 'capacity_exceeded' }] }))[0],
    ).toContain('Бронь сохранена');
    const unknown = getBookingWarningMessages(
      booking({ warnings: [{ code: 'private_future_warning' }] }),
    )[0];
    expect(unknown).not.toContain('private_future_warning');
    expect(unknown).toContain('Уточните условия');
    expect(row.status).toBe('active');
  });
});
