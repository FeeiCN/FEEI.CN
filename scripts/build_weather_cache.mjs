#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import createJiti from 'jiti';

const root = process.cwd();
const docsRoot = path.join(root, 'docs/05-吴飞飞/02-年度总结');
const outDir = path.resolve(process.argv[2] ?? path.join(root, 'static/data/weather'));
const locationsFile = path.join(outDir, 'locations.json');
const daysFile = path.join(outDir, 'days.json');
const jiti = createJiti(import.meta.url);
const {resolvePlace} = jiti(path.join(root, 'src/utils/locationResolver.ts'));

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
function splitLocations(value) {
  return [...new Set(String(value ?? '').split(/\s*→\s*/).map(x => x.trim()).filter(Boolean))].slice(0, 4);
}
function dateDistance(date) {
  return Math.floor((Date.now() - Date.parse(date + 'T00:00:00+08:00')) / 86400000);
}
async function fetchWeather(place, date) {
  const distance = dateDistance(date);
  const endpoints = [];
  if (distance <= 0) endpoints.push(['forecast','https://api.open-meteo.com/v1/forecast']);
  else {
    if (date >= '2022-01-01') endpoints.push(['historical-forecast','https://historical-forecast-api.open-meteo.com/v1/forecast']);
    endpoints.push(['archive','https://archive-api.open-meteo.com/v1/archive']);
  }
  for (const [source, endpoint] of endpoints) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set('latitude', String(place.latitude));
      url.searchParams.set('longitude', String(place.longitude));
      url.searchParams.set('start_date', date); url.searchParams.set('end_date', date);
      url.searchParams.set('daily','weather_code,temperature_2m_max,temperature_2m_min');
      url.searchParams.set('hourly', source === 'archive' ? 'weather_code,rain,snowfall' : 'weather_code,rain,showers,snowfall');
      url.searchParams.set('timezone','auto');
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      const max=data.daily?.temperature_2m_max?.[0], min=data.daily?.temperature_2m_min?.[0];
      const codes=data.hourly?.weather_code ?? [];
      if (typeof max !== 'number' || typeof min !== 'number' || (!codes.length && typeof data.daily?.weather_code?.[0] !== 'number')) continue;
      return {min,max,dailyCode:data.daily?.weather_code?.[0],hourlyCodes:codes,hourlyRain:data.hourly?.rain??[],hourlyShowers:data.hourly?.showers??[],hourlySnowfall:data.hourly?.snowfall??[],source};
    } catch {}
  }
  return null;
}

await fs.mkdir(outDir,{recursive:true});
// Existing cache should make subsequent deploys incremental: historical days are immutable.
const locations=await readJson(locationsFile,{});
const days=await readJson(daysFile,{});
const records=[];
for (const file of await walk(docsRoot)) {
  const text=await fs.readFile(file,'utf8');
  const front=text.startsWith('---') ? text.slice(3,text.indexOf('\n---',3)) : '';
  const slug=front.match(/^slug:\s*['"]?([^'"\n]+)['"]?\s*$/m)?.[1]?.trim() ?? '';
  const location=front.match(/^location:\s*['"]?([^'"\n]+)['"]?\s*$/m)?.[1]?.trim() ?? '';
  const match=slug.match(/^\/(\d{4}-\d{2}-\d{2})\/?$/);
  if (!match || !location) continue;
  records.push({date:match[1],locations:splitLocations(location)});
}
const controller=new AbortController();
const stats={locationHits:0,locationResolveAttempts:0,locationResolveFailures:0,weatherHits:0,weatherFetches:0,weatherFailures:0};
const unresolved=new Set();
for (const record of records) {
  for (const location of record.locations) {
    if (!locations[location]) {
      stats.locationResolveAttempts += 1;
      const started=Date.now();
      const resolved=await resolvePlace(location,controller.signal,(message)=>console.log(`[weather-resolver] location="${location}" ${message}`));
      if (resolved) locations[location]={...resolved,resolvedAt:new Date().toISOString()};
      else { stats.locationResolveFailures += 1; unresolved.add(location); }
      console.log(`[weather] resolve location="${location}" result=${resolved ? 'ok' : 'failed'} durationMs=${Date.now()-started}`);
    } else stats.locationHits += 1;
    const key=`${record.date}:${location}`;
    const distance=dateDistance(record.date);
    const cached=days[key];
    // Any past date is immutable once captured. Today's weather may still
    // change, but frequent deploys should not refresh it more than every 3h.
    if (cached && distance > 0) { stats.weatherHits += 1; continue; }
    if (cached && distance === 0 && Date.now() - (cached.cachedAt ?? 0) < 3 * 60 * 60 * 1000) { stats.weatherHits += 1; continue; }
    const place=locations[location];
    if (!place) continue;
    stats.weatherFetches += 1;
    const started=Date.now();
    const weather=await fetchWeather(place,record.date);
    if (weather) days[key]={location,...weather,cachedAt:Date.now()};
    else stats.weatherFailures += 1;
    console.log(`[weather] fetch key="${key}" result=${weather ? 'ok' : 'failed'} durationMs=${Date.now()-started}`);
  }
}
await fs.writeFile(locationsFile,JSON.stringify(locations,null,2)+'\n');
await fs.writeFile(daysFile,JSON.stringify(days,null,2)+'\n');
console.log(`[weather] locations=${Object.keys(locations).length} days=${Object.keys(days).length} stats=${JSON.stringify(stats)} unresolved=${JSON.stringify([...unresolved])}`);
