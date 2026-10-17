import { NextResponse } from 'next/server';
import { authenticated, failure, HttpError } from '@/lib/server';
export async function GET(_: Request, {params}:{params:Promise<{id:string}>}) { try { const {id} = await params; const {db} = await authenticated(); const {data,error} = await db.from('runs').select('state').eq('id',id).maybeSingle(); if (error) throw error; if (!data) throw new HttpError(404,'Run not found.'); return NextResponse.json({run:data.state}); } catch(e) { return failure(e); } }
