'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export function Markdown({ children, onSource }: { children: string; onSource?: () => void }) {
  return <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} onClick={href?.startsWith('#source-') && onSource ? e => { e.preventDefault(); onSource(); } : undefined} target={href?.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{children}</a> }}>{children}</ReactMarkdown></div>;
}
