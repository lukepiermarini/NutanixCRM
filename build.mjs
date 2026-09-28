// Zero-dependency build: inlines CSS + JS into ONE self-contained HTML file
// that can be emailed / shared / double-clicked. Usage: node build.mjs [--watch]
import { readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, 'dist', 'se-pipeline.html');

// Load order matters: each file extends the global NX namespace.
export const JS_FILES = [
  'src/core/util.js',
  'src/core/schema.js',
  'src/core/db.js',
  'src/core/store.js',
  'src/core/filesync.js',
  'src/core/analyzer.js',
  'src/ui/dom.js',
  'src/ui/components/overlay.js',
  'src/ui/components/common.js',
  'src/ui/components/editors.js',
  'src/ui/components/meeting-wizard.js',
  'src/ui/views/pipeline.js',
  'src/ui/views/tasks.js',
  'src/ui/views/meetings.js',
  'src/ui/views/settings.js',
  'src/ui/sample.js',
  'src/app.js',
];
const CSS_FILES = ['src/styles/app.css'];

const read = (p) => readFileSync(join(root, p), 'utf8');

export function build() {
  const pkg = JSON.parse(read('package.json'));
  const css = CSS_FILES.map(read).join('\n');
  const js = JS_FILES.map((f) => `/* ---- ${f} ---- */\n${read(f)}`).join('\n')
    .replace(/<\/script/gi, '<\\/script'); // never terminate the inline <script> early
  const html = read('src/index.template.html')
    .replace('/*@@CSS@@*/', () => css)
    .replace('/*@@JS@@*/', () => `/* SE Pipeline v${pkg.version} · built ${new Date().toISOString()} */\n${js}`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  console.log(`Built ${OUT} (${(html.length / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build();
  if (process.argv.includes('--watch')) {
    console.log('Watching src/ …');
    let t;
    watch(join(root, 'src'), { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => { try { build(); } catch (e) { console.error(e.message); } }, 100); });
  }
}
