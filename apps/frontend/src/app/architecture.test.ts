/// <reference types="vite/client" />
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const assets: Record<string, string> = import.meta.glob('../**/*.{ts,tsx,css}', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const contents = new Map(
  Object.entries(assets).map(([name, text]) => [
    new URL(name, 'https://source.invalid/app/architecture.test.ts').pathname.slice(1),
    text,
  ]),
);
const slices = new Set(['app', 'office', 'booking', 'users', 'auth', 'assistant', 'shared']);
const ranks: Record<string, number> = { atoms: 1, molecules: 2, organisms: 3, pages: 4 };
const all = [...contents.keys()];
const source = all.filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.test.ts'));
interface Edge {
  from: string;
  to: string;
  typeOnly: boolean;
}
const edges: Edge[] = [];
for (const name of source) {
  const ast = ts.createSourceFile(name, contents.get(name)!, ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) {
    if (
      (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) ||
      !node.moduleSpecifier ||
      !ts.isStringLiteral(node.moduleSpecifier)
    )
      continue;
    const specifier = node.moduleSpecifier.text;
    if (!specifier.startsWith('.')) continue;
    const base = new URL(specifier, 'https://source.invalid/' + name).pathname.slice(1);
    const resolved = [
      base,
      base + '.ts',
      base + '.tsx',
      base + '/index.ts',
      base + '/index.tsx',
    ].find((candidate) => contents.has(candidate) && /\.tsx?$/.test(candidate));
    if (!resolved) throw new Error(`Unresolved local dependency: ${name} → ${specifier}`);
    const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
    const typeOnly = ts.isExportDeclaration(node)
      ? node.isTypeOnly
      : !!clause?.isTypeOnly ||
        (!!clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          !clause.name &&
          clause.namedBindings.elements.every((entry) => entry.isTypeOnly));
    edges.push({ from: name, to: resolved, typeOnly });
  }
}

function violations(predicate: (edge: Edge) => boolean): string[] {
  return edges.filter(predicate).map((edge) => `${edge.from} → ${edge.to}`);
}

describe('vertical slices and atomic UI boundaries', () => {
  it('keeps source owned by an explicit business slice, app, or shared foundation', () => {
    expect(source.map((name) => name).filter((name) => !slices.has(name.split('/')[0]))).toEqual(
      [],
    );
  });
  it('keeps data hooks independent from views and application composition', () => {
    expect(
      violations(
        ({ from, to }) =>
          from.split('/')[1] === 'hooks' &&
          from.split('/')[0] !== 'app' &&
          (to.split('/')[0] === 'app' || !!ranks[to.split('/')[1]]),
      ),
    ).toEqual([]);
  });
  it('composes UI downwards from pages to organisms, molecules and atoms', () => {
    expect(
      violations(
        ({ from, to }) =>
          !!ranks[from.split('/')[1]] &&
          !!ranks[to.split('/')[1]] &&
          ranks[to.split('/')[1]] > ranks[from.split('/')[1]],
      ),
    ).toEqual([]);
  });
  it('keeps reusable shared UI independent from business slices', () => {
    expect(
      violations(
        ({ from, to }) =>
          from.startsWith('shared' + '/') &&
          !!ranks[from.split('/')[1]] &&
          !to.startsWith('shared' + '/'),
      ),
    ).toEqual([]);
  });
  it('uses explicit public entry points when crossing business slices', () => {
    expect(
      violations(({ from, to }) => {
        const target = to.split('/')[0];
        if (from.split('/')[0] === target || target === 'shared' || target === 'app') return false;
        const entry = to.slice(target.length + 1);
        return !(
          /^(index|types|routes|geometry|archive)\.ts$/.test(entry) ||
          /^(hooks|atoms|molecules|organisms)\/index\.ts$/.test(entry) ||
          (from.startsWith('app/') && /^pages\/[^/]+\.tsx$/.test(entry))
        );
      }),
    ).toEqual([]);
  });
  it('colocates component styles instead of loading feature-wide CSS files', () => {
    expect(all.filter((name) => name.endsWith('.css')).map((name) => name)).toEqual([]);
  });
  it('has no circular runtime dependencies', () => {
    const graph = new Map<string, string[]>();
    for (const { from, to, typeOnly } of edges)
      if (!typeOnly) graph.set(from, [...(graph.get(from) || []), to]);
    const complete = new Set<string>();
    const active = new Set<string>();
    const cycles = new Set<string>();
    function walk(name: string, stack: string[]): void {
      if (active.has(name)) {
        cycles.add([...stack.slice(stack.indexOf(name)), name].join(' → '));
        return;
      }
      if (complete.has(name)) return;
      active.add(name);
      for (const dependency of graph.get(name) || []) walk(dependency, [...stack, name]);
      active.delete(name);
      complete.add(name);
    }
    for (const name of graph.keys()) walk(name, []);
    expect([...cycles]).toEqual([]);
  });
});
