export type ResourceFilter = 'all' | 'desk' | 'room';

/** Snapshot keys intentionally match the server's historical resource document. */
export interface BookingResourceSnapshot {
  id: string;
  name: string;
  kind: string;
  floor_id: string;
  floor_name: string;
  capacity: number;
  equipment: Array<{ type: string; quantity: number }>;
  descendant_ids: string[];
}

export interface BookingWarning {
  code: string;
  capacity?: number;
  participants?: number;
}

export interface ClientBooking {
  id: string;
  /** Absent only in data written before the multi-building catalog. */
  buildingId?: string;
  floorId: string;
  resourceId: string;
  date: string;
  start: number;
  end: number;
  ownerId: string;
  ownerName: string;
  participants?: number;
  status: 'active' | 'cancelled';
  /** Server concurrency token; absent only in archived browser previews. */
  revision?: number;
  needsReview?: boolean;
  /** Optional for archived previews and bookings created before server snapshots. */
  reviewReasons?: string[];
  resourceSnapshot?: Partial<BookingResourceSnapshot>;
  cancellationReason?: string | null;
  warnings?: BookingWarning[];
  startsAt?: string | null;
  endsAt?: string | null;
  scheduledEndsAt?: string | null;
  cancelledAt?: string | null;
}

export interface TimeRange {
  start: number;
  end: number;
}

export const CURRENT_USER_ID = 'current-user';
