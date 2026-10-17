import { Artifact, Brief, Report, Run, Scenario, Source, Stage } from './types';

export const samplePrd = `# Relay: a calmer way to hand off content\n\nStatus: planned private beta.\nAudience: content operations leads and editorial teams.\n\nProblem: Editorial handoffs are scattered across messages, documents, and spreadsheets. Teams lose context when a draft moves from a writer to a reviewer.\n\nRequirements:\n- A shared content queue with a named owner for each article.\n- Review checkpoints for editorial and subject-matter approval.\n- A handoff summary that carries the brief, open questions, and source links.\n- Version history so teams can return to an earlier draft.\n\nThe initial beta is invite-only. No public launch date or price has been set. Performance improvements have not been measured.\n\nBlog goal: Explain how thoughtful handoffs help content teams keep context. Introduce the planned beta without claiming it is generally available. End with an invitation to join the waitlist.`;
const sources: Source[] = [
  { id: 'prd', title: 'Relay product requirements', url: '', excerpt: 'Planned private beta. Shared queue, named owners, review checkpoints, handoff summaries, and version history. No measured performance gains.', retrievedAt: '2026-10-17T10:00:00Z' },
  { id: 's1', title: 'GitLab handbook · Asynchronous communication', url: 'https://handbook.gitlab.com/handbook/company/culture/all-remote/asynchronous/', excerpt: 'Demo reference: documentation and written context support asynchronous collaboration. This fixture is illustrative, not a live retrieval.', retrievedAt: '2026-10-17T10:00:08Z' },
  { id: 's2', title: 'Google technical writing · Clear sentences', url: 'https://developers.google.com/tech-writing/one/clear-sentences', excerpt: 'Demo reference: clear subjects and verbs make technical writing easier to follow. This fixture is illustrative, not a live retrieval.', retrievedAt: '2026-10-17T10:00:12Z' },
];
const polished = `# Good content deserves a better handoff\n\nA draft can be ready while the next person is still missing the context. Which version needs review? What changed? Is that product claim confirmed—or still an open question?\n\nFor content teams, the handoff is part of the work. Relay’s planned private beta is designed to make that transition clearer. [Product brief](#source-prd)\n\n## Carry the context forward\n\nRelay brings a shared content queue, named article owners, and review checkpoints into the same workflow. Each handoff includes the brief, open questions, and source links, so the next reviewer can pick up the thread. These are requirements for the planned beta, rather than promises about a product already available. [Product brief](#source-prd)\n\nWritten context is especially useful when teammates work at different times. The GitLab handbook offers a useful reference for thinking about asynchronous communication and documentation. [GitLab handbook](https://handbook.gitlab.com/handbook/company/culture/all-remote/asynchronous/)\n\n## Give every review a clear purpose\n\nAn editorial review and a subject-matter review ask different questions. Relay’s planned checkpoints make room for both: one to shape the story, another to check the substance. A named owner keeps responsibility visible as the draft moves between them. [Product brief](#source-prd)\n\n## Keep a path back\n\nAn earlier draft sometimes holds the better explanation. Version history is part of Relay’s beta requirements, giving teams a way to return to previous writing as they refine the article. [Product brief](#source-prd)\n\n## Start with a more thoughtful workflow\n\nRelay is preparing an invite-only private beta. A public launch date and pricing have not been announced, and performance improvements have not yet been measured. [Product brief](#source-prd)\n\nIf your team is looking for a clearer way to pass work forward, join the beta waitlist. Bring your handoff questions—we’re building around them.\n\n---\n*Illustrative demo article for a fictional product. Demo output is shortened for easy inspection.*`;
const draft = polished.replace('# Good content deserves a better handoff', '# Introducing Relay for content teams').replace('A draft can be ready while the next person is still missing the context.', 'Content teams need a better way to manage editorial handoffs.');
function report(pass: boolean): Report {
  return { passed: pass, scores: pass ? { accuracy: 98, coverage: 100, fidelity: 96 } : { accuracy: 68, coverage: 75, fidelity: 72 }, feedback: pass ? ['All factual claims have evidence. Planned features remain clearly qualified.'] : ['Remove the unsupported 40% time-saving claim.', 'Describe Relay as a planned private beta, not a launched product.'], claims: [
    { text: 'Relay is preparing an invite-only private beta.', sourceIds: ['prd'], verdict: 'supported', explanation: 'The PRD explicitly describes the release status.' },
    { text: 'The planned beta includes named owners and review checkpoints.', sourceIds: ['prd'], verdict: 'supported', explanation: 'Both capabilities appear in the requirements.' },
    ...(pass ? [{ text: 'Pricing and a public launch date have not been announced.', sourceIds: ['prd'], verdict: 'supported' as const, explanation: 'The PRD confirms neither has been set.' }] : [{ text: 'Relay is available today and saves teams 40% of their time.', sourceIds: ['prd'], verdict: 'contradicted' as const, explanation: 'The product is planned; no performance improvement has been measured.' }]),
  ] };
}
export function makeDemo(scenario: Scenario = 'revision', brief?: Brief, prd = samplePrd): Run {
  const run: Run = { id: `demo-${scenario}`, title: 'A better handoff for content teams', status: 'completed', createdAt: '2026-10-17T10:00:00Z', updatedAt: '2026-10-17T10:02:24Z', brief: brief ?? { audience: 'Content operations leads', tone: 'Clear & professional', targetWords: 1000 }, artifacts: [], attempts: [], events: [], sources, finalArtifactId: null, approvedDraftId: null, currentStage: 'polish', simulated: true };
  let seconds = 0;
  function add(stage: Stage, markdown: string, title: string, pass = true, check?: Report) {
    seconds += stage === 'prd' ? 0 : stage === 'research' ? 24 : stage === 'draft' ? 32 : 18;
    const createdAt = new Date(Date.parse(run.createdAt) + seconds * 1000).toISOString();
    const a: Artifact = { id: `${run.id}-${run.artifacts.length}`, stage, version: run.artifacts.filter(a => a.stage === stage).length + 1, markdown, title, createdAt, report: check, sources: stage === 'research' ? sources : undefined, approved: stage === 'polish' && pass, inputArtifactId: stage === 'verify' ? [...run.artifacts].reverse().find(a => a.stage === 'draft' || a.stage === 'polish')?.id : undefined };
    run.artifacts.push(a);
    run.events.push({ id: `e${run.events.length}`, stage, kind: 'completed', message: `${title}${check ? pass ? ' · evidence gate passed' : ' · evidence gate failed' : ''}`, createdAt });
    if (stage !== 'prd') run.attempts.push({ id: `a${run.attempts.length}`, stage, artifactId: a.id, status: pass ? 'passed' : 'rejected', durationMs: stage === 'research' ? 24000 : stage === 'draft' ? 32000 : 18000, inputTokens: 1800 + run.attempts.length * 480, outputTokens: stage === 'draft' || stage === 'polish' ? 930 : 420, searchCalls: stage === 'research' ? 2 : 0, costUsd: .008 + run.attempts.length * .003, model: 'Simulated · gpt-5.4', promptVersion: '1.0.0', createdAt });
    return a;
  }
  add('prd', prd, 'Product requirements');
  add('research', `# Research brief\n\n## Product facts\n- Relay is a planned, invite-only private beta.\n- Requirements include shared queues, named owners, review checkpoints, handoff summaries, and version history.\n- There are no measured performance gains, published prices, or launch dates.\n\n## Story angle\nFocus on the context that gets lost between writing and review. Use specific handoff examples rather than unmeasured efficiency claims.\n\n## External context\nWritten communication can help teammates collaborate asynchronously. Use the GitLab handbook as context, not as evidence for Relay’s product capabilities.\n\n**3 source records · 6 product facts · 1 proposed angle**`, 'Evidence gathered');
  const rejectedCount = scenario === 'success' ? 0 : scenario === 'revision' ? 1 : 3;
  for (let i = 0; i < rejectedCount; i++) {
    add('draft', draft.replace('Relay’s planned private beta', 'Relay is available today and saves teams 40% of their time. The product'), `Draft ${i + 1}`, false);
    add('verify', '# Verification findings\n\nTwo claims need revision.\n\n- **Unsupported performance claim:** no source establishes 40% time savings.\n- **Release status mismatch:** the PRD describes a planned private beta.\n\nReturn to the writer with these findings. Preserve the rejected draft for inspection.', `Verification ${i + 1}`, false, report(false));
    run.events.push({ id: `e${run.events.length}`, stage: 'draft', kind: 'rollback', message: i === 2 ? 'Revision limit reached. Human review required.' : `Returned to writer · revision ${i + 1} of 2`, createdAt: run.artifacts.at(-1)!.createdAt });
  }
  if (scenario === 'exhausted') { run.status = 'needs_review'; run.currentStage = 'verify'; }
  else {
    const d = add('draft', draft, `Draft ${rejectedCount + 1}`);
    add('verify', '# Evidence gate passed\n\nAll factual claims are supported by the PRD or linked reference material. Product capabilities remain qualified as planned. No unsupported performance or availability claims remain.\n\nThe draft can proceed to style polishing.', 'Draft verified', true, report(true));
    run.approvedDraftId = d.id;
    const p = add('polish', polished, 'Polished article');
    add('verify', '# Final verification passed\n\nThe polished article preserves the verified claims and their citations. No new factual claims were introduced.', 'Polish verified', true, report(true));
    run.finalArtifactId = p.id;
  }
  run.draftRevision = Math.min(rejectedCount, 2);
  run.polishRevision = 0;
  run.updatedAt = run.events.at(-1)!.createdAt;
  return run;
}
export const demoHistory = () => [makeDemo('revision'), { ...makeDemo('success'), id: 'demo-success-previous', title: 'From scattered feedback to a shared review' }, makeDemo('exhausted')];
export function demoAt(run: Run, count: number): Run {
  const artifacts = run.artifacts.slice(0, count);
  const cutoff = artifacts.at(-1)?.createdAt ?? run.createdAt;
  return { ...run, artifacts, sources: artifacts.some(a => a.stage === 'research') ? run.sources : run.sources.filter(s => s.id === 'prd'), draftRevision: Math.max(0,artifacts.filter(a => a.stage === 'draft').length-1), attempts: run.attempts.filter(a => artifacts.some(x => x.id === a.artifactId)), events: run.events.filter(e => e.createdAt <= cutoff), status: count >= run.artifacts.length ? run.status : 'running', finalArtifactId: count >= run.artifacts.length ? run.finalArtifactId : null, approvedDraftId: artifacts.some(a => a.id === run.approvedDraftId) ? run.approvedDraftId : null, currentStage: run.artifacts[count]?.stage ?? artifacts.at(-1)?.stage ?? 'prd' };
}
