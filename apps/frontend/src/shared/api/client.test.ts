import { describe, expect, it, vi } from 'vitest';
import type { AuthSnapshot } from '../../auth/types';
import type { AppUser, UserInput, UserUpdate } from '../../auth/types';
import { createDemoConfig } from '../../office/lib/officeModel';
import { ApiError, createGatewayClient } from './client';
import type { ClientBooking } from '../../booking/types';

const user: AppUser = {
  id: 'user-example',
  login: 'anna',
  firstName: 'Анна',
  lastName: 'Иванова',
  role: 'admin',
  active: true,
  buildingIds: ['office-demo'],
  createdAt: '2026-11-12T10:00:00Z',
};
const snapshot: AuthSnapshot = { user, users: [user], expiresAt: 1797076800000 };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const expired = () => json({ code: 'access_expired', message: 'Нужно обновить сессию.' }, 401);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('typed Gateway transport', () => {
  it('sends frontend user fields without snake_case and includes cookies', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(snapshot))
      .mockResolvedValueOnce(json(user, 201))
      .mockResolvedValueOnce(json(user));
    const client = createGatewayClient({ fetch: fetcher });
    const input: UserInput = {
      login: 'anna',
      firstName: 'Анна',
      lastName: 'Иванова',
      role: 'admin',
      buildingIds: ['office-demo'],
      password: 'test-password',
    };
    const update: UserUpdate = { ...input, active: true };
    delete (update as Partial<UserInput>).password;
    expect(await client.signIn('anna', 'test-password')).toEqual(snapshot);
    await client.createUser(input);
    await client.updateUser('user #1?', update);
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/login');
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual(input);
    expect(fetcher.mock.calls[2][0]).toBe('/api/users/user%20%231%3F');
    expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual(update);
    for (const [, init] of fetcher.mock.calls) expect(init!.credentials).toBe('include');
  });

  it('keeps office metadata and plan commands separate and preserves plan identifiers', async () => {
    const office = createDemoConfig();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(office));
    const client = createGatewayClient({ fetch: fetcher });
    const settings = { name: office.name, address: 'Москва', hours: office.hours };
    await client.updateOfficeSettings('office #1?', settings);
    await client.saveOfficePlan('office #1?', office.floors);
    expect(fetcher.mock.calls[0][0]).toBe('/api/offices/office%20%231%3F/settings');
    expect(fetcher.mock.calls[0][1]!.method).toBe('PATCH');
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual(settings);
    expect(fetcher.mock.calls[1][1]!.method).toBe('PUT');
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ floors: office.floors });
  });

  it('handles empty204 responses and the existing current-password parameter', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 204 }));
    const client = createGatewayClient({ fetch: fetcher });
    await expect(client.changePassword('old-password', 'new-password')).resolves.toBeUndefined();
    await expect(client.resetPassword(user.id, 'reset-password')).resolves.toBeUndefined();
    await expect(client.signOut()).resolves.toBeUndefined();
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
      current: 'old-password',
      password: 'new-password',
    });
    expect(fetcher.mock.calls[2][0]).toBe('/api/auth/logout');
    expect(fetcher.mock.calls[2][1]!.body).toBeUndefined();
  });

  it('exposes only the public error fields and message', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json(
        {
          code: 'validation_error',
          message: 'Проверьте имя.',
          requestId: 'request-1',
          fields: [{ field: 'firstName', message: 'Введите имя.', input: 'private-value' }],
          internal: { password: 'private-value' },
        },
        422,
      ),
    );
    const client = createGatewayClient({ fetch: fetcher });
    try {
      await client.listUsers();
      throw new Error('Expected API error');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 422,
        code: 'validation_error',
        message: 'Проверьте имя.',
        requestId: 'request-1',
        fields: [{ field: 'firstName', message: 'Введите имя.' }],
      });
      expect(JSON.stringify(error)).not.toContain('private-value');
    }
  });

  it('does not forward HTML or fetch exception details to the UI', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('password=secret'))
      .mockResolvedValueOnce(new Response('<h1>private proxy failure</h1>', { status: 502 }))
      .mockResolvedValueOnce(new Response('<html>wrong server</html>'));
    const client = createGatewayClient({ fetch: fetcher });
    await expect(client.listUsers()).rejects.toMatchObject({ code: 'network_error', status: 0 });
    await expect(client.listUsers()).rejects.toMatchObject({ code: 'request_failed', status: 502 });
    await expect(client.listUsers()).rejects.toMatchObject({
      code: 'invalid_response',
      status: 200,
    });
  });
});

