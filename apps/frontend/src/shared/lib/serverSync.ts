export const SERVER_SYNC_EVENT = 'plan-room:server-sync';

export interface ServerSync {
  type: 'ready' | 'resync' | 'booking.changed' | 'office.changed' | 'chat.changed';
  officeId?: string;
  /** A completed booking may archive the current dialogue without creating another. */
  sessionId?: string | null;
  archivedSessionId?: string;
}

const TYPES = new Set<ServerSync['type']>([
  'ready',
  'resync',
  'booking.changed',
  'office.changed',
  'chat.changed',
]);
const id = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 1000 &&
  value === value.trim() &&
  !/[\u0000-\u001f\u007f]/.test(value);

/** Decode an invalidation only; never forward arbitrary payload fields or execute actions. */
export function decodeServerSync(type: ServerSync['type'], payload: unknown): ServerSync | null {
  if (!TYPES.has(type) || typeof payload !== 'string') return null;
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const result: ServerSync = { type };
  if (type === 'booking.changed' || type === 'office.changed') {
    if (record.officeId !== undefined) {
      if (!id(record.officeId)) return null;
      result.officeId = record.officeId;
    }
  }
  if (type === 'chat.changed') {
    if (record.sessionId !== undefined) {
      if (record.sessionId !== null && !id(record.sessionId)) return null;
      result.sessionId = record.sessionId;
    }
    if (record.archivedSessionId !== undefined) {
      if (!id(record.archivedSessionId)) return null;
      result.archivedSessionId = record.archivedSessionId;
    }
  }
  return result;
}
