import React, {type ReactNode} from 'react';
import {useEffect, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {FREQUENCIES, STATUS_MANIFEST, type Frequency, type StatusEntry} from './manifest';

type RowState =
  | {kind: 'loading'}
  | {kind: 'resolved'; runTime: string | undefined}
  | {kind: 'error'; reason: string};

type Row = {
  key: string;
  name: string;
  frequency: Frequency;
  outputs: StatusEntry['outputs'];
  state: RowState;
};

function formatRunTime(value: string | undefined): string {
  if (!value) return '—';
  return value.replace('T', ' ').replace(/\.\d+/, '').replace(/([+-]\d{2}:\d{2}|Z)$/, '');
}

function deriveStatus(
  runTime: string | undefined,
  now: number,
  frequency: Frequency,
): '成功' | '成功（延迟）' | '异常' {
  if (!runTime) return '异常';
  const parsed = Date.parse(runTime);
  if (Number.isNaN(parsed)) return '异常';
  const delta = now - parsed;
  const {freshMs, staleMs} = FREQUENCIES[frequency].thresholds;
  if (delta < 0) return '成功';
  if (delta < freshMs) return '成功';
  if (delta < staleMs) return '成功（延迟）';
  return '异常';
}

function pickLatest(values: string[]): string | undefined {
  let latest: string | undefined;
  let latestTs = -Infinity;
  for (const value of values) {
    const ts = Date.parse(value);
    if (!Number.isNaN(ts) && ts > latestTs) {
      latestTs = ts;
      latest = value;
    }
  }
  return latest;
}

// 单源拉取：失败返回 error，不抛，避免一处 404 拖垮整行。
async function fetchOne(
  url: string,
  timeField: StatusEntry['timeField'],
): Promise<{ts: string | undefined; error: string | undefined}> {
  try {
    // manifest 的 url 是相对于 siteDir 的文件系统路径（带 static/ 前缀）；
    // Docusaurus 把 static/ 下的文件映射到 URL 根，因此运行时要去掉 static/ 前缀。
    const runtimeUrl = `/${url.replace(/^static\//, '')}`;
    const res = await fetch(runtimeUrl, {cache: 'no-store'});
    if (!res.ok) {
      return {ts: undefined, error: `HTTP ${res.status}`};
    }
    const json = (await res.json()) as Record<string, unknown>;
    const raw = json[timeField];
    if (typeof raw !== 'string') {
      return {ts: undefined, error: '字段缺失'};
    }
    if (Number.isNaN(Date.parse(raw))) {
      return {ts: undefined, error: '时间解析失败'};
    }
    return {ts: raw, error: undefined};
  } catch (err) {
    return {ts: undefined, error: err instanceof Error ? err.message : '网络错误'};
  }
}

function StatusTableInner(): ReactNode {
  const [rows, setRows] = useState<Row[]>(() =>
    STATUS_MANIFEST.map((entry) => ({
      key: entry.key,
      name: entry.name,
      frequency: entry.frequency,
      outputs: entry.outputs,
      state: {kind: 'loading'},
    })),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tasks = STATUS_MANIFEST.flatMap((entry) =>
        entry.getSources().map(async (url) => ({
          key: entry.key,
          ...(await fetchOne(url, entry.timeField)),
        })),
      );
      const results = await Promise.all(tasks);
      if (cancelled) return;

      const byKey = new Map<string, {ts: string[]; error: string | undefined}>();
      for (const {key, ts, error} of results) {
        if (!byKey.has(key)) {
          byKey.set(key, {ts: [], error: undefined});
        }
        const bucket = byKey.get(key)!;
        if (ts) bucket.ts.push(ts);
        if (error && !bucket.error) bucket.error = error;
      }

      setRows((prev) =>
        prev.map((row) => {
          const bucket = byKey.get(row.key);
          if (!bucket) return row;
          const latest = pickLatest(bucket.ts);
          if (latest) return {...row, state: {kind: 'resolved', runTime: latest}};
          return {...row, state: {kind: 'error', reason: bucket.error ?? '无数据'}};
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const now = Date.now();
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

  return (
    <table>
      <thead>
        <tr>
          <th>任务</th>
          <th>运行频率</th>
          <th>运行状态</th>
          <th>运行时间</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => {
          let statusCell: string;
          let timeCell: string;
          if (row.state.kind === 'loading') {
            statusCell = '加载中';
            timeCell = '—';
          } else if (row.state.kind === 'error') {
            statusCell = '异常';
            timeCell = '—';
          } else {
            statusCell = deriveStatus(row.state.runTime, now, row.frequency);
            timeCell = formatRunTime(row.state.runTime);
          }
          return (
            <tr key={row.key}>
              <td>
                <strong>{row.name}</strong>
                {row.outputs.map((output) => (
                  <React.Fragment key={output.slug}>
                    <br />
                    <a href={output.slug}>{output.title}</a>
                  </React.Fragment>
                ))}
              </td>
              <td>{FREQUENCIES[row.frequency].label}</td>
              <td>{statusCell}</td>
              <td>{timeCell}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function StatusTable(): ReactNode {
  // SSG 阶段不渲染真实数据，hydration 后再填充；fallback 占位防止布局抖动。
  return (
    <BrowserOnly fallback={<div style={{minHeight: 240}} />}>
      {() => <StatusTableInner />}
    </BrowserOnly>
  );
}