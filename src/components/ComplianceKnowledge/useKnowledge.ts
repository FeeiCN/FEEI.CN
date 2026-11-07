import {useEffect, useMemo, useState} from 'react';
import {createIndex, type Evidence, type GraphPart, type KnowledgeGraph, type QueryMode} from './model';

async function readData<T>(url: string, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {signal, cache: 'no-cache'});
  } catch {
    throw new Error('数据暂时无法读取，请检查连接后重试');
  }
  if (!response.ok) throw new Error(`数据暂时无法读取（HTTP ${response.status}）`);
  return response.json() as Promise<T>;
}

export function useKnowledge(base: string, selected: string, mode: QueryMode) {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [clauses, setClauses] = useState<GraphPart | null>(null);
  const [evidence, setEvidence] = useState<{sourceDigest: string; evidence: Evidence[]} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const needsClauses = mode === 'clauses' || selected.startsWith('clause:');
  const needsEvidence = Boolean(selected);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    readData<KnowledgeGraph>(`${base}graph.json`, controller.signal).then(data => {
      if (data.schemaVersion !== 1 || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
        throw new Error('知识数据格式不匹配，请更新数据后重试');
      }
      setGraph(data);
    }).catch((reason: Error) => {if (!controller.signal.aborted) setError(reason.message);});
    return () => controller.abort();
  }, [base, retry]);

  useEffect(() => {
    if (!graph || (!needsClauses && !needsEvidence)) return;
    const controller = new AbortController();
    const tasks: Promise<void>[] = [];
    const checkVersion = (digest: string) => {
      if (digest !== graph.sourceDigest) throw new Error('文档与证据的数据版本不一致，请刷新重试');
    };
    if (needsClauses && clauses?.sourceDigest !== graph.sourceDigest) {
      tasks.push(readData<GraphPart>(`${base}clauses.json?v=${graph.sourceDigest}`, controller.signal).then(data => {
        checkVersion(data.sourceDigest);
        setClauses(data);
      }));
    }
    if (needsEvidence && evidence?.sourceDigest !== graph.sourceDigest) {
      tasks.push(readData<{sourceDigest: string; evidence: Evidence[]}>(`${base}evidence.json?v=${graph.sourceDigest}`, controller.signal).then(data => {
        checkVersion(data.sourceDigest);
        setEvidence(data);
      }));
    }
    Promise.all(tasks).catch((reason: Error) => {if (!controller.signal.aborted) setError(reason.message);});
    return () => controller.abort();
  }, [base, graph, needsClauses, needsEvidence, retry, clauses, evidence]);

  const parts = useMemo(() => graph ? [graph, ...(clauses?.sourceDigest === graph.sourceDigest ? [clauses] : [])] : [], [graph, clauses]);
  const index = useMemo(() => createIndex(parts), [parts]);
  const evidenceIndex = useMemo(() => new Map((evidence?.sourceDigest === graph?.sourceDigest ? evidence?.evidence ?? [] : []).map(item => [item.id, item])), [evidence, graph?.sourceDigest]);
  return {graph, index, evidenceIndex, evidenceLoading: needsEvidence && evidence?.sourceDigest !== graph?.sourceDigest,
    loading: !graph || (needsClauses && clauses?.sourceDigest !== graph.sourceDigest), error,
    retry: () => {setError(null); setClauses(null); setEvidence(null); setRetry(value => value + 1);}};
}

