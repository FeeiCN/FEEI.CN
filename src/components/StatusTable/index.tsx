import React, {type ReactNode} from 'react';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {StatusEntry} from './manifest';

type ResolvedStatus = {
  key: string;
  name: string;
  status: '成功' | '成功（延迟）' | '异常';
  runTime: string;
  outputs: StatusEntry['outputs'];
};

const STATUS_THRESHOLDS = {
  freshMs: 24 * 60 * 60 * 1000,
  staleMs: 7 * 24 * 60 * 60 * 1000,
};

function formatRunTime(value: string | undefined): string {
  if (!value) return '';
  return value.replace('T', ' ').replace(/\.\d+/, '').replace(/([+-]\d{2}:\d{2}|Z)$/, '');
}

function deriveStatus(timestamp: string | undefined, now: number): ResolvedStatus['status'] {
  if (!timestamp) return '异常';
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return '异常';
  const delta = now - parsed;
  if (delta < 0) return '成功';
  if (delta < STATUS_THRESHOLDS.freshMs) return '成功';
  if (delta < STATUS_THRESHOLDS.staleMs) return '成功（延迟）';
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
        status: deriveStatus(timeValue, now),
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
          <th>运行状态</th>
          <th>运行时间</th>
          <th>输出页面</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td>{row.name}</td>
            <td>{row.status}</td>
            <td>{row.runTime}</td>
            <td>
              {row.outputs.map((output, index) => (
                <React.Fragment key={output.slug}>
                  {index > 0 && <br />}
                  <a href={output.slug}>{output.title}</a>
                </React.Fragment>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
