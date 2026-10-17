import { Artifact, Source } from './types';
export function exportMarkdown(artifact: Artifact, sources: Source[]): string {
  if (!['draft','polish'].includes(artifact.stage) || !sources.length) return artifact.markdown;
  const cited = sources.filter(s => artifact.markdown.includes(`#source-${s.id}`) || (s.url && artifact.markdown.includes(s.url)));
  return artifact.markdown + '\n\n---\n\n## Source notes\n\n' + cited.map(s => `### Source ${s.id}\n\n${s.url ? `[${s.title.replace(/[\[\]\n]/g,' ')}](${s.url})` : 'Internal product requirements. Evidence is available in the private workspace.'}`).join('\n\n') + '\n';
}
