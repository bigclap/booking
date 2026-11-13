export const officePath = (id: string) => `/admin/offices/${encodeURIComponent(id)}`;
export const officePlanPath = officePath;
export const officeBookingsPath = (id: string) => `${officePath(id)}/bookings`;
export const officeSettingsPath = (id: string) => `${officePath(id)}/settings`;

export function parseOfficeRoute(
  path: string,
): { officeId: string; view: 'settings' | 'plan' | 'bookings' } | null {
  const match = /^\/admin\/offices\/([^/]+)(?:\/(plan|bookings|settings))?$/.exec(path);
  if (!match) return null;
  try {
    return {
      officeId: decodeURIComponent(match[1]),
      view: match[2] === 'settings' ? 'settings' : match[2] === 'bookings' ? 'bookings' : 'plan',
    };
  } catch {
    return null;
  }
}
