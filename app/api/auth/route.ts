import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkOrigin, failure, HttpError, supabase } from '@/lib/server';
export async function GET() { try { const db = await supabase(); const {data} = await db.auth.getUser(); return NextResponse.json({email:data.user?.email ?? null}); } catch(e) { return failure(e); } }
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request); const body = await request.json(); const db = await supabase();
    if (body.action === 'signout') { const {error} = await db.auth.signOut(); if (error) throw new HttpError(400,error.message); return NextResponse.json({ok:true}); }
    const data = z.object({action:z.enum(['signin','signup']),email:z.email(),password:z.string().min(8).max(128)}).parse(body);
    const result = data.action === 'signin' ? await db.auth.signInWithPassword({email:data.email,password:data.password}) : await db.auth.signUp({email:data.email,password:data.password});
    if (result.error) throw new HttpError(400,result.error.message);
    return NextResponse.json({email:result.data.session ? result.data.user?.email : null,message:'Check your email to confirm the account, then return here to sign in.'});
  } catch(e) { return failure(e); }
}
