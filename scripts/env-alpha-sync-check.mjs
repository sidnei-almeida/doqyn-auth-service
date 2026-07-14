#!/usr/bin/env node
/**
 * Atalho no auth-service: valida sync com o Alpha (delega ao script do Alpha).
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const authRoot = resolve(__dirname, '..');
const alphaScript = resolve(authRoot, '../doqyn-alpha-document-intelligence/scripts/env-auth-sync-check.mjs');

if (!existsSync(alphaScript)) {
  console.error('Não achei o script do Alpha em:', alphaScript);
  console.error('Clone doqyn-alpha-document-intelligence como irmão deste repo, ou rode:');
  console.error('  node /caminho/alpha/scripts/env-auth-sync-check.mjs --auth-dir', authRoot);
  process.exit(1);
}

const extra = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  [alphaScript, '--auth-dir', authRoot, '--alpha-env', resolve(authRoot, '../doqyn-alpha-document-intelligence/.env'), ...extra],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
