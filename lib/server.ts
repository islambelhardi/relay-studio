import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new HttpError(503, 'Configure Supabase in .env.local and restart the app. The demo remains available.');
  const jar = await cookies();
  return createServerClient(url, key, { cookies: { getAll: () => jar.getAll(), setAll: values => values.forEach(({name,value,options}) => jar.set(name,value,options)) } });
}
export async function authenticated() { const db = await supabase(); const {data,error} = await db.auth.getUser(); if (error || !data.user) throw new HttpError(401, 'Sign in to access your workspace.'); return { db, user: data.user }; }
export function checkOrigin(request: NextRequest) { const origin = request.headers.get('origin'); if (origin && new URL(origin).origin !== request.nextUrl.origin) throw new HttpError(403,'This request must originate from the app.'); }
export function failure(error: unknown) { if (error instanceof HttpError) return NextResponse.json({error:error.message},{status:error.status}); if (error instanceof Error && error.name === 'ZodError') return NextResponse.json({error:'Check the submitted fields and try again.'},{status:400}); console.error('API request failed:', error instanceof Error ? error.name : 'Unknown error'); return NextResponse.json({error:'The request could not be completed. Check your Supabase migration and server configuration.'},{status:500}); }
