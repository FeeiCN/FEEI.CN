import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath, pathToFileURL} from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const defaultHealthRoot = path.join(repoRoot, 'static', 'data', 'health');
const transformSourcePath = path.join(repoRoot, 'src', 'components', 'HealthCharts', 'transform.ts');

async function loadTransform() {
  const source = fs.readFileSync(transformSourcePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: transformSourcePath,
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  const module = await import(moduleUrl);
  return module.transform;
}

function healthMonthFiles(healthRoot) {
  return fs.readdirSync(healthRoot, {withFileTypes: true})
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .flatMap((yearEntry) => fs.readdirSync(path.join(healthRoot, yearEntry.name), {withFileTypes: true})
      .filter((entry) => entry.isFile() && /^(0[1-9]|1[0-2])\.json$/.test(entry.name))
      .map((entry) => ({
        key: `${yearEntry.name}-${entry.name.slice(0, 2)}`,
        file: path.join(healthRoot, yearEntry.name, entry.name),
      })))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function filterToNominalMonth(data, monthKey) {
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'lastUpdated') continue;
    result[key] = Array.isArray(value)
      ? value.filter((row) => Array.isArray(row) && String(row[0] || '').startsWith(monthKey))
      : [];
  }
  return {...result, lastUpdated: data.lastUpdated ?? null};
}

function latestTimestamp(values) {
  return values
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = Date.parse(left);
      const rightTime = Date.parse(right);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
      return String(left).localeCompare(String(right));
    })
    .at(-1) ?? null;
}

function mergeHealthData(months) {
  const result = {};
  const keys = [...new Set(months.flatMap((month) => Object.keys(month.data)))].filter((key) => key !== 'lastUpdated');
  for (const key of keys) {
    const seen = new Set();
    result[key] = months
      .flatMap((month) => month.data[key] || [])
      .filter((row) => {
        const signature = JSON.stringify(row);
        if (seen.has(signature)) return false;
        seen.add(signature);
        return true;
      })
      .sort((left, right) => String(left[0] || '').localeCompare(String(right[0] || '')));
  }
  return {
    ...result,
    lastUpdated: latestTimestamp(months.map((month) => month.data.lastUpdated)),
  };
}

export async function buildHealthChartHistory({healthRoot = defaultHealthRoot} = {}) {
  const resolvedRoot = path.resolve(healthRoot);
  const monthFiles = healthMonthFiles(resolvedRoot);
  if (!monthFiles.length) throw new Error(`No monthly health files found in ${resolvedRoot}`);

  const transform = await loadTransform();
  const months = monthFiles.map(({key, file}) => ({
    key,
    data: filterToNominalMonth(transform(JSON.parse(fs.readFileSync(file, 'utf8'))), key),
  }));
  const data = mergeHealthData(months);
  const dates = Object.entries(data)
    .filter(([key, value]) => key !== 'lastUpdated' && Array.isArray(value))
    .flatMap(([, value]) => value.map((row) => String(row[0] || '').slice(0, 10)))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const payload = {
    version: 1,
    generatedAt: data.lastUpdated,
    range: {start: dates[0] ?? null, end: dates.at(-1) ?? null},
    months: monthFiles.length,
    data,
  };
  const outputPath = path.join(resolvedRoot, 'history.json');
  const temporaryPath = `${outputPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload)}\n`);
  fs.renameSync(temporaryPath, outputPath);
  console.log(`Built health chart history from ${monthFiles.length} months: ${path.relative(repoRoot, outputPath)}`);
  return outputPath;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await buildHealthChartHistory({healthRoot: process.argv[2] || defaultHealthRoot});
}
