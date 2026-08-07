import { hanaFetch } from '../../api';
import { refreshSettingsConfigSnapshot } from '../../helpers';

export type DreamRunReport = {
  runId: string;
  status: 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string;
  beforeChars: number;
  afterChars: number;
  mergedCount: number;
  forgottenCount: number;
  reviewedCount: number;
  model: string;
  revisionId: string | null;
  error?: string;
};

export type DreamStatus = {
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  runId: string | null;
  startedAt: string | null;
  lastRun: DreamRunReport | null;
};

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data?.error) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

export async function loadDreamStatus(agentId: string, signal?: AbortSignal) {
  const response = await hanaFetch(
    `/api/memories/dream/status?agentId=${encodeURIComponent(agentId)}`,
    { signal, timeout: 10_000 },
  );
  return responseJson<DreamStatus>(response);
}

export async function startDream(agentId: string) {
  const response = await hanaFetch(
    `/api/memories/dream/runs?agentId=${encodeURIComponent(agentId)}`,
    { method: 'POST', timeout: 10_000 },
  );
  return responseJson<DreamStatus>(response);
}

export async function restoreDream(agentId: string, revisionId: string) {
  const response = await hanaFetch(
    `/api/memories/dream/revisions/${encodeURIComponent(revisionId)}/restore?agentId=${encodeURIComponent(agentId)}`,
    { method: 'POST', timeout: 30_000 },
  );
  return responseJson<{ ok: true }>(response);
}

export async function saveDreamAutoEnabled(agentId: string, enabled: boolean) {
  const response = await hanaFetch(`/api/agents/${encodeURIComponent(agentId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memory: { dream: { auto_enabled: enabled } } }),
  });
  await responseJson<{ ok: true }>(response);
  await refreshSettingsConfigSnapshot();
}
