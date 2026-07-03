import {createContext} from 'react';
import type {HealthData} from './transform';

export const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

// Historical months known to exist. The current year is extended at runtime.
export const MONTH_MAP: Record<number, number[]> = {
  2016: [8],
  2017: [6, 7, 8, 9, 10, 11, 12],
  2018: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  2019: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  2020: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  2021: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  2022: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  2023: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  2024: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  2025: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  2026: [1, 2, 3, 4, 5, 6],
};

function monthsThrough(month: number): number[] {
  return Array.from({length: month}, (_, index) => index + 1);
}

export function getAvailableMonthMap(now = new Date()): Record<number, number[]> {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const map: Record<number, number[]> = {...MONTH_MAP};
  map[year] = [...new Set([...(map[year] ?? []), ...monthsThrough(month)])].sort((a, b) => a - b);
  return map;
}

export const RANGE_DAYS: Record<string, number> = {'7d': 7, '30d': 30, '90d': 90, '1y': 365};
export const RANGE_LABELS: Record<string, string> = {'7d': '7天', '30d': '30天', '90d': '90天', '1y': '近1年'};

export type RecentRange = keyof typeof RANGE_DAYS;
export type TimeScope =
  | {mode: 'recent'; range: RecentRange}
  | {mode: 'year'; year: number}
  | {mode: 'all'};

export const EMPTY: HealthData = {
  steps:[], distance:[], exercise:[], energy_active:[], energy_basal:[],
  flights:[], stand_time:[], stand_hour:[], sleep:[], wrist_temp:[],
  rhr:[], hrv:[], walking_hr:[], resp_rate:[], spo2:[], weight:[],
  fat:[], bmi:[], lean:[], walk_speed:[], step_length:[], asym:[],
  double_supp:[], stair_up:[], stair_down:[], six_min_walk:[],
  audio_env:[], audio_hp:[], daylight:[], mindful:[], handwash:[],
  physical_effort:[], cardio_recovery:[], vo2:[], workouts:[],
  nah_daily:[], bns_daily:[], med_monthly:[], state_of_mind:[], hr_notifications:[],
  lastUpdated: null,
};

export type YearCtxType = {
  scope: TimeScope;
  setScope: (scope: TimeScope) => void;
  data: HealthData;
  axisDates: string[];
  loading: boolean;
  availableMonths: Record<number, number[]>;
  onDateSelect?: (date: string) => void;
  selectedDate?: string;
};

export const YearCtx = createContext<YearCtxType>({
  scope: {mode: 'recent', range: '7d'}, setScope: () => {}, data: EMPTY, axisDates: [], loading: true, availableMonths: {},
});
