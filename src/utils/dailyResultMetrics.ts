export type SleepScoreSnapshot = {date: string; score: number};
export type DailyPnlAccount = {account: string; value: number; exact: boolean};
export type DailyPnlSnapshot = {date: string; total: number; exact: boolean; accounts: DailyPnlAccount[]};

type SleepScoreIndex = {scores?: Array<[string, number, ...number[]]>};
type PnlMonth = {
  account?: string;
  values?: Record<string, {value?: number; exact?: boolean}>;
};

let sleepScoresPromise: Promise<Map<string, number>> | null = null;
const pnlCache = new Map<string, Promise<PnlMonth | null>>();
const PNL_ACCOUNTS = ['alipay', 'feeicn', 'feeicn2', 'caitong'] as const;

export function loadSleepScoreSnapshot(date: string): Promise<SleepScoreSnapshot | null> {
  if (!sleepScoresPromise) {
    sleepScoresPromise = fetch('/data/sleep-score/index.json', {cache: 'no-store'})
      .then(async (response) => {
        if (!response.ok) return new Map<string, number>();
        const payload = await response.json() as SleepScoreIndex;
        return new Map(
          (payload.scores ?? [])
            .filter((row) => typeof row?.[0] === 'string' && Number.isFinite(row?.[1]))
            .map((row) => [row[0], row[1]]),
        );
      })
      .catch(() => new Map<string, number>());
  }
  return sleepScoresPromise.then((scores) => {
    const score = scores.get(date);
    return typeof score === 'number' ? {date, score} : null;
  });
}

function loadPnlMonth(account: string, year: string, month: string): Promise<PnlMonth | null> {
  const key = `${account}:${year}-${month}`;
  const cached = pnlCache.get(key);
  if (cached) return cached;
  const request = fetch(
    `/data/manual/finance/daily-pnl/${account}/${year}/${month}.json`,
    {cache: 'force-cache'},
  )
    .then(async (response) => response.ok ? await response.json() as PnlMonth : null)
    .catch(() => null);
  pnlCache.set(key, request);
  return request;
}

export async function loadDailyPnlSnapshot(date: string): Promise<DailyPnlSnapshot | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month] = date.split('-');
  const payloads = await Promise.all(PNL_ACCOUNTS.map((account) => loadPnlMonth(account, year, month)));

  const accounts = payloads.flatMap((payload, index) => {
    const point = payload?.values?.[date];
    return typeof point?.value === 'number'
      ? [{
          account: payload?.account || PNL_ACCOUNTS[index],
          value: point.value,
          exact: point.exact !== false,
        }]
      : [];
  });

  // Never present a partial set of accounts as total investment P&L.
  if (accounts.length !== PNL_ACCOUNTS.length) return null;

  return {
    date,
    total: Number(accounts.reduce((sum, item) => sum + item.value, 0).toFixed(2)),
    exact: accounts.every((item) => item.exact),
    accounts,
  };
}
