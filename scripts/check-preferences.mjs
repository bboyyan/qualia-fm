/** Repo-wide code scan. Read-only handoff prose/screenshots are historical specs, not runtime defaults. */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const forbiddenName = /^(?:(?:default|confirmed|known|user)[_-]?)?(?:preferences?|taste|favou?rites?)$/i;
const assumption = /(?:依你的描述設想|延續你描述的|你(?:喜歡|偏好)[：:])/;
export function scanPreferenceSource(filename, source) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings = [];
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) && forbiddenName.test(node.name.getText(file).replaceAll(/['"]/g, ''))) {
      findings.push(`${filename}:${file.getLineAndCharacterOfPosition(node.pos).line + 1}: extra default preference declaration`);
    }
    if ((ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) && assumption.test(node.getText(file))) {
      // Scanner tests intentionally contain source snippets as strings; those aren't runtime defaults.
      if (!filename.includes('/test/') && !filename.startsWith('TEST')) findings.push(`${filename}: inferred texture/taste string`);
      else if (filename.startsWith('TEST')) findings.push(`${filename}: inferred texture/taste string`);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return findings;
}

export async function checkPreferences(root) {
  const skipped = new Set(['.git', 'node_modules', 'dist', 'test-results', 'playwright-report', '.pnpm-store']);
  const findings = [];
  let count = 0;
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (skipped.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (['.ts', '.tsx', '.js', '.mjs'].includes(extname(path)) && !/\.d\.[cm]?ts$/.test(path)) {
        count += 1;
        findings.push(...scanPreferenceSource(relative(root, path), await readFile(path, 'utf8')));
      }
    }
  }
  await walk(root);
  const feedback = await readFile(join(root, 'packages/contracts/src/feedback.ts'), 'utf8');
  const confirmed = feedback.match(/export const CONFIRMED_SEED = (.+) as const;/)?.[1];
  if (confirmed !== "{ kind: 'song', text: 'Time Flows Ever Onward', artist: 'Evan Call' }") findings.push('confirmed seed differs from the sole authorized preference');
  return { count, findings };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { count, findings } = await checkPreferences(process.cwd());
  process.stdout.write(`V5: ${count} code files scanned; ${findings.length} extra default preference/assumption hits.\n`);
  for (const finding of findings) process.stdout.write(`${finding}\n`);
  process.exitCode = findings.length ? 1 : 0;
}
