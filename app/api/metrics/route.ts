import { NextResponse } from 'next/server';
import { authenticated, failure } from '@/lib/server';
import { aggregate, Run } from '@/lib/types';
export async function GET() { try { const {db} = await authenticated(); const {data,error} = await db.from('runs').select('state'); if (error) throw error; return NextResponse.json(aggregate(data.map(d => d.state as Run))); } catch(e) { return failure(e); } }
