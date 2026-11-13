import type { AuthSnapshot } from '../../auth/types';
import type { AppUser, UserInput, UserUpdate } from '../../auth/types';
import type { Floor, OfficeConfig } from '../../office';
import type { ClientBooking } from '../../booking/types';

export interface BookingPolicy {
  timezone: string;
  stepMinutes: number;
  horizonDays: number;
  serverNow: string;
  earliestStart: string;
  allowedDates: string[];
}

export interface BootstrapSnapshot {
  auth: AuthSnapshot;
  offices: OfficeConfig[];
  policy: BookingPolicy;
}

export type OfficeCreateInput = Pick<OfficeConfig, 'name' | 'address'>;
export type OfficeSettingsInput = Pick<OfficeConfig, 'name' | 'address' | 'hours'>;
export type BookingInput = Pick<
  ClientBooking,
  'floorId' | 'resourceId' | 'date' | 'start' | 'end' | 'participants'
> & { ownerId?: string };
export interface AssistantCapabilities {
  runtime: string;
  llmConfigured: boolean;
  model: string | null;
  generationAvailable: boolean;
}
export interface ChatSession {
  id: string;
  user_id: string;
  created_at: string;
  archived_at: string | null;
  archive_reason: string | null;
  version: number;
  in_flight_request_id: string | null;
}
export interface ChatMessage {
  id: string;
  position: number;
  role: string;
  content: string;
  created_at: string;
  proposal?: BookingProposal | null;
}
export interface Dialogue {
  session: ChatSession | null;
  messages: ChatMessage[];
  request?: GenerationRequest | null;
  processing?: GenerationRequest | null;
}
export interface BookingProposal {
  officeId: string;
  floorId: string;
  resourceId: string;
  date?: string | null;
  start?: number | null;
  end?: number | null;
  participants?: number | null;
  url?: string | null;
}
export interface GenerationRequest {
  id: string;
  session_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result: { message: string; proposal: BookingProposal | null } | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}
export interface GenerationSnapshot extends Dialogue {
  request: GenerationRequest;
}
export interface ChatContext {
  officeId: string;
  floorId: string;
  date: string;
}
export interface AccessOperation {
  id: string;
  user_id: string;
  reason: string;
  scope: { all_buildings?: boolean; building_ids?: string[] };
  correlation_id: string | null;
  status: 'pending' | 'completed';
  created_at: string;
  completed_at: string | null;
  cancelled_count: number;
  terminated_count: number;
  publication: { published_at: string | null; attempts: number; last_error: string | null } | null;
}
export interface ApiFieldError {
  field: string;
  message: string;
}
export interface GatewayClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  onSessionInvalidated?: () => void;
  onAccessOperation?: (id: string) => void;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: ApiFieldError[],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicError(response: Response, value: unknown): ApiError {
  const body = object(value) ? value : {};
  const fields = Array.isArray(body.fields)
    ? body.fields.flatMap((item) =>
        object(item) && typeof item.field === 'string' && typeof item.message === 'string'
          ? [{ field: item.field, message: item.message }]
          : [],
      )
    : undefined;
  return new ApiError(
    response.status,
    typeof body.code === 'string' ? body.code : 'request_failed',
    typeof body.message === 'string' ? body.message : 'Не удалось выполнить запрос.',
    fields,
    typeof body.requestId === 'string'
      ? body.requestId
      : (response.headers.get('X-Request-ID') ?? undefined),
  );
}

const refreshable = new Set(['access_expired', 'authentication_required', 'auth_required']);
const emptySnapshot = (): AuthSnapshot => ({ user: null, users: [], expiresAt: null });

