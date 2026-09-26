export const WEATHER_CODE_LABELS: Record<number, string> = {
  0: '晴',
  1: '晴间多云',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '强毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '小阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '小阵雪',
  86: '强阵雪',
  95: '雷雨',
  96: '雷雨伴冰雹',
  99: '强雷雨伴冰雹',
};

export type RawWeatherDay = {
  location: string;
  min: number;
  max: number;
  dailyCode?: number;
  hourlyCodes: number[];
  hourlyRain: number[];
  hourlyShowers: number[];
  hourlySnowfall: number[];
  source: 'forecast' | 'historical-forecast' | 'archive';
};

export type WeatherSummary = {
  location: string;
  label: string;
  min: number;
  max: number;
  rain: number;
  snowfall: number;
  source: RawWeatherDay['source'];
};

export function getWeatherCodeLabel(code: unknown): string {
  const value = Number(code);
  if (!Number.isFinite(value)) return '天气';
  return WEATHER_CODE_LABELS[value] || `天气代码 ${value}`;
}

export function rainIntensity(rainfall: number): string | null {
  if (!Number.isFinite(rainfall) || rainfall < 0.1) return null;
  if (rainfall < 10) return '小雨';
  if (rainfall < 25) return '中雨';
  if (rainfall < 50) return '大雨';
  if (rainfall < 100) return '暴雨';
  if (rainfall < 250) return '大暴雨';
  return '特大暴雨';
}

function family(code: number): 'clear' | 'cloudy' | 'overcast' | 'fog' | 'rain' | 'snow' | 'thunder' {
  if (code >= 95) return 'thunder';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code === 3) return 'overcast';
  if (code === 2) return 'cloudy';
  return 'clear';
}

function mostCommonCode(codes: number[]): number | undefined {
  if (codes.length === 0) return undefined;
  const counts = new Map<number, number>();
  codes.forEach((code) => counts.set(code, (counts.get(code) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

export function summarizeWeather(raw: RawWeatherDay): WeatherSummary {
  const codes = raw.hourlyCodes.filter(Number.isFinite);
  const rainByHour = codes.map((_, index) =>
    (raw.hourlyRain[index] ?? 0) + (raw.hourlyShowers[index] ?? 0),
  );
  const totalRain = sum(rainByHour);
  const totalSnowfall = sum(raw.hourlySnowfall);
  const rainHours = rainByHour.filter((value, index) =>
    value >= 0.1 || family(codes[index]) === 'rain' || family(codes[index]) === 'thunder',
  ).length;
  const snowHours = codes.filter((code, index) =>
    family(code) === 'snow' || (raw.hourlySnowfall[index] ?? 0) > 0,
  ).length;
  const thunderHours = codes.filter((code) => family(code) === 'thunder').length;
  const maxHourlyRain = rainByHour.length > 0 ? Math.max(...rainByHour) : 0;

  const dryCodes = codes.filter((code) => !['rain', 'snow', 'thunder'].includes(family(code)));
  const dominantCode = mostCommonCode(dryCodes.length > 0 ? dryCodes : codes) ?? raw.dailyCode;
  const dominantLabel = dominantCode === undefined ? '天气' : getWeatherCodeLabel(dominantCode);
  const rainLabel = rainIntensity(totalRain);
  const snowCode = mostCommonCode(codes.filter((code) => family(code) === 'snow'));
  const snowLabel = snowCode === undefined ? '雪' : getWeatherCodeLabel(snowCode);

  let label = dominantLabel;

  if (thunderHours >= 3 || (thunderHours > 0 && totalRain >= 25)) {
    label = rainLabel && totalRain >= 10 ? `雷雨 · ${rainLabel}` : '雷雨';
  } else if (snowHours >= 6 || (codes.length > 0 && snowHours >= Math.ceil(codes.length / 3))) {
    label = snowLabel;
  } else if (thunderHours > 0) {
    label = `${dominantLabel} · 短时雷雨`;
  } else if (rainLabel) {
    if (rainHours >= 6 || totalRain >= 25 || (codes.length > 0 && rainHours >= Math.ceil(codes.length / 3))) {
      label = rainLabel;
    } else {
      label = maxHourlyRain >= 16
        ? `${dominantLabel} · 短时强降雨`
        : `${dominantLabel} · 短时有雨`;
    }
  } else if (snowHours > 0) {
    label = `${dominantLabel} · 短时${snowLabel}`;
  }

  return {
    location: raw.location,
    label,
    min: Math.round(raw.min),
    max: Math.round(raw.max),
    rain: totalRain,
    snowfall: totalSnowfall,
    source: raw.source,
  };
}
