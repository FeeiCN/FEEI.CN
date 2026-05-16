import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ICONS_DIR = path.join(ROOT, 'src/components/ItsHoverIcon/icons');

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function main() {
  const html = await fetchText('https://www.itshover.com/icons');
  const scriptPaths = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js[^"]*)"/g)].map(
    (match) => match[1],
  );

  const siteSlugs = new Set();
  for (const scriptPath of scriptPaths) {
    const script = await fetchText(`https://www.itshover.com${scriptPath}`);
    for (const match of script.matchAll(/[a-z0-9-]+-icon/g)) {
      siteSlugs.add(match[0]);
    }
  }

  const localSlugs = new Set(
    readdirSync(ICONS_DIR)
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => file.replace(/\.tsx$/, '')),
  );

  const missing = [...siteSlugs].filter((slug) => !localSlugs.has(slug)).sort();

  console.log(`Found ${siteSlugs.size} site icons.`);
  console.log(`Local icons: ${localSlugs.size}. Missing files: ${missing.length}.`);

  mkdirSync(ICONS_DIR, { recursive: true });

  for (const slug of missing) {
    const registry = await fetchJson(`https://www.itshover.com/r/${slug}.json`);
    if (!registry) {
      console.warn(`Skipped missing registry entry for ${slug}`);
      continue;
    }
    const iconFile = registry.files?.find(
      (file) => file.type === 'registry:ui' && file.path.endsWith('.tsx'),
    );

    if (!iconFile) {
      throw new Error(`No TSX file found in registry entry for ${slug}`);
    }

    const targetPath = path.join(ICONS_DIR, `${slug}.tsx`);
    writeFileSync(targetPath, iconFile.content, 'utf8');
    console.log(`Wrote ${path.relative(ROOT, targetPath)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
