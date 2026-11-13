import { describe, expect, it } from 'vitest';
import type { BookingProposal, GenerationRequest } from '../../shared/api/client';
import { assistantDisplayText, ProposalAutoOpenGuard } from './assistantPresentation';

const origin = 'http://localhost:5178';
const relative =
  '/booking?officeId=office-a&floorId=floor-a&resourceId=room-a&date=2026-11-13&start=600&end=660';
const absolute = origin + relative;
const proposal: BookingProposal = {
  officeId: 'office-a',
  floorId: 'floor-a',
  resourceId: 'room-a',
  date: '2026-11-13',
  start: 600,
  end: 660,
  url: absolute,
};
const display = (
  content: string,
  patch: Partial<Parameters<typeof assistantDisplayText>[1]> = {},
) => assistantDisplayText(content, { role: 'assistant', proposal, origin, ...patch });

describe('assistant proposal presentation', () => {
  it.each([relative, absolute, absolute + '#confirm', relative + '#form&tab=1'])(
    'removes a standalone booking URL: %s',
    (url) => {
      expect(display(`Подготовлена форма подтверждения:\n${url}`)).toBe('Форма готова.');
    },
  );

  it.each([
    `[Открыть форму](${relative})`,
    `[Открыть форму](${absolute}#confirm)`,
    `[Открыть форму](<${absolute}>)`,
    `[Открыть форму](${absolute} "Подтвердить")`,
    `<${absolute}>`,
  ])('removes booking markup without leaving a second CTA: %s', (content) => {
    expect(display(content)).toBe('');
  });

  it('keeps sentence punctuation and removes empty wrappers after an inline URL', () => {
    expect(display(`Проверьте время (${absolute}), затем подтвердите бронь.`)).toBe(
      'Проверьте время, затем подтвердите бронь.',
    );
    expect(display(`Всё готово: ${relative}.`)).toBe('Всё готово.');
    expect(display(`Нашёл комнату.\n\n${absolute}.\n\nПроверьте число участников.`)).toBe(
      'Нашёл комнату.\n\nПроверьте число участников.',
    );
    expect(display(`Подготовлена форма подтверждения:\n${absolute}\n\nПроверьте время.`)).toBe(
      'Форма готова.\n\nПроверьте время.',
    );
  });

  it('recognizes the exact canonical proposal URL across the dev hostname aliases', () => {
    expect(
      display(`Подготовлена форма подтверждения: ${absolute}`, { origin: 'http://127.0.0.1:5178' }),
    ).toBe('Форма готова.');
    const unrelated = absolute.replace('room-a', 'room-other');
    expect(display(unrelated, { origin: 'http://127.0.0.1:5178' })).toBe(unrelated);
  });

  it('preserves unrelated destinations, including a booking path on another origin', () => {
    const external = 'https://outside.example/booking?resourceId=room-a';
    const content = `Документация: https://example.com/docs?next=${relative}\n[Другой сайт](${external})\n${origin}/booking/history?officeId=office-a`;
    expect(display(content)).toBe(content);
    expect(display(`[Форма](${absolute})[Документы](https://example.com/docs)`)).toBe(
      '[Документы](https://example.com/docs)',
    );
  });

  it('leaves user messages and messages without a structured proposal unchanged', () => {
    const content = `  Подготовлена форма подтверждения:\n${absolute}  `;
    expect(display(content, { role: 'user' })).toBe(content);
    expect(display(content, { proposal: null })).toBe(content);
    expect(display(content, { proposal: undefined })).toBe(content);
    expect(display('Подготовлена форма подтверждения: комната и время уточняются.')).toBe(
      'Подготовлена форма подтверждения: комната и время уточняются.',
    );
  });

  it('does not trust a non-HTTP proposal URL or interpret HTML as executable content', () => {
    const content = '<script>alert("hello")</script> javascript:/booking?officeId=office-a';
    expect(
      display(content, { proposal: { ...proposal, url: 'javascript:/booking?officeId=office-a' } }),
    ).toBe(content);
  });

  it('does not mutate the persisted text or structured proposal', () => {
    const message = Object.freeze({ content: `Подготовлена форма подтверждения:\n${absolute}` });
    const before = structuredClone(proposal);
    display(message.content, { proposal: Object.freeze(proposal) });
    expect(message.content).toContain(absolute);
    expect(proposal).toEqual(before);
  });
});

type Request = Pick<GenerationRequest, 'id' | 'session_id' | 'status' | 'result'>;
const request = (status: Request['status'], patch: Partial<Request> = {}): Request => ({
  id: 'request-a',
  session_id: 'chat-a',
  status,
  result: status === 'completed' ? { message: 'Форма готова.', proposal } : null,
  ...patch,
});

describe('proposal automatic opening guard', () => {
  it('opens a new completion exactly once, across repeated SSE and focus snapshots', () => {
    const guard = new ProposalAutoOpenGuard();
    guard.sent(request('pending'));
    expect(guard.completed(request('completed'), 'chat-a', true)).toBe(proposal);
    expect(guard.completed(request('completed'), 'chat-a', true)).toBeNull();
    guard.pending(request('running'), 'chat-a', true);
    expect(guard.completed(request('completed'), 'chat-a', true)).toBeNull();
  });

  it('observes a pending current request loaded after reconnect, then opens its completion', () => {
    const guard = new ProposalAutoOpenGuard();
    guard.pending(request('running'), 'chat-a', true);
    expect(guard.completed(request('completed'), 'chat-a', true)).toBe(proposal);
  });

  it('does not open an initial completed answer or re-open one after remounting the chat', () => {
    const guard = new ProposalAutoOpenGuard();
    guard.pending(request('completed'), 'chat-a', true);
    expect(guard.completed(request('completed'), 'chat-a', true)).toBeNull();
    const reopened = new ProposalAutoOpenGuard();
    expect(reopened.completed(request('completed'), 'chat-a', true)).toBeNull();
  });

  it('does not mark archived requests as awaiting, or open an archived completion', () => {
    const guard = new ProposalAutoOpenGuard();
    guard.pending(request('pending'), 'chat-a', false);
    expect(guard.completed(request('completed'), 'chat-a', true)).toBeNull();
    guard.sent(request('pending'));
    expect(guard.completed(request('completed'), 'chat-a', false)).toBeNull();
  });

  it('does not open a late answer while another dialogue is selected', () => {
    const guard = new ProposalAutoOpenGuard();
    guard.sent(request('pending'));
    expect(guard.completed(request('completed'), 'chat-b', true)).toBeNull();
    guard.pending(request('running'), 'chat-b', true);
    expect(
      guard.completed(request('completed', { session_id: 'chat-b' }), 'chat-b', true),
    ).toBeNull();
  });

  it('does not open failed, incomplete or proposal-free replies', () => {
    const guard = new ProposalAutoOpenGuard();
    expect(() => guard.pending(null, undefined, true)).not.toThrow();
    guard.sent(request('pending'));
    expect(guard.completed(request('failed'), 'chat-a', true)).toBeNull();
    expect(guard.completed(request('running'), 'chat-a', true)).toBeNull();
    expect(
      guard.completed(
        request('completed', { result: { message: 'Уточните время.', proposal: null } }),
        'chat-a',
        true,
      ),
    ).toBeNull();
    expect(guard.completed(null, 'chat-a', true)).toBeNull();
  });
});
