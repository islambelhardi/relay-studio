import { NextRequest, NextResponse } from 'next/server';
import { authenticated, checkOrigin, failure } from '@/lib/server';
import { runSchema } from '@/lib/validation';
export async function GET() { try { const {db} = await authenticated(); const {data,error} = await db.from('runs').select('state').order('created_at',{ascending:false}); if (error) throw error; return NextResponse.json({runs:data.map(r => r.state)}); } catch(e) { return failure(e); } }
export async function POST(request: NextRequest) { try { checkOrigin(request); const {db} = await authenticated(); const input = runSchema.parse(await request.json()); const {data,error} = await db.rpc('create_content_run',{p_document_id:input.documentId,p_title:input.title,p_brief:input.brief}); if (error) throw error; return NextResponse.json({run:data},{status:202}); } catch(e) { return failure(e); } }
