// Compatibility entry point. The sample must be unreviewed.
// Each phase records its assertions under evidence/; the caller owns session cleanup.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const options = process.argv.slice(2);
if (options.includes('--help')) {
  console.log('verify-ui.mjs runs controls then persistence by default. Pass --phase legacy with --session-file for the restored sidebar/native-key regression check, or select another single phase.\n');
  execFileSync(process.execPath, ['scripts/verify-touch.mjs', '--help'], { stdio: 'inherit' });
  process.exit(0);
}
const phaseIndex = options.indexOf('--phase');
const singlePhase = phaseIndex === -1 ? null : options[phaseIndex + 1];
if (phaseIndex !== -1 && (!singlePhase || singlePhase.startsWith('--'))) throw new Error('--phase requires a value.');
if (phaseIndex !== -1) options.splice(phaseIndex, 2);
for (const phase of singlePhase ? [singlePhase] : ['controls', 'persistence']) {
  const args = [...options];
  const directoryIndex = args.indexOf('--evidence-dir');
  if (!singlePhase && directoryIndex !== -1 && args[directoryIndex + 1]) {
    args[directoryIndex + 1] = join(args[directoryIndex + 1], phase);
  }
  execFileSync(process.execPath, ['scripts/verify-touch.mjs', '--phase', phase, ...args], { stdio: 'inherit' });
}
