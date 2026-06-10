import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);
const healthDir = path.join(repoRoot, 'static', 'health');

const args = parseArgs(process.argv.slice(2));
const dryRun = args.dryRun ?? false;
const targetYears = args.year ? [args.year] : null;

if (dryRun) {
  console.log('[DRY RUN] Would split:');
}

const files = fs.readdirSync(healthDir).filter((f) => /^health_data_\d{4}\.json$/.test(f));

for (const file of files) {
  const yearMatch = file.match(/^health_data_(\d{4})\.json$/);
  if (!yearMatch) continue;
  const year = yearMatch[1];
  if (targetYears && !targetYears.includes(year)) continue;

  const filePath = path.join(healthDir, file);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!raw.data) {
    console.warn(`Skipping ${file}: no data property`);
    continue;
  }

  // Collect all unique YYYY-MM from all data points
  const monthSet = new Set();
  const {data} = raw;

  for (const [sectionKey, sectionVal] of Object.entries(data)) {
    if (!sectionVal || typeof sectionVal !== 'object') continue;

    for (const [recordKey, records] of Object.entries(sectionVal)) {
      if (!Array.isArray(records)) continue;

      for (const record of records) {
        // healthMetrics: record.data[].date like "2026-01-01 00:00:00 +0800"
        if (recordKey === 'metrics' && Array.isArray(record.data)) {
          for (const pt of record.data) {
            if (pt.date) monthSet.add(pt.date.slice(0, 7));
          }
        }
        // workouts: record.start like "2026-01-01 00:00:00 +0800"
        else if (recordKey === 'workouts' && record.start) {
          monthSet.add(record.start.slice(0, 7));
        }
        // heartRateNotifications: record.start
        else if (recordKey === 'heartRateNotifications' && record.start) {
          monthSet.add(record.start.slice(0, 7));
        }
        // stateOfMind: record.start
        else if (recordKey === 'stateOfMind' && record.start) {
          monthSet.add(record.start.slice(0, 7));
        }
        // General fallback: any date-like string field
        else if (typeof record === 'object') {
          for (const field of ['start', 'end', 'date']) {
            if (typeof record[field] === 'string' && record[field].length >= 10) {
              monthSet.add(record[field].slice(0, 7));
              break;
            }
          }
        }
      }
    }
  }

  const months = [...monthSet].sort();

  for (const month of months) {
    const [y, m] = month.split('-');
    const outputFile = `${m}.json`;
    const yearDir = path.join(healthDir, y);
    fs.mkdirSync(yearDir, {recursive: true});
    const outputPath = path.join(yearDir, outputFile);

    if (!dryRun && fs.existsSync(outputPath)) {
      // Merge: read existing, update data sections, write back
      const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      for (const [sk, sv] of Object.entries(data)) {
        if (!sv || typeof sv !== 'object') continue;
        for (const [rk, records] of Object.entries(sv)) {
          if (!Array.isArray(records)) continue;
          if (!Array.isArray(existing.data[sk]?.[rk])) {
            if (!existing.data[sk]) existing.data[sk] = {};
            existing.data[sk][rk] = [];
          }
          for (const record of records) {
            if (recordHasDateInMonth(record, rk, month)) {
              existing.data[sk][rk].push(record);
            }
          }
        }
      }
      existing.data = sortObjectSections(existing.data);
      fs.writeFileSync(outputPath, `${JSON.stringify(existing, null, 2)}\n`);
    } else if (!dryRun) {
      // Build month-specific data
      const monthData = {};
      for (const [sk, sv] of Object.entries(data)) {
        if (!sv || typeof sv !== 'object') continue;
        monthData[sk] = {};
        for (const [rk, records] of Object.entries(sv)) {
          if (!Array.isArray(records)) {
            monthData[sk][rk] = records;
            continue;
          }
          const filtered = records.filter((record) => recordHasDateInMonth(record, rk, month));
          monthData[sk][rk] = filtered;
        }
      }

      const monthExport = {
        exportedAt: raw.exportedAt,
        dateRange: {
          start: `${month}-01 00:00:00 +0800`,
          end: `${month}-${lastDayOfMonth(y, m)} 23:59:59 +0800`,
        },
        data: sortObjectSections(monthData),
      };
      fs.writeFileSync(outputPath, `${JSON.stringify(monthExport, null, 2)}\n`);
    }
  }

  if (dryRun) {
    console.log(`  ${file} → ${months.length} month(s): ${months.join(', ')}`);
  } else {
    console.log(`${file} → ${months.length} monthly file(s): ${months.join(', ')}`);
  }
}

if (!dryRun) {
  // Clean up old annual files
  if (args.cleanup) {
    for (const file of files) {
      const yearMatch = file.match(/^health_data_(\d{4})\.json$/);
      if (!yearMatch) continue;
      const year = yearMatch[1];
      if (targetYears && !targetYears.includes(year)) continue;
      const filePath = path.join(healthDir, file);
      fs.unlinkSync(filePath);
      console.log(`Removed ${file}`);
    }
  } else {
    console.log('\nRun with --cleanup to delete the original annual files.');
  }
}

function recordHasDateInMonth(record, sectionKey, targetMonth) {
  if (!record || typeof record !== 'object') return false;

  // healthMetrics: dates are inside record.data[].date
  if (sectionKey === 'metrics' && Array.isArray(record.data)) {
    return record.data.some((pt) => pt.date && pt.date.slice(0, 7) === targetMonth);
  }

  for (const field of ['start', 'end', 'date']) {
    if (typeof record[field] === 'string' && record[field].length >= 10) {
      return record[field].slice(0, 7) === targetMonth;
    }
  }
  return false;
}

function sortObjectSections(obj) {
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

function lastDayOfMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--cleanup') {
      parsed.cleanup = true;
    } else if (arg === '--year') {
      parsed.year = argv[i + 1];
      i++;
    }
  }
  return parsed;
}