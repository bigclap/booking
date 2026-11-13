import type { ReactElement } from 'react';
const ids = new Map<string, string>();
function resourceId(id: string, css: string): string {
  const key = id + css;
  const known = ids.get(key);
  if (known) return known;
  let hash = 2166136261;
  for (let index = 0; index < css.length; index++)
    hash = Math.imul(hash ^ css.charCodeAt(index), 16777619);
  const result = `workplace:${id}:${(hash >>> 0).toString(36)}`;
  ids.set(key, result);
  return result;
}

/** Native React 19 style resource: colocated, deduplicated, and refreshed when CSS changes. */
export function Styles({
  id,
  children,
  precedence = 'components',
}: {
  id: string;
  children: string;
  precedence?: string;
}): ReactElement {
  return (
    <style href={resourceId(id, children)} precedence={precedence}>
      {children}
    </style>
  );
}
