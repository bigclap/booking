export const officeDetailsPath = (id: string) => `/admin/offices/${encodeURIComponent(id)}`;
export const officePlanPath = (id: string) => `${officeDetailsPath(id)}/plan`;
export const officeBookingsPath = (id: string) => `${officeDetailsPath(id)}/bookings`;

export function parseOfficeRoute(
  path: string,
): { officeId: string; view: 'details' | 'plan' | 'bookings' } | null {
  const match = /^\/admin\/offices\/([^/]+)(?:\/(plan|bookings))?$/.exec(path);
  if (!match) return null;
  try {
    return {
      officeId: decodeURIComponent(match[1]),
      view: match[2] === 'plan' ? 'plan' : match[2] === 'bookings' ? 'bookings' : 'details',
    };
  } catch {
    return null;
  }
}
