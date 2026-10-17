import { describe, expect, it } from 'vitest';
import { demoAt, makeDemo } from '../lib/demo';
import { aggregate, qualityScore } from '../lib/types';
import { briefSchema, runSchema } from '../lib/validation';
import { exportMarkdown } from '../lib/export';
describe('demo lifecycle and metrics', () => {
  it('only exposes a final article after the complete playback', () => { const run = makeDemo('success'); expect(run.finalArtifactId).not.toBeNull(); expect(demoAt(run,3).finalArtifactId).toBeNull(); expect(demoAt(run,3).status).toBe('running'); });
  it('recovers a rejected draft without deleting it', () => { const run = makeDemo('revision'); expect(run.artifacts.filter(a => a.stage === 'draft')).toHaveLength(2); expect(run.events.filter(e => e.kind === 'rollback')).toHaveLength(1); expect(run.status).toBe('completed'); });
  it('halts after initial draft plus two revisions', () => { const run = makeDemo('exhausted'); expect(run.artifacts.filter(a => a.stage === 'draft')).toHaveLength(3); expect(run.status).toBe('needs_review'); expect(run.finalArtifactId).toBeNull(); expect(run.artifacts.some(a => a.stage === 'polish')).toBe(false); });
  it('includes rejected attempts in cost and tokens and computes first-pass rate', () => { const runs = [makeDemo('success'),makeDemo('revision'),makeDemo('exhausted')]; const metrics = aggregate(runs); expect(metrics.completed).toBe(2); expect(metrics.firstPass).toBe(33); expect(metrics.revised).toBe(2); expect(metrics.tokens).toBe(runs.flatMap(r => r.attempts).reduce((s,a) => s+a.inputTokens+a.outputTokens,0)); expect(metrics.cost).toBeGreaterThan(0); });
  it('does not report unknown pricing as free', () => { const run = makeDemo(); run.attempts[0].costUsd = null; expect(aggregate([run]).cost).toBeNull(); });
  it('uses the specified rubric weights', () => expect(qualityScore({accuracy:90,coverage:100,fidelity:80})).toBe(91));
  it('keeps source anchors usable in exported articles without including the private PRD', () => { const run = makeDemo('success'); const article = run.artifacts.find(a => a.id === run.finalArtifactId)!; const result = exportMarkdown(article,run.sources); expect(result).toContain('### Source prd'); expect(result).toContain('### Source s1'); expect(result).not.toContain('### Source s2'); expect(result).not.toContain(run.sources[0].excerpt); });
});
describe('input contracts', () => {
  it('rejects invalid lengths and excessive word targets', () => { expect(briefSchema.safeParse({audience:'',tone:'Professional',targetWords:1000}).success).toBe(false); expect(briefSchema.safeParse({audience:'Teams',tone:'Professional',targetWords:3001}).success).toBe(false); });
  it('requires an owned document identifier before live run creation', () => { expect(runSchema.safeParse({documentId:'../other-user',title:'Test',brief:{audience:'Teams',tone:'Professional',targetWords:1000}}).success).toBe(false); });
});
