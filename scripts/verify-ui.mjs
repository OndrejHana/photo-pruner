// Compatibility entry point for the current touch UI. The sample must be unreviewed.
// Each phase records its assertions under evidence/; the caller owns session cleanup.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const options = process.argv.slice(2);
if (options.includes('--phase')) throw new Error('Use verify-touch.mjs to run an individual phase.');
for (const phase of ['controls', 'persistence']) {
  const args = [...options];
  const directoryIndex = args.indexOf('--evidence-dir');
  if (directoryIndex !== -1 && args[directoryIndex + 1]) {
    args[directoryIndex + 1] = join(args[directoryIndex + 1], phase);
  }
  execFileSync(process.execPath, ['scripts/verify-touch.mjs', '--phase', phase, ...args], { stdio: 'inherit' });
}
