import { NextResponse } from 'next/server';
import { authenticated, failure, HttpError } from '@/lib/server';
import { Run } from '@/lib/types';
import { exportMarkdown } from '@/lib/export';
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}) { try { const {id} = await params; const {db} = await authenticated(); const {data,error} = await db.from('runs').select('state').eq('id',id).maybeSingle(); if (error) throw error; if (!data) throw new HttpError(404,'Run not found.'); const run = data.state as Run; const artifact = run.artifacts.find(a => a.id === run.finalArtifactId && a.approved); if (!artifact) throw new HttpError(409,'This run has no approved final article.'); return new NextResponse(exportMarkdown(artifact,run.sources),{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="article-${id}.md"`}}); } catch(e) { return failure(e); } }
