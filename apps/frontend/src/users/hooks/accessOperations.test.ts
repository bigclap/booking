import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccessOperation } from '../../shared/api/client';
import {
  createAccessOperationsTracker,
  mergeAccessOperations,
  type AccessOperationsState,
} from './accessOperations';

const operation = (
  id = 'operation-1',
  status: AccessOperation['status'] = 'pending',
): AccessOperation => ({
  id,
  user_id: 'employee-1',
  reason: 'user_disabled',
  scope: { all_buildings: true },
  correlation_id: null,
  status,
  created_at: '2026-11-12T10:00:00Z',
  completed_at: status === 'completed' ? '2026-11-12T10:00:05Z' : null,
  cancelled_count: status === 'completed' ? 2 : 0,
  terminated_count: status === 'completed' ? 1 : 0,
  publication: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('access operation receipts', () => {
  it('keeps a completed event receipt when an older list arrives afterwards', async () => {
    const pendingList = deferred<AccessOperation[]>();
    const source = {
      listAccessOperations: vi.fn(() => pendingList.promise),
      getAccessOperation: vi.fn(async () => operation('operation-1', 'completed')),
    };
    let snapshot!: AccessOperationsState;
    const tracker = createAccessOperationsTracker(
      source,
      (value) => {
        snapshot = value;
      },
      () => true,
    );
    tracker.start();
    await tracker.observe('operation-1');
    pendingList.resolve([operation()]);
    await tracker.refresh();
    expect(snapshot.operations[0]).toMatchObject({
      status: 'completed',
      cancelled_count: 2,
      terminated_count: 1,
    });
    tracker.dispose();
  });

  it('retains event receipts omitted from the limited list', () => {
    expect(
      mergeAccessOperations([operation('receipt')], [operation('other')])
        .map((item) => item.id)
        .sort(),
    ).toEqual(['other', 'receipt']);
  });

  it('polls pending receipts only while visible and stops after completion', async () => {
    vi.useFakeTimers();
    let visible = true;
    const source = {
      listAccessOperations: vi.fn(async () => [operation()]),
      getAccessOperation: vi.fn(async () => operation('operation-1', 'completed')),
    };
    const tracker = createAccessOperationsTracker(
      source,
      () => {},
      () => visible,
    );
    await tracker.refresh();
    visible = false;
    tracker.visibilityChanged();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(source.getAccessOperation).not.toHaveBeenCalled();
    visible = true;
    tracker.visibilityChanged();
    await vi.advanceTimersByTimeAsync(3000);
    expect(source.getAccessOperation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(source.getAccessOperation).toHaveBeenCalledTimes(1);
    tracker.dispose();
  });

  it('keeps pending state on read errors and retries a receipt missing from the list', async () => {
    vi.useFakeTimers();
    const source = {
      listAccessOperations: vi.fn(async () => [] as AccessOperation[]),
      getAccessOperation: vi
        .fn<(id: string) => Promise<AccessOperation>>()
        .mockRejectedValueOnce(new Error('private broker error'))
        .mockResolvedValue(operation('new-receipt', 'completed')),
    };
    let snapshot!: AccessOperationsState;
    const tracker = createAccessOperationsTracker(
      source,
      (value) => {
        snapshot = value;
      },
      () => true,
    );
    await tracker.refresh();
    await tracker.observe('new-receipt');
    expect(snapshot).toMatchObject({ error: true, operations: [] });
    await tracker.refresh();
    expect(snapshot).toMatchObject({
      error: false,
      operations: [{ id: 'new-receipt', status: 'completed' }],
    });
    expect(source.getAccessOperation).toHaveBeenCalledTimes(2);
    tracker.dispose();
  });

  it('does not mark pending receipts complete when a poll fails', async () => {
    vi.useFakeTimers();
    const source = {
      listAccessOperations: vi.fn(async () => [operation()]),
      getAccessOperation: vi.fn(async () => {
        throw new Error('unavailable');
      }),
    };
    let snapshot!: AccessOperationsState;
    const tracker = createAccessOperationsTracker(
      source,
      (value) => {
        snapshot = value;
      },
      () => true,
    );
    await tracker.refresh();
    await vi.advanceTimersByTimeAsync(3000);
    expect(snapshot).toMatchObject({ error: true, operations: [{ status: 'pending' }] });
    tracker.dispose();
  });

  it('ignores responses and timers after the page or identity is disposed', async () => {
    vi.useFakeTimers();
    const response = deferred<AccessOperation[]>();
    const source = {
      listAccessOperations: vi.fn(() => response.promise),
      getAccessOperation: vi.fn(async () => operation()),
    };
    const changed = vi.fn();
    const tracker = createAccessOperationsTracker(source, changed, () => true);
    tracker.start();
    const initialCalls = changed.mock.calls.length;
    tracker.dispose();
    response.resolve([operation()]);
    await tracker.refresh();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(changed).toHaveBeenCalledTimes(initialCalls);
    expect(source.getAccessOperation).not.toHaveBeenCalled();
  });
});
