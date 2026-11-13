import { describe, expect, it, vi } from 'vitest';
import { decodeServerSync } from './serverSync';

describe('server invalidation decoder', () => {
  it('preserves a null current session and its archived session after booking', () => {
    expect(
      decodeServerSync(
        'chat.changed',
        JSON.stringify({
          sessionId: null,
          archivedSessionId: 'chat-archived',
          revision: 4,
        }),
      ),
    ).toEqual({ type: 'chat.changed', sessionId: null, archivedSessionId: 'chat-archived' });
  });

  it('distinguishes an absent current session field from an explicit null', () => {
    const absent = decodeServerSync('chat.changed', '{"archivedSessionId":"chat-old"}');
    expect(absent).toEqual({ type: 'chat.changed', archivedSessionId: 'chat-old' });
    expect(absent).not.toHaveProperty('sessionId');
    expect(decodeServerSync('chat.changed', '{"sessionId":null}')).toHaveProperty(
      'sessionId',
      null,
    );
    expect(decodeServerSync('chat.changed', '{"sessionId":"chat-current"}')).toEqual({
      type: 'chat.changed',
      sessionId: 'chat-current',
    });
  });

  it.each(['ready', 'resync'] as const)(
    'preserves %s snapshot invalidation without copying arbitrary fields',
    (type) => {
      expect(
        decodeServerSync(
          type,
          '{"snapshotRequired":true,"accessToken":"private","sessionId":"unexpected"}',
        ),
      ).toEqual({ type });
    },
  );

  it.each(['booking.changed', 'office.changed'] as const)(
    'keeps the office scope on %s',
    (type) => {
      expect(
        decodeServerSync(type, '{"officeId":"office-1","revision":8,"refreshToken":"private"}'),
      ).toEqual({ type, officeId: 'office-1' });
    },
  );

  it('does not forward tokens, nested payloads or an injected event type', () => {
    const event = decodeServerSync(
      'chat.changed',
      JSON.stringify({
        type: 'auth.expired',
        sessionId: null,
        archivedSessionId: 'chat-old',
        accessToken: 'private-access',
        refreshToken: 'private-refresh',
        user: { password: 'private-password' },
        officeId: 'unrelated-office',
        action: 'newChat',
      }),
    );
    expect(event).toEqual({ type: 'chat.changed', sessionId: null, archivedSessionId: 'chat-old' });
    expect(JSON.stringify(event)).not.toContain('private');
  });

  it.each(['null', '[]', '"text"', 'true', '42', '{broken', ''])(
    'ignores malformed or non-object JSON without throwing: %s',
    (payload) => {
      expect(decodeServerSync('chat.changed', payload)).toBeNull();
    },
  );

  it.each([
    { sessionId: 3 },
    { sessionId: {} },
    { sessionId: [] },
    { sessionId: '' },
    { sessionId: 'chat\nsecret' },
    { archivedSessionId: null },
    { archivedSessionId: 8 },
    { archivedSessionId: { token: 'private' } },
  ])('ignores invalid chat field types: %j', (payload) => {
    expect(decodeServerSync('chat.changed', JSON.stringify(payload))).toBeNull();
  });

  it('ignores non-string payloads and invalid office scopes', () => {
    expect(decodeServerSync('chat.changed', null)).toBeNull();
    expect(decodeServerSync('chat.changed', { sessionId: null })).toBeNull();
    expect(decodeServerSync('office.changed', '{"officeId":null}')).toBeNull();
  });

  it('does not start a chat or send any command when current session becomes null', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    try {
      decodeServerSync('chat.changed', '{"sessionId":null,"archivedSessionId":"chat-old"}');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
