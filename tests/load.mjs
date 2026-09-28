// Loads the browser source files into an isolated Node context (they attach to globalThis.NX).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = ['src/core/util.js', 'src/core/schema.js', 'src/core/db.js', 'src/core/store.js', 'src/core/analyzer.js'];

export function loadCore() {
  const ctx = vm.createContext({ console, crypto: globalThis.crypto, setTimeout, clearTimeout, Date, JSON, Math });
  for (const f of CORE) vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
  return ctx.NX;
}
