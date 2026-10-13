import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compactMonthlyDetails, writeMonthlyHealth} from './health_month_storage.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--dry-run') args.dryRun = true;
  else if (['--target'].includes(arg) && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) args[arg.slice(2)] = process.argv[++i];
  else throw new Error(`Unknown or incomplete argument: ${arg}`);
}
const root = path.resolve(args.target ?? path.join(repoRoot, 'static/data/health'));
let count = 0;
for (const year of fs.readdirSync(root).filter((entry) => /^\d{4}$/.test(entry))) {
  for (const month of fs.readdirSync(path.join(root, year)).filter((entry) => /^(0[1-9]|1[0-2])\.json$/.test(entry))) {
    const file = path.join(root, year, month);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (args.dryRun) {
      if (JSON.stringify(compactMonthlyDetails(raw)) !== JSON.stringify(raw)) count++;
    } else if (writeMonthlyHealth(file, raw)) count++;
  }
}
console.log(`${args.dryRun ? 'Would compact' : 'Compacted'} ${count} monthly files`);
