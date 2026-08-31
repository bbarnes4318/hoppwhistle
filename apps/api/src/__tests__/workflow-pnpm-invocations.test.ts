import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
      const manifest = manifests.get(pkg);

      if (!manifest) {
        offenders.push(`${workflow}:${line} filters to unknown package "${pkg}"`);
        continue;
      }

      if (!manifest.scripts.has(word)) {
        offenders.push(
          `${workflow}:${line} runs "pnpm --filter ${pkg} ${word}", but ${pkg} has no "${word}" ` +
            `script (${manifest.path}). pnpm will print 'None of the selected packages has a ` +
            `"${word}" script' and exit 0, so the step passes without doing anything. ` +
            `If "${word}" is a binary, use "pnpm --filter ${pkg} exec ${word} ...".`
        );
      }
    }

    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([]);
  });
});
