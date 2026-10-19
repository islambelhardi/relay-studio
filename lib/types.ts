export type Stage = 'prd' | 'research' | 'draft' | 'verify' | 'polish';
export type RunStatus = 'queued' | 'running' | 'completed' | 'needs_review' | 'failed';
export type Scenario = 'success' | 'revision' | 'exhausted';
export type Provider = 'openai' | 'gemini';
export const providerLabels: Record<Provider, string> = { openai: 'OpenAI', gemini: 'Gemini' };
export interface Brief { audience: string; tone: string; targetWords: number }
export interface Source { id: string; title: string; url: string; excerpt: string; retrievedAt: string; searchEntryPoint?: string | null }
export interface Claim { text: string; sourceIds: string[]; verdict: 'supported' | 'contradicted' | 'insufficient_evidence'; explanation: string }
export interface Scores { accuracy: number; coverage: number; fidelity: number }
export interface Report { scores: Scores; claims: Claim[]; feedback: string[]; passed: boolean }
export interface Artifact { id: string; stage: Stage; version: number; markdown: string; title: string; createdAt: string; report?: Report; sources?: Source[]; approved?: boolean; inputArtifactId?: string }
export interface Attempt { id: string; stage: Stage; artifactId?: string; status: 'passed' | 'rejected' | 'error'; durationMs: number; inputTokens: number; outputTokens: number; searchCalls: number; costUsd: number | null; model: string; promptVersion: string; createdAt: string; error?: string }
export interface RunEvent { id: string; stage: Stage; kind: 'started' | 'completed' | 'rollback' | 'error'; message: string; createdAt: string }
export interface Run { provider?: Provider; id: string; documentId?: string; title: string; status: RunStatus; createdAt: string; updatedAt: string; brief: Brief; artifacts: Artifact[]; attempts: Attempt[]; events: RunEvent[]; sources: Source[]; finalArtifactId: string | null; approvedDraftId: string | null; currentStage: Stage; phase?: string; draftRevision?: number; polishRevision?: number; error?: string; simulated: boolean }
export const stages: { id: Stage; label: string; agent: string; description: string }[] = [
  { id: 'prd', label: 'Product brief', agent: 'Your starting point', description: 'Requirements & context' },
  { id: 'research', label: 'Research', agent: 'Researcher', description: 'Sources & product facts' },
  { id: 'draft', label: 'Draft', agent: 'Writer', description: 'A story takes shape' },
  { id: 'verify', label: 'Fact-check', agent: 'Fact-checker', description: 'Every claim, checked' },
  { id: 'polish', label: 'Polish', agent: 'Style polisher', description: 'Clear, on-brand writing' },
];
export const terminal = (status: RunStatus) => ['completed', 'failed', 'needs_review'].includes(status);
export const qualityScore = (s: Scores) => Math.round(s.accuracy * .4 + s.coverage * .35 + s.fidelity * .25);
export function aggregate(runs: Run[]) {
  const attempts = runs.flatMap(r => r.attempts);
  const checked = runs.filter(r => r.artifacts.some(a => a.stage === 'verify'));
  const reports = runs.flatMap(r => { const a = [...r.artifacts].reverse().find(a => a.report?.passed); return a?.report ? [a.report] : []; });
  return {
    total: runs.length, completed: runs.filter(r => r.status === 'completed').length,
    firstPass: checked.length ? Math.round(checked.filter(r => r.artifacts.find(a => a.stage === 'verify')?.report?.passed).length / checked.length * 100) : 0,
    revised: runs.filter(r => r.events.some(e => e.kind === 'rollback')).length,
    tokens: attempts.reduce((s, a) => s + a.inputTokens + a.outputTokens, 0),
    cost: attempts.some(a => a.costUsd === null) ? null : attempts.reduce((s, a) => s + (a.costUsd ?? 0), 0),
    quality: reports.length ? Math.round(reports.reduce((s, r) => s + qualityScore(r.scores), 0) / reports.length) : 0,
    latency: stages.filter(s => s.id !== 'prd').map(s => { const a = attempts.filter(a => a.stage === s.id); return { stage: s.id, label: s.label, ms: a.length ? Math.round(a.reduce((v, x) => v + x.durationMs, 0) / a.length) : 0 }; }),
  };
}