describe('short access-token refresh', () => {
  it('shares one refresh while concurrent protected requests receive401', async () => {
    const refresh = deferred<Response>();
    let renewed = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (input === '/api/auth/refresh') {
        await refresh.promise;
        renewed = true;
        return json(snapshot);
      }
      if (!renewed) return expired();
      return json(input === '/api/users' ? [user] : []);
    });
    const client = createGatewayClient({ fetch: fetcher });
    const users = client.listUsers();
    const offices = client.listOffices();
    await vi.waitFor(() =>
      expect(fetcher.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1),
    );
    refresh.resolve(json(snapshot));
    await expect(users).resolves.toEqual([user]);
    await expect(offices).resolves.toEqual([]);
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('does not refresh again when a concurrent401 arrives after refresh already completed', async () => {
    const late = deferred<Response>();
    let renewed = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (input === '/api/auth/refresh') {
        renewed = true;
        return json(snapshot);
      }
      if (input === '/api/offices' && !renewed) return late.promise;
      if (!renewed) return expired();
      return json(input === '/api/users' ? [user] : []);
    });
    const client = createGatewayClient({ fetch: fetcher });
    const users = client.listUsers();
    const offices = client.listOffices();
    await users;
    late.resolve(expired());
    await expect(offices).resolves.toEqual([]);
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('retries only once when the replacement access token is rejected', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        input === '/api/auth/refresh' ? json(snapshot) : expired(),
      );
    const client = createGatewayClient({ fetch: fetcher });
    await expect(client.getMe()).rejects.toMatchObject({ status: 401, code: 'access_expired' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('returns an empty auth snapshot when both access and refresh are unavailable', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        input === '/api/auth/refresh'
          ? json({ code: 'session_invalid', message: 'Войдите снова.' }, 401)
          : json({ code: 'authentication_required', message: 'Войдите.' }, 401),
      );
    const client = createGatewayClient({ fetch: fetcher });
    await expect(client.getAuthSnapshot()).resolves.toEqual({
      user: null,
      users: [],
      expiresAt: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not turn a refresh outage into an anonymous session', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        input === '/api/auth/refresh'
          ? json({ code: 'upstream_unavailable', message: 'Попробуйте позже.' }, 503)
          : expired(),
      );
    const client = createGatewayClient({ fetch: fetcher });
    await expect(client.getSession()).rejects.toMatchObject({
      status: 503,
      message: 'Попробуйте позже.',
    });
  });

  it('does not refresh invalid login credentials', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json({ code: 'invalid_credentials', message: 'Неверный логин или пароль.' }, 401),
      );
    const client = createGatewayClient({ fetch: fetcher });
    await expect(client.signIn('anna', 'incorrect')).rejects.toMatchObject({
      status: 401,
      code: 'invalid_credentials',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('server commands and concurrency', () => {
  const booking: ClientBooking = {
    id: 'booking/1',
    buildingId: 'office-demo',
    floorId: 'f1',
    resourceId: 'desk1',
    date: '2026-11-13',
    start: 780,
    end: 840,
    ownerId: user.id,
    ownerName: 'Анна Иванова',
    status: 'active',
    revision: 7,
  };
  const input = {
    floorId: booking.floorId,
    resourceId: booking.resourceId,
    date: booking.date,
    start: booking.start,
    end: booking.end,
  };

  it('retains one idempotency key and body across an access-refresh retry', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(json(snapshot))
      .mockResolvedValueOnce(json(booking));
    const client = createGatewayClient({ fetch: fetcher });
    await expect(client.createBooking('office-demo', input, 'one-attempt')).resolves.toEqual(
      booking,
    );
    const commands = fetcher.mock.calls.filter(
      ([url]) => url === '/api/offices/office-demo/bookings',
    );
    expect(commands).toHaveLength(2);
    for (const [, init] of commands) {
      expect(init?.headers).toMatchObject({ 'Idempotency-Key': 'one-attempt' });
      expect(JSON.parse(init?.body as string)).toEqual(input);
    }
  });

  it('sends expected revisions without owner names or replacing another owner', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(booking));
    const client = createGatewayClient({ fetch: fetcher });
    await client.updateBooking('office-demo', booking, { ...input, resourceId: 'desk2' });
    await client.cancelBooking('office-demo', booking);
    expect(fetcher.mock.calls[0][0]).toBe('/api/offices/office-demo/bookings/booking%2F1');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      ...input,
      resourceId: 'desk2',
      revision: 7,
    });
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({ revision: 7 });
  });

  it('never retries a stale write with a fabricated new revision', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json(
          { code: 'booking_revision_conflict', message: 'Бронь изменилась.', currentRevision: 8 },
          409,
        ),
      );
    const client = createGatewayClient({ fetch: fetcher });
    await expect(client.updateBooking('office-demo', booking, input)).rejects.toMatchObject({
      status: 409,
      code: 'booking_revision_conflict',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('includes office revisions and imports the exact document with a stable receipt', async () => {
    const office = { ...createDemoConfig(), revision: 4 };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(office));
    const client = createGatewayClient({ fetch: fetcher });
    await client.saveOfficePlan(office.id, office.floors, 4);
    await client.updateOfficeSettings(office.id, { name: office.name, hours: office.hours }, 4);
    await client.importOffice(office, 'migration-attempt');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      floors: office.floors,
      revision: 4,
    });
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toMatchObject({ revision: 4 });
    expect(fetcher.mock.calls[2][0]).toBe('/api/offices/import');
    expect(fetcher.mock.calls[2][1]?.headers).toMatchObject({
      'Idempotency-Key': 'migration-attempt',
    });
    expect(JSON.parse(fetcher.mock.calls[2][1]?.body as string)).toEqual({ document: office });
  });

  it('invalidates rejected protected sessions but leaves a failed login alone', async () => {
    const invalidated = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ code: 'access_invalid', message: 'Сессия недействительна.' }, 401));
    const client = createGatewayClient({ fetch: fetcher, onSessionInvalidated: invalidated });
    await expect(client.signIn('admin', 'wrong')).rejects.toMatchObject({ status: 401 });
    expect(invalidated).not.toHaveBeenCalled();
    await expect(client.getMe()).rejects.toMatchObject({ status: 401 });
    expect(invalidated).toHaveBeenCalledTimes(1);
  });
});