/** Typed Gateway adapter; it does not read or change the browser preview's storage. */
export class GatewayClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private refreshFlight: Promise<AuthSnapshot> | undefined;
  private generation = 0;
  private identityGeneration = 0;
  private authTransition = false;
  private refreshEpoch = 0;
  private refreshFailure: unknown;
  private readonly onSessionInvalidated?: () => void;
  private readonly onAccessOperation?: (id: string) => void;

  constructor(options: GatewayClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '/api').replace(/\/+$/, '');
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.onSessionInvalidated = options.onSessionInvalidated;
    this.onAccessOperation = options.onAccessOperation;
  }

  /** Broadcast/focus identity changes must also fence retries of older HTTP commands. */
  invalidateIdentity(): void {
    this.identityGeneration++;
    this.generation++;
    this.refreshFailure = undefined;
  }

  private async send<T>(
    path: string,
    method: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const identity = this.identityGeneration;
    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      response = await this.fetcher(this.baseUrl + path, {
        method,
        credentials: 'include',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(
        0,
        'network_error',
        'Не удалось связаться с сервером. Попробуйте ещё раз.',
      );
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 204 && response.ok) return undefined as T;

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      if (!response.ok) throw publicError(response, null);
      throw new ApiError(
        response.status,
        'invalid_response',
        'Сервер вернул неподдерживаемый ответ.',
      );
    }
    if (!response.ok) throw publicError(response, value);
    const operationId = response.headers.get('X-Access-Operation-ID');
    if (
      identity === this.identityGeneration &&
      operationId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)
    ) {
      try {
        this.onAccessOperation?.(operationId);
      } catch {
        /* Observing a receipt cannot turn an accepted change into a failed mutation. */
      }
    }
    return value as T;
  }

  private async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const identity = this.identityGeneration;
    const generation = this.generation;
    const epoch = this.refreshEpoch;
    try {
      return await this.send<T>(path, method, body, headers);
    } catch (error) {
      if (identity !== this.identityGeneration || this.authTransition)
        throw new ApiError(
          409,
          'session_changed',
          'Сессия изменилась. Повторите действие после входа.',
        );
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (!refreshable.has(error.code)) {
        this.onSessionInvalidated?.();
        throw error;
      }
      if (generation === this.generation) {
        if (this.refreshFlight) await this.refreshFlight;
        else if (epoch !== this.refreshEpoch && this.refreshFailure !== undefined)
          throw this.refreshFailure;
        else await this.refreshSession();
      }
      // The second attempt deliberately does not call request(), so an expired or
      // rejected replacement cannot cause a refresh loop or repeat a mutation again.
      if (identity !== this.identityGeneration)
        throw new ApiError(
          409,
          'session_changed',
          'Сессия изменилась. Повторите действие после входа.',
        );
      try {
        return await this.send<T>(path, method, body, headers);
      } catch (retryError) {
        if (
          identity === this.identityGeneration &&
          retryError instanceof ApiError &&
          retryError.status === 401
        )
          this.onSessionInvalidated?.();
        throw retryError;
      }
    }
  }

  refreshSession(): Promise<AuthSnapshot> {
    if (this.authTransition)
      return Promise.reject(new ApiError(409, 'session_changed', 'Сессия изменяется.'));
    if (this.refreshFlight) return this.refreshFlight;
    const identity = this.identityGeneration;
    this.refreshEpoch++;
    this.refreshFailure = undefined;
    const flight: Promise<AuthSnapshot> = this.send<AuthSnapshot>('/auth/refresh', 'POST')
      .then((snapshot) => {
        if (identity !== this.identityGeneration)
          throw new ApiError(409, 'session_changed', 'Сессия изменилась.');
        this.generation++;
        return snapshot;
      })
      .catch((error) => {
        if (identity === this.identityGeneration) this.refreshFailure = error;
        if (
          identity === this.identityGeneration &&
          error instanceof ApiError &&
          error.status === 401
        )
          this.onSessionInvalidated?.();
        throw error;
      })
      .finally(() => {
        if (this.refreshFlight === flight) this.refreshFlight = undefined;
      });
    this.refreshFlight = flight;
    return flight;
  }

  async getSession(): Promise<AuthSnapshot> {
    try {
      return await this.request<AuthSnapshot>('/auth/session');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return emptySnapshot();
      throw error;
    }
  }

  getAuthSnapshot(): Promise<AuthSnapshot> {
    return this.getSession();
  }

  async signIn(login: string, password: string): Promise<AuthSnapshot> {
    this.identityGeneration++;
    this.authTransition = true;
    try {
      await this.refreshFlight?.catch(() => {});
      const snapshot = await this.send<AuthSnapshot>('/auth/login', 'POST', { login, password });
      this.generation++;
      this.refreshFailure = undefined;
      return snapshot;
    } finally {
      this.authTransition = false;
    }
  }

  async signOut(): Promise<void> {
    this.identityGeneration++;
    this.authTransition = true;
    try {
      await this.refreshFlight?.catch(() => {});
      await this.send<void>('/auth/logout', 'POST');
      this.generation++;
    } finally {
      this.authTransition = false;
    }
  }

  getMe(): Promise<AppUser> {
    return this.request('/auth/me');
  }
  listUsers(): Promise<AppUser[]> {
    return this.request('/users');
  }
  listAccessOperations(userId?: string): Promise<AccessOperation[]> {
    const query =
      userId === undefined ? '' : '?' + new URLSearchParams({ user_id: userId }).toString();
    return this.request('/access-operations' + query);
  }
  getAccessOperation(id: string): Promise<AccessOperation> {
    return this.request(`/access-operations/${encodeURIComponent(id)}`);
  }
  createUser(input: UserInput): Promise<AppUser> {
    return this.request('/users', 'POST', input);
  }
  updateUser(id: string, input: UserUpdate): Promise<AppUser> {
    return this.request(`/users/${encodeURIComponent(id)}`, 'PATCH', input);
  }
  resetPassword(id: string, password: string): Promise<void> {
    return this.request(`/users/${encodeURIComponent(id)}/password`, 'POST', { password });
  }
  async changePassword(current: string, password: string): Promise<void> {
    await this.request<void>('/auth/password', 'POST', { current, password });
    this.generation++;
  }

  listOffices(): Promise<OfficeConfig[]> {
    return this.request('/offices');
  }
  getOffice(id: string): Promise<OfficeConfig> {
    return this.request(`/offices/${encodeURIComponent(id)}`);
  }
  createOffice(input: OfficeCreateInput): Promise<OfficeConfig> {
    return this.request('/offices', 'POST', input);
  }
  updateOfficeSettings(
    id: string,
    input: OfficeSettingsInput,
    revision?: number,
  ): Promise<OfficeConfig> {
    return this.request(`/offices/${encodeURIComponent(id)}/settings`, 'PATCH', {
      ...input,
      revision,
    });
  }
  saveOfficePlan(id: string, floors: Floor[], revision?: number): Promise<OfficeConfig> {
    return this.request(`/offices/${encodeURIComponent(id)}/plan`, 'PUT', { floors, revision });
  }
  importOffice(document: OfficeConfig, key: string): Promise<OfficeConfig> {
    return this.request('/offices/import', 'POST', { document }, { 'Idempotency-Key': key });
  }
  getPolicy(): Promise<BookingPolicy> {
    return this.request('/booking/policy');
  }
  getBootstrap(): Promise<BootstrapSnapshot> {
    return this.request('/bootstrap');
  }

  listBookings(officeId: string): Promise<ClientBooking[]> {
    return this.request(`/offices/${encodeURIComponent(officeId)}/bookings`);
  }
  createBooking(officeId: string, input: BookingInput, key: string): Promise<ClientBooking> {
    return this.request(`/offices/${encodeURIComponent(officeId)}/bookings`, 'POST', input, {
      'Idempotency-Key': key,
    });
  }
  updateBooking(
    officeId: string,
    booking: ClientBooking,
    input: BookingInput,
  ): Promise<ClientBooking> {
    return this.request(
      `/offices/${encodeURIComponent(officeId)}/bookings/${encodeURIComponent(booking.id)}`,
      'PATCH',
      { ...input, revision: booking.revision },
    );
  }
  cancelBooking(officeId: string, booking: ClientBooking): Promise<ClientBooking> {
    return this.request(
      `/offices/${encodeURIComponent(officeId)}/bookings/${encodeURIComponent(booking.id)}/cancel`,
      'POST',
      { revision: booking.revision },
    );
  }
  getAssistantCapabilities(): Promise<AssistantCapabilities> {
    return this.request('/assistant/capabilities');
  }
  getCurrentChat(): Promise<Dialogue> {
    return this.request('/chats/current');
  }
  listArchivedChats(): Promise<ChatSession[]> {
    return this.request('/chats');
  }
  getChat(id: string): Promise<Dialogue> {
    return this.request(`/chats/${encodeURIComponent(id)}`);
  }
  newChat(): Promise<Dialogue> {
    return this.request('/chats/new', 'POST');
  }
  sendChatMessage(
    id: string,
    message: string,
    context: ChatContext,
    key: string,
  ): Promise<GenerationSnapshot> {
    return this.request(
      `/chats/${encodeURIComponent(id)}/messages`,
      'POST',
      { message, context },
      { 'Idempotency-Key': key },
    );
  }
  getGeneration(id: string): Promise<GenerationSnapshot> {
    return this.request(`/generations/${encodeURIComponent(id)}`);
  }
}

export function createGatewayClient(options: GatewayClientOptions = {}): GatewayClient {
  return new GatewayClient(options);
}
