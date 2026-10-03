export type ResolvedPlace = {
  latitude: number;
  longitude: number;
  canonicalName?: string;
  countryCode?: string;
  admin1?: string;
};

export type LocationAlias = {
  names: string[];
  countryCode?: string;
};

export type GeoNamesResult = {
  geonameId?: number;
  name?: string;
  lat?: string;
  lng?: string;
  countryCode?: string;
  adminName1?: string;
  adminName2?: string;
  featureClass?: string;
  featureCode?: string;
  population?: number;
  alternateNames?: Array<{name?: string; lang?: string}>;
};

export type NominatimResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  type?: string;
  addresstype?: string;
  importance?: number;
  address?: {
    country_code?: string;
    state?: string;
    province?: string;
    county?: string;
    city?: string;
    town?: string;
  };
};

export type OpenMeteoGeocodingResult = {
  latitude: number;
  longitude: number;
  name?: string;
  country_code?: string;
  admin1?: string;
  population?: number;
  feature_code?: string;
};

type OpenMeteoGeocodingResponse = {results?: OpenMeteoGeocodingResult[]};
type GeoNamesResponse = {geonames?: GeoNamesResult[]};

const GEONAMES_USERNAME = 'feei';

export type ResolverDiagnostic = (message: string) => void;

export const locationAliases: Record<string, LocationAlias> = {
  '千岛湖': {names: ['Qiandaohu'], countryCode: 'CN'},
  '札幌': {names: ['札幌市', 'Sapporo'], countryCode: 'JP'},
  '千叶': {names: ['千葉市', 'Chiba'], countryCode: 'JP'},
  '千葉': {names: ['千葉市', 'Chiba'], countryCode: 'JP'},
  '横滨': {names: ['横浜市', 'Yokohama'], countryCode: 'JP'},
  '冲绳': {names: ['沖縄', 'Okinawa'], countryCode: 'JP'},
  '函馆': {names: ['函館市', 'Hakodate'], countryCode: 'JP'},
  '蕲春': {names: ['Qichun']},
};

export function geocodingNames(location: string): string[] {
  return [...new Set([...(locationAliases[location]?.names ?? []), location])];
}

export function locationCandidates(value: string): string[] {
  const hierarchy = value.split(/\s*·\s*/).map(x => x.trim()).filter(Boolean);
  const candidates: string[] = [];
  for (let index = hierarchy.length - 1; index >= 0; index -= 1) {
    candidates.push(...hierarchy[index].split(/\s*(?:\/|、)\s*/).map(x => x.trim()).filter(Boolean));
  }
  candidates.push(value);
  return [...new Set(candidates)];
}