describe('identity boundaries', () => {
  it('does not replay an old mutation or invalidate a new login on a late401', async () => {
    const late = deferred<Response>();
    const invalidated = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        url === '/api/auth/login' ? json(snapshot) : late.promise,
      );
    const client = createGatewayClient({ fetch: fetcher, onSessionInvalidated: invalidated });
    const oldMutation = client.updateUser('old-person', {
      login: 'anna',
      firstName: 'Анна',
      lastName: 'Иванова',
      role: 'employee',
      active: true,
      buildingIds: [],
    });
    await client.signIn('admin', 'password');
    late.resolve(expired());
    await expect(oldMutation).rejects.toMatchObject({ code: 'session_changed' });
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/users/old-person')).toHaveLength(1);
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('waits for the old refresh response before issuing a new login cookie', async () => {
    const late = deferred<Response>();
    const invalidated = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        url === '/api/auth/refresh' ? late.promise : json(snapshot),
      );
    const client = createGatewayClient({ fetch: fetcher, onSessionInvalidated: invalidated });
    const oldRefresh = client.refreshSession();
    const rejected = expect(oldRefresh).rejects.toMatchObject({ status: 401 });
    const login = client.signIn('admin', 'password');
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/auth/login')).toHaveLength(0);
    late.resolve(json({ code: 'session_invalid', message: 'Сессия завершена.' }, 401));
    await rejected;
    await expect(login).resolves.toEqual(snapshot);
    expect(invalidated).not.toHaveBeenCalled();
  });
});

