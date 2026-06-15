import React, {type ReactNode} from 'react';
import {usePluginData} from '@docusaurus/useGlobalData';
import {FREQUENCIES, type Frequency, type StatusEntry} from './manifest';

type ResolvedStatus = {
  key: string;
  name: string;
  frequency: Frequency;
  status: '成功' | '成功（延迟）' | '异常';
  runTime: string;
  outputs: StatusEntry['outputs'];
};

function formatRunTime(value: string | undefined): string {
  if (!value) return '';
  return value.replace('T', ' ').replace(/\.\d+/, '').replace(/([+-]\d{2}:\d{2}|Z)$/, '');
}

function deriveStatus(
  timestamp: string | undefined,
  now: number,
  frequency: Frequency,
): ResolvedStatus['status'] {
  if (!timestamp) return '异常';
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return '异常';
  const delta = now - parsed;
  const {freshMs, staleMs} = FREQUENCIES[frequency].thresholds;
  if (delta < 0) return '成功';
  if (delta < freshMs) return '成功';
  if (delta < staleMs) return '成功（延迟）';
  return '异常';
}

export default function StatusTable(): ReactNode {
  const pluginData = usePluginData('status-data-plugin') as
    | {entries: StatusEntry[]; generatedAt: number}
    | undefined;
  const entries = pluginData?.entries ?? [];
  const now = pluginData?.generatedAt ?? Date.now();

  const rows: ResolvedStatus[] = entries
    .map((entry) => {
      const timeValue = (entry as StatusEntry & {runTime?: string}).runTime;
      return {
        key: entry.key,
        name: entry.name,
        frequency: entry.frequency,
        status: deriveStatus(timeValue, now, entry.frequency),
        runTime: formatRunTime(timeValue),
        outputs: entry.outputs,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

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
        {rows.map((row) => (
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
            <td>{row.status}</td>
            <td>{row.runTime}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