export function normalizePlaceName(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
    .replace(/[\s·・.,，。'’"“”()（）\-_]/g, '')
    .replace(/(?:市|县|縣|区|區|町|村|州|省|府)$/u, '');
}

function nameScore(query: string, names: Array<string | undefined>): number {
  const q = normalizePlaceName(query);
  let best = 0;
  for (const name of names) {
    if (!name) continue;
    const n = normalizePlaceName(name);
    if (n === q) best = Math.max(best, 100);
    else if (n.includes(q) || q.includes(n)) best = Math.max(best, 65);
  }
  return best;
}

function featureScore(featureCode?: string, type?: string): number {
  if (featureCode?.startsWith('PPL')) return 20;
  if (featureCode?.startsWith('ADM')) return 18;
  return ['city', 'town', 'village', 'county', 'administrative'].includes(type ?? '') ? 15 : 0;
}

function populationScore(population?: number): number {
  return population && population > 0 ? Math.min(12, Math.log10(population + 1) * 2) : 0;
}

function aliasCountryBonus(location: string, countryCode?: string): number {
  const expected = locationAliases[location]?.countryCode;
  return expected && countryCode?.toUpperCase() === expected ? 25 : 0;
}

function geoNamesAlternateNames(item: GeoNamesResult): string[] {
  return (item.alternateNames ?? []).map(x => x.name).filter((x): x is string => Boolean(x));
}

export function chooseGeoNamesResult(location: string, query: string, results: GeoNamesResult[]): GeoNamesResult | undefined {
  const score = (x: GeoNamesResult) => nameScore(query, [x.name, ...geoNamesAlternateNames(x)])
    + featureScore(x.featureCode) + populationScore(x.population) + aliasCountryBonus(location, x.countryCode);
  return [...results].sort((a, b) => score(b) - score(a))[0];
}

export function chooseNominatimResult(location: string, query: string, results: NominatimResult[]): NominatimResult | undefined {
  const score = (x: NominatimResult) => nameScore(query, [x.name, x.display_name])
    + featureScore(undefined, x.addresstype ?? x.type) + (x.importance ?? 0) * 10
    + aliasCountryBonus(location, x.address?.country_code);
  return [...results].sort((a, b) => score(b) - score(a))[0];
}

export function chooseOpenMeteoResult(location: string, query: string, results: OpenMeteoGeocodingResult[]): OpenMeteoGeocodingResult | undefined {
  const score = (x: OpenMeteoGeocodingResult) => nameScore(query, [x.name])
    + featureScore(x.feature_code) + populationScore(x.population) + aliasCountryBonus(location, x.country_code);
  return [...results].sort((a, b) => score(b) - score(a))[0];
}

async function resolveWithGeoNames(location: string, signal: AbortSignal, diagnostic?: ResolverDiagnostic): Promise<ResolvedPlace | null> {
  for (const query of geocodingNames(location)) {
    const url = new URL('https://secure.geonames.org/searchJSON');
    url.searchParams.set('q', query); url.searchParams.set('maxRows', '10'); url.searchParams.set('username', GEONAMES_USERNAME);
    const response = await fetch(url, {signal});
    if (!response.ok) { diagnostic?.(`GeoNames query="${query}" status=${response.status}`); continue; }
    const result = chooseGeoNamesResult(location, query, ((await response.json()) as GeoNamesResponse).geonames ?? []);
    if (!result) continue;
    const latitude = Number(result.lat), longitude = Number(result.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    return {latitude, longitude, canonicalName: result.name, countryCode: result.countryCode, admin1: result.adminName1};
  }
  return null;
}

async function resolveWithNominatim(location: string, signal: AbortSignal, diagnostic?: ResolverDiagnostic): Promise<ResolvedPlace | null> {
  for (const query of geocodingNames(location)) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query); url.searchParams.set('format', 'jsonv2'); url.searchParams.set('limit', '8');
    url.searchParams.set('addressdetails', '1'); url.searchParams.set('accept-language', 'zh,en');
    const response = await fetch(url, {signal, headers: {'Accept': 'application/json'}});
    if (!response.ok) { diagnostic?.(`Nominatim query="${query}" status=${response.status}`); continue; }
    const result = chooseNominatimResult(location, query, (await response.json()) as NominatimResult[]);
    if (!result) continue;
    const latitude = Number(result.lat), longitude = Number(result.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    return {latitude, longitude, canonicalName: result.name ?? result.display_name, countryCode: result.address?.country_code?.toUpperCase(), admin1: result.address?.state ?? result.address?.province};
  }
  return null;
}

async function resolveWithOpenMeteo(location: string, signal: AbortSignal, diagnostic?: ResolverDiagnostic): Promise<ResolvedPlace | null> {
  for (const query of geocodingNames(location)) for (const language of ['zh', 'ja', 'en']) {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', query); url.searchParams.set('count', '8'); url.searchParams.set('language', language); url.searchParams.set('format', 'json');
    const response = await fetch(url, {signal});
    if (!response.ok) { diagnostic?.(`GeoNames query="${query}" status=${response.status}`); continue; }
    const result = chooseOpenMeteoResult(location, query, ((await response.json()) as OpenMeteoGeocodingResponse).results ?? []);
    if (result) return {latitude: result.latitude, longitude: result.longitude, canonicalName: result.name, countryCode: result.country_code, admin1: result.admin1};
  }
  return null;
}

export async function resolvePlace(location: string, signal: AbortSignal, diagnostic?: ResolverDiagnostic): Promise<ResolvedPlace | null> {
  for (const candidate of locationCandidates(location)) {
    for (const provider of [resolveWithGeoNames, resolveWithNominatim, resolveWithOpenMeteo]) {
      try {
        const resolved = await provider(candidate, signal, diagnostic);
        if (resolved) return resolved;
      } catch (error) {
        if (signal.aborted) throw error;
        diagnostic?.(`${provider.name} candidate="${candidate}" error=${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return null;
}
