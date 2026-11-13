import type { AccessOperation } from '../../shared/api';

export interface AccessOperationsState {
  operations: AccessOperation[];
  loading: boolean;
  error: boolean;
}

interface OperationSource {
  listAccessOperations(): Promise<AccessOperation[]>;
  getAccessOperation(id: string): Promise<AccessOperation>;
}

/** A late list snapshot must not undo a confirmed completion receipt. */
export function mergeAccessOperations(
  previous: AccessOperation[],
  incoming: AccessOperation[],
): AccessOperation[] {
  const byId = new Map(previous.map((operation) => [operation.id, operation]));
  for (const operation of incoming) {
    const current = byId.get(operation.id);
    if (current?.status !== 'completed' || operation.status === 'completed')
      byId.set(operation.id, operation);
  }
  return [...byId.values()].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id),
  );
}

/** Read-only tracking. Mutation events carry receipts independently of the user form. */
export function createAccessOperationsTracker(
  source: OperationSource,
  onChange: (state: AccessOperationsState) => void,
  isVisible: () => boolean,
  pollMilliseconds = 3000,
) {
  let disposed = false;
  let operations: AccessOperation[] = [];
  let loading = true;
  let listError = false;
  let listFlight: Promise<void> | null = null;
  const detailErrors = new Set<string>();
  const detailFlights = new Map<string, Promise<void>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling = false;

  function publish() {
    if (!disposed)
      onChange({
        operations,
        loading: loading || detailFlights.size > 0,
        error: listError || detailErrors.size > 0,
      });
  }

  function stopTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule() {
    stopTimer();
    if (
      disposed ||
      polling ||
      !isVisible() ||
      !operations.some((operation) => operation.status === 'pending')
    )
      return;
    timer = setTimeout(() => {
      void poll();
    }, pollMilliseconds);
  }

  async function poll() {
    timer = undefined;
    if (disposed || !isVisible()) return;
    polling = true;
    try {
      await Promise.all(
        operations
          .filter((operation) => operation.status === 'pending')
          .map((operation) => detail(operation.id)),
      );
    } finally {
      polling = false;
      schedule();
    }
  }

  function list(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (listFlight) return listFlight;
    listFlight = (async () => {
      try {
        await Promise.resolve();
        if (disposed) return;
        const next = await source.listAccessOperations();
        if (disposed) return;
        operations = mergeAccessOperations(operations, next);
        for (const operation of next) detailErrors.delete(operation.id);
        listError = false;
      } catch {
        if (!disposed) listError = true;
      } finally {
        listFlight = null;
        if (!disposed) {
          loading = false;
          publish();
          schedule();
        }
      }
    })();
    return listFlight;
  }

  function detail(id: string): Promise<void> {
    if (disposed || !id) return Promise.resolve();
    const flight = detailFlights.get(id);
    if (flight) return flight;
    const next = (async () => {
      try {
        await Promise.resolve();
        if (disposed) return;
        const operation = await source.getAccessOperation(id);
        if (disposed) return;
        operations = mergeAccessOperations(operations, [operation]);
        detailErrors.delete(id);
      } catch {
        if (!disposed) detailErrors.add(id);
      } finally {
        detailFlights.delete(id);
        if (!disposed) {
          publish();
          schedule();
        }
      }
    })();
    detailFlights.set(id, next);
    publish();
    return next;
  }

  async function refresh() {
    // Failed event-ID reads must remain retryable even if the operation is not in the latest list.
    await Promise.all([list(), ...[...detailErrors].map((id) => detail(id))]);
  }

  return {
    start() {
      publish();
      void refresh();
    },
    refresh,
    observe(id: string) {
      return detail(id);
    },
    visibilityChanged() {
      if (!isVisible()) stopTimer();
      else void refresh();
    },
    dispose() {
      disposed = true;
      stopTimer();
    },
  };
}
