import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A CI step that does nothing must not be able to look green.
 *
 * `pnpm --filter <pkg> <word>` runs a package *script* named <word>. If no such
 * script exists, pnpm prints
 *
 *   None of the selected packages has a "<word>" script
 *
 * and exits 0. The step passes, having done nothing. Two workflows carried
 * exactly that for the Prisma schema push -- `pnpm --filter @hopwhistle/api
 * prisma db push` instead of `... exec prisma db push` -- so the schema was
 * never created. It went unnoticed for as long as it did because the only
 * suites that needed a schema sat behind `continue-on-error`.
 *
 * Running a binary needs `exec`. This test reads the workflow files and fails
 * if any filtered invocation names a script that does not exist in the package
 * it is filtered to, which is the shape of that mistake.
 */

const WORKFLOWS_DIR = join(__dirname, '..', '..', '..', '..', '.github', 'workflows');
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

/** pnpm subcommands that are pnpm's own, not a package script. */
const PNPM_BUILTINS = new Set([
  'exec',
  'run',
  'install',
  'add',
  'remove',
  'dlx',
  'why',
  'list',
  'update',
  'publish',
  'pack',
  'store',
  'link',
  'unlink',
  'rebuild',
  'prune',
]);

interface PackageManifest {
  name: string;
  path: string;
  /** Directory relative to the repo root, posix-separated, e.g. "packages/sdk". */
  dir: string;
  scripts: Set<string>;
}

function readManifests(): Map<string, PackageManifest> {
  const found = new Map<string, PackageManifest>();

  const candidates: string[] = [join(REPO_ROOT, 'package.json')];
  for (const group of ['apps', 'packages']) {
    const dir = join(REPO_ROOT, group);
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      candidates.push(join(dir, entry, 'package.json'));
      // apps/media/* and friends nest one level deeper.
      try {
        for (const nested of readdirSync(join(dir, entry))) {
          candidates.push(join(dir, entry, nested, 'package.json'));
        }
      } catch {
        // Not a directory, or unreadable -- the candidate above still stands.
      }
    }
  }

  for (const path of candidates) {
    let parsed: { name?: string; scripts?: Record<string, string> };
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8')) as typeof parsed;
    } catch {
      continue;
    }
    if (!parsed.name) continue;
    found.set(parsed.name, {
      name: parsed.name,
      path,
      dir: relative(REPO_ROOT, dirname(path)).split(sep).join('/'),
      scripts: new Set(Object.keys(parsed.scripts ?? {})),
    });
  }

  return found;
}

interface Invocation {
  workflow: string;
  line: number;
  pkg: string;
  word: string;
}

function filteredInvocations(): Invocation[] {
  const out: Invocation[] = [];
  const pattern = /pnpm\s+(?:--filter|-F)\s+(\S+)\s+([a-z][a-zA-Z0-9:_-]*)/g;

  for (const file of readdirSync(WORKFLOWS_DIR).filter(f => /\.ya?ml$/.test(f))) {
    const lines = readFileSync(join(WORKFLOWS_DIR, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(pattern)) {
        const [, pkg, word] = match;
        if (PNPM_BUILTINS.has(word)) continue;
        out.push({ workflow: file, line: index + 1, pkg, word });
      }
    });
  }

  return out;
}

/**
 * Resolve a --filter selector to the packages it selects.
 *
 * pnpm accepts a package name, but also a path glob such as `./packages/*`,
 * which selects every workspace package under that directory. Treating a glob
 * as a package name reports a false "unknown package", so both forms are
 * handled here.
 */
function select(selector: string, manifests: Map<string, PackageManifest>): PackageManifest[] {
  const cleaned = selector.replace(/^["']|["']$/g, '');

  const looksLikePath =
    cleaned.startsWith('./') || cleaned.startsWith('../') || cleaned.includes('/*');
  if (!looksLikePath) {
    const byName = manifests.get(cleaned);
    return byName ? [byName] : [];
  }

  const normalized = cleaned.replace(/^\.\//, '').replace(/\/$/, '');
  const asRegex = new RegExp(
    `^${normalized
      .split('/')
      .map(part =>
        part
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '\u0000')
          .replace(/\*/g, '[^/]*')
          .replace(/\u0000/g, '.*')
      )
      .join('/')}$`
  );

  return [...manifests.values()].filter(m => asRegex.test(m.dir));
}

describe('CI workflows do not contain steps that silently do nothing', () => {
  it('finds the invocations it is meant to be checking', () => {
    // Guards the guard: a regex that matches nothing would pass every case
    // below without examining anything.
    expect(filteredInvocations().length).toBeGreaterThan(0);
  });

  it('every `pnpm --filter <pkg> <script>` names a script that exists', () => {
    const manifests = readManifests();
    const offenders: string[] = [];

    for (const { workflow, line, pkg, word } of filteredInvocations()) {
      const selected = select(pkg, manifests);

      if (selected.length === 0) {
        offenders.push(
          `${workflow}:${line} filters to "${pkg}", which selects no workspace package`
        );
        continue;
      }

      // pnpm only errors when *none* of the selected packages has the script,
      // so that is the condition worth failing on. A glob that legitimately
      // spans packages where only some define the script still does work.
      if (!selected.some(m => m.scripts.has(word))) {
        const where =
          selected.length === 1 ? selected[0].path : `${selected.length} packages matching ${pkg}`;
        offenders.push(
          `${workflow}:${line} runs "pnpm --filter ${pkg} ${word}", but no selected package has a ` +
            `"${word}" script (${where}). pnpm will print 'None of the selected packages has a ` +
            `"${word}" script' and exit 0, so the step passes without doing anything. ` +
            `If "${word}" is a binary, use "pnpm --filter ${pkg} exec ${word} ...".`
        );
      }
    }

    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([]);
  });
});
