// Renders each evals/images/<name>.txt to <name>.png with macOS Quick Look (qlmanage).
// Typed text only; add real photos as <name>.png + <name>.txt (the exact expected text).
import { execFileSync } from 'node:child_process';
import { readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'images');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
  execFileSync('qlmanage', ['-t', '-s', '900', '-o', dir, path.join(dir, file)], { stdio: 'ignore' });
  renameSync(path.join(dir, `${file}.png`), path.join(dir, file.replace(/\.txt$/, '.png')));
  console.log('rendered', file.replace(/\.txt$/, '.png'));
}