describe('assistant HTTP adapter', () => {
  it('keeps dialogue ownership in the URL and sends a stable message receipt', async () => {
    const result = {
      request: {
        id: 'request-1',
        session_id: 'chat/1',
        status: 'pending',
        result: null,
        error_code: null,
      },
      session: { id: 'chat/1' },
      messages: [],
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(result, 202));
    const client = createGatewayClient({ fetch: fetcher });
    const context = { officeId: 'office-demo', floorId: 'f1', date: '2026-11-13' };
    await expect(
      client.sendChatMessage('chat/1', 'Нужно место у окна', context, 'message-attempt'),
    ).resolves.toEqual(result);
    expect(fetcher.mock.calls[0][0]).toBe('/api/chats/chat%2F1/messages');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      message: 'Нужно место у окна',
      context,
    });
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      'Idempotency-Key': 'message-attempt',
    });
    await client.getGeneration('request/1');
    expect(fetcher.mock.calls[1][0]).toBe('/api/generations/request%2F1');
    expect(fetcher.mock.calls[1][1]?.method).toBe('GET');
  });

  it('does not retry an unavailable generation as a new paid request', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        json({ code: 'assistant_unconfigured', message: 'Помощник пока недоступен.' }, 503),
      );
    const client = createGatewayClient({ fetch: fetcher });
    await expect(
      client.sendChatMessage(
        'chat1',
        'Место на час',
        { officeId: 'o1', floorId: 'f1', date: '2026-11-13' },
        'one-attempt',
      ),
    ).rejects.toMatchObject({ code: 'assistant_unconfigured', status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it('fences old mutations when another tab changes the shared login', async () => {
  const late = deferred<Response>();
  const invalidated = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => late.promise);
  const client = createGatewayClient({ fetch: fetcher, onSessionInvalidated: invalidated });
  const pending = client.cancelBooking('office-demo', {
    id: 'b1',
    buildingId: 'office-demo',
    floorId: 'f1',
    resourceId: 'r1',
    date: '2026-11-13',
    start: 780,
    end: 840,
    ownerId: 'old-user',
    ownerName: 'Old',
    status: 'active',
    revision: 1,
  });
  client.invalidateIdentity();
  late.resolve(expired());
  await expect(pending).rejects.toMatchObject({ code: 'session_changed' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(invalidated).not.toHaveBeenCalled();
});

describe('access revocation receipts', () => {
  const operationId = '73a38e7d-d083-45fa-a052-3e652d72f040';

  it('keeps PATCH user response compatible while publishing its operation receipt', async () => {
    const observed = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify(user), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Access-Operation-ID': operationId },
        }),
    );
    const client = createGatewayClient({ fetch: fetcher, onAccessOperation: observed });
    const result = await client.updateUser(user.id, {
      login: user.login,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      active: false,
      buildingIds: [],
    });
    expect(result).toEqual(user);
    expect(observed).toHaveBeenCalledExactlyOnceWith(operationId);
  });

  it('reads operation status without marking a pending publication completed', async () => {
    const operation = {
      id: operationId,
      user_id: user.id,
      status: 'pending',
      cancelled_count: 0,
      terminated_count: 0,
      completed_at: null,
      publication: { published_at: '2026-11-12T19:00:00Z', attempts: 1, last_error: null },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        json(String(url).startsWith('/api/access-operations?') ? [operation] : operation),
      );
    const client = createGatewayClient({ fetch: fetcher });
    await expect(client.listAccessOperations('user #1')).resolves.toEqual([operation]);
    await expect(client.getAccessOperation(operationId)).resolves.toEqual(operation);
    expect(fetcher.mock.calls[0][0]).toBe('/api/access-operations?user_id=user+%231');
    expect(fetcher.mock.calls[1][0]).toBe('/api/access-operations/' + operationId);
  });

  it('does not publish an old identity receipt after a cross-tab login change', async () => {
    const late = deferred<Response>();
    const observed = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => late.promise);
    const client = createGatewayClient({ fetch: fetcher, onAccessOperation: observed });
    const pending = client.getAccessOperation(operationId);
    client.invalidateIdentity();
    late.resolve(new Response('{}', { headers: { 'X-Access-Operation-ID': operationId } }));
    await pending;
    expect(observed).not.toHaveBeenCalled();
  });
});
