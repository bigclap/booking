import { createGatewayClient } from './client';

export const SESSION_INVALIDATED_EVENT = 'plan-room:session-invalidated';
export const ACCESS_OPERATION_EVENT = 'plan-room:access-operation';

/** Share refresh single-flight across every HTTP-backed feature. Cookies remain HttpOnly. */
export const gateway = createGatewayClient({
  onSessionInvalidated: () => window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT)),
  onAccessOperation: (id) =>
    window.dispatchEvent(new CustomEvent(ACCESS_OPERATION_EVENT, { detail: { id } })),
});
