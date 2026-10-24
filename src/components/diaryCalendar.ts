const dayMilliseconds = 86400000;

export function calendarDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / dayMilliseconds;
}

export function daysInCalendarMonth(month: string): number {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

export function shiftCalendarMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function yearPosition(date: string) {
  const year = Number(date.slice(0, 4));
  const total = calendarDay(`${year + 1}-01-01`) - calendarDay(`${year}-01-01`);
  const day = calendarDay(date) - calendarDay(`${year}-01-01`) + 1;
  return {year, total, day, percent: day / total * 100};
}

export function calendarYearPosition(year: number, today: string) {
  const total = calendarDay(`${year + 1}-01-01`) - calendarDay(`${year}-01-01`);
  const day = Math.max(0, Math.min(total, calendarDay(today) - calendarDay(`${year}-01-01`) + 1));
  return {year, total, day, percent: day / total * 100};
}

export function adjacentRecordedMonths(months: string[], month: string) {
  const sorted = [...new Set(months)].sort();
  return {previous: sorted.filter((value) => value < month).at(-1), next: sorted.find((value) => value > month)};
}

export function lifePosition(date: string, birthDate: string, referenceYears: number) {
  const birthYear = Number(birthDate.slice(0, 4));
  const birthdayIn = (year: number) => {
    const month = birthDate.slice(5, 7);
    const day = Math.min(Number(birthDate.slice(8)), daysInCalendarMonth(`${year}-${month}`));
    return `${year}-${month}-${String(day).padStart(2, '0')}`;
  };
  let years = Number(date.slice(0, 4)) - birthYear;
  if (date < birthdayIn(birthYear + years)) years--;
  if (years < 0) return {years: 0, days: 0, age: 0, percent: 0};
  const anniversary = calendarDay(birthdayIn(birthYear + years));
  const nextAnniversary = calendarDay(birthdayIn(birthYear + years + 1));
  const days = calendarDay(date) - anniversary;
  const age = years + days / (nextAnniversary - anniversary);
  return {years, days, age, percent: Math.max(0, Math.min(100, age / referenceYears * 100))};
}
