import { describe, expect, it } from 'vitest';
import { createDemoConfig } from '../../office/lib/officeModel';
import {
  BookingLinkError,
  buildBookingLink,
  parseBookingLink,
  proposalToBookingPrefill,
  validateBookingLink,
} from './bookingLink';

const now = new Date('2026-11-12T20:59:59Z');
const target = { officeId: 'office-demo', floorId: 'floor-first', resourceId: 'f1-meeting-1' };
const query = (patch: Record<string, string> = {}) =>
  '?' + new URLSearchParams({ ...target, ...patch });

describe('booking form links', () => {
  it('round-trips form fields while ignoring a dangerous proposal URL', () => {
    const proposal = {
      ...target,
      date: '2026-11-13',
      start: 600,
      end: 660,
      participants: 4,
      url: 'javascript:alert(1)',
    };
    const url = buildBookingLink(proposal);
    expect(url).toMatch(/^\/booking\?/);
    expect(url).not.toContain('javascript');
    expect(parseBookingLink(url, now)).toEqual({
      ...target,
      date: proposal.date,
      start: 600,
      end: 660,
      participants: 4,
    });
    expect(proposal.url).toBe('javascript:alert(1)');
  });

  it.each([
    'javascript:alert(1)',
    '//evil.example/booking?officeId=x',
    'https://evil.example/booking?officeId=x',
    '/\\evil.example/booking?officeId=x',
    '/admin/users?officeId=x',
  ])('rejects unsafe destinations: %s', (input) => {
    expect(() => parseBookingLink(input, now)).toThrow(BookingLinkError);
  });

  it('keeps missing date and time empty, and ordinary booking URLs unprefilled', () => {
    expect(parseBookingLink('', now)).toBeNull();
    expect(parseBookingLink('/booking', now)).toBeNull();
    expect(parseBookingLink(query(), now)).toEqual({ ...target, date: '' });
    expect(buildBookingLink({ ...target, date: null, start: null, end: null })).toBe(
      '/booking' + query(),
    );
  });

  it('clears only a past date at the Moscow midnight boundary', () => {
    const input = query({ date: '2026-11-12', start: '600', end: '660', participants: '3' });
    expect(parseBookingLink(input, now)?.date).toBe('2026-11-12');
    expect(parseBookingLink(input, new Date('2026-11-12T21:00:00Z'))).toEqual({
      ...target,
      date: '',
      start: 600,
      end: 660,
      participants: 3,
    });
  });

  it.each([
    query() + '&officeId=other',
    query({ date: '2026-02-30' }),
    query({ date: '' }),
    query({ start: '600.5' }),
    query({ start: '-1' }),
    query({ start: '0x10' }),
    query({ start: '700', end: '600' }),
    query({ end: '1441' }),
    query({ participants: '0' }),
    query({ participants: '9007199254740992' }),
    query() + '&ownerId=someone',
    query() + '&date=%GG',
  ])('rejects malformed, duplicate or identity parameters: %s', (input) => {
    expect(() => parseBookingLink(input, now)).toThrow(BookingLinkError);
  });

  it('encodes IDs and does not mutate source query parameters', () => {
    const proposal = { officeId: 'office /?#&', floorId: 'этаж + 1', resourceId: 'room=1&x' };
    const url = buildBookingLink(proposal);
    expect(parseBookingLink(url, now)).toEqual({ ...proposal, date: '' });
    const params = new URLSearchParams(query().slice(1));
    const before = params.toString();
    parseBookingLink(params, now);
    expect(params.toString()).toBe(before);
  });

  it('checks the live floor and resource without changing the office', () => {
    const office = createDemoConfig();
    const floor = office.floors[0];
    const room = floor.elements.find((item) => item.kind === 'room' && item.bookable)!;
    const prefill = {
      officeId: office.id,
      floorId: floor.id,
      resourceId: room.id,
      date: '',
      participants: 3,
    };
    const before = structuredClone(office);
    expect(validateBookingLink(prefill, office)).toEqual(prefill);
    expect(office).toEqual(before);
    room.bookable = false;
    expect(() => validateBookingLink(prefill, office)).toThrow(/недоступно/);
    expect(() => validateBookingLink({ ...prefill, floorId: 'missing' }, office)).toThrow(/Этаж/);
    expect(() => validateBookingLink({ ...prefill, officeId: 'unavailable' }, office)).toThrow(
      /Офис/,
    );
    expect(() => validateBookingLink({ ...prefill, resourceId: 'missing' }, office)).toThrow(
      /недоступно/,
    );
  });

  it('does not allow furniture, hidden seats or participants on a workplace', () => {
    const office = createDemoConfig(),
      floor = office.floors[0];
    const desk = floor.elements.find((item) => item.kind === 'desk' && !item.roomId)!;
    const prefill = { officeId: office.id, floorId: floor.id, resourceId: desk.id, date: '' };
    expect(() => validateBookingLink({ ...prefill, participants: 2 }, office)).toThrow(
      /переговорной/,
    );
    const furniture = floor.elements.find((item) => item.kind === 'furniture' && !item.bookable)!;
    expect(() => validateBookingLink({ ...prefill, resourceId: furniture.id }, office)).toThrow(
      /недоступно/,
    );
    const room = floor.elements.find((item) => item.kind === 'room')!;
    room.bookable = true;
    room.shared = false;
    desk.roomId = room.id;
    expect(() => validateBookingLink(prefill, office)).toThrow(/недоступно/);
  });
});

describe('native assistant proposal data', () => {
  it('fills the form from structured fields while ignoring a model URL', () => {
    const proposal = {
      ...target,
      date: '2026-11-13',
      start: 600,
      end: 660,
      url: 'https://unrelated.example/booking?ownerId=someone',
    };
    const before = structuredClone(proposal);
    expect(proposalToBookingPrefill(proposal, now)).toEqual({
      ...target,
      date: '2026-11-13',
      start: 600,
      end: 660,
    });
    expect(proposal).toEqual(before);
  });

  it('keeps incomplete fields empty and clears a past date without losing the interval', () => {
    expect(proposalToBookingPrefill(target, now)).toEqual({ ...target, date: '' });
    expect(
      proposalToBookingPrefill({ ...target, date: '2026-11-11', start: 600, end: 660 }, now),
    ).toEqual({ ...target, date: '', start: 600, end: 660 });
  });

  it('rejects invalid form values before applying a native proposal', () => {
    expect(() => proposalToBookingPrefill({ ...target, date: '2026-02-30' }, now)).toThrow(
      BookingLinkError,
    );
    expect(() => proposalToBookingPrefill({ ...target, start: 660, end: 600 }, now)).toThrow(
      BookingLinkError,
    );
    expect(() => proposalToBookingPrefill({ ...target, participants: 0 }, now)).toThrow(
      BookingLinkError,
    );
  });
});
