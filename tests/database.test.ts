import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const doc = '33333333-3333-4333-8333-333333333333';
const token = '44444444-4444-4444-8444-444444444444';
const brief = {audience:'Content teams',tone:'Professional',targetWords:1000};
let db: PGlite;
let rid: string;
let initial: Record<string,unknown>;
async function asUser(id: string) { await db.exec('set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); }
// Supabase-managed auth/storage and pgmq are stubbed only at their external
// boundaries. All application tables, functions, RLS, grants and transactions
// below are executed by real embedded PostgreSQL from the shipped migration.
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon,service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;
    create schema pgmq;
    create type pgmq.message_record as (msg_id bigint,read_ct integer,enqueued_at timestamptz,vt timestamptz,message jsonb);
    create table pgmq.test_queue(msg_id bigint generated always as identity,message jsonb);
    create function pgmq.create(text) returns void language sql as $$select$$;
    create function pgmq.send(text,jsonb) returns bigint language sql as $$insert into pgmq.test_queue(message) values($2) returning msg_id$$;
    create function pgmq.read(text,integer,integer) returns setof pgmq.message_record language sql as $$select msg_id,1,now(),now()+interval '60 seconds',message from pgmq.test_queue limit $3$$;
    create function pgmq.archive(text,bigint) returns boolean language sql as $$select true$$;
    create function pgmq.set_vt(text,bigint,integer) returns void language sql as $$select$$;
  `);
  const migration = readFileSync(new URL('../supabase/migrations/001_contentops.sql',import.meta.url),'utf8').replace('create extension if not exists pgmq;','');
  await db.exec(migration);
  await db.query('insert into auth.users(id) values ($1),($2)',[alice,bob]);
  await asUser(alice);
  await db.query("insert into documents(id,owner_id,title,filename,storage_path,extension,byte_size) values($1,$2,'PRD','prd.md',$3,'md',10)",[doc,alice,`${alice}/prd.md`]);
  const result = await db.query<{state:Record<string,unknown>}>("select create_content_run($1,'Test article',$2::jsonb) as state",[doc,JSON.stringify(brief)]);
  initial = result.rows[0].state; rid = initial.id as string;
  await db.exec('reset role');
},30000);
afterEach(async () => { await db.exec('reset role'); });
afterAll(async () => { await db?.close(); });
describe('database isolation and durable commits', () => {
  it('creates the run and queued job atomically', async () => { const q = await db.query<{n:number}>('select count(*)::int as n from pgmq.test_queue'); expect(q.rows[0].n).toBe(1); expect(initial.status).toBe('queued'); });
  it('hides documents and runs from another account', async () => { await asUser(bob); expect((await db.query('select * from documents')).rows).toHaveLength(0); expect((await db.query('select * from runs')).rows).toHaveLength(0); await expect(db.query("select create_content_run($1,'Stolen',$2::jsonb)",[doc,JSON.stringify(brief)])).rejects.toThrow('Document not found'); });
  it('validates briefs even when calling the database RPC directly', async () => { await asUser(alice); await expect(db.query("select create_content_run($1,'Missing brief','{}'::jsonb)",[doc])).rejects.toThrow('Invalid brief'); });
  it('prevents users from changing artifacts or accessing worker RPCs', async () => { await asUser(alice); await expect(db.query('update runs set revision=10 where id=$1',[rid])).rejects.toThrow('permission denied'); await expect(db.query('select read_content_job()')).rejects.toThrow('permission denied'); await expect(db.query("insert into documents(owner_id,title,filename,storage_path,extension,byte_size) values($1,'x','x','stolen','md',1)",[bob])).rejects.toThrow('row-level security'); });
  it('isolates uploaded object paths', async () => { await asUser(alice); await db.query("insert into storage.objects(bucket_id,name) values('prds',$1)",[`${alice}/test.md`]); await asUser(bob); expect((await db.query('select * from storage.objects')).rows).toHaveLength(0); await expect(db.query("insert into storage.objects(bucket_id,name) values('prds',$1)",[`${alice}/bad.md`])).rejects.toThrow('row-level security'); });
  it('fences duplicate deliveries and commits checkpoints atomically', async () => {
    await db.query('select claim_content_run($1,$2)',[rid,token]);
    const duplicate = await db.query<{state:unknown}>('select claim_content_run($1,$2) as state',[rid,crypto.randomUUID()]); expect(duplicate.rows[0].state).toBeNull();
    const art = {id:crypto.randomUUID(),stage:'prd',version:1,markdown:'# PRD',title:'Product requirements'};
    const ev = {id:crypto.randomUUID(),stage:'prd',kind:'completed',message:'Extracted'};
    const state = {...initial,phase:'research',status:'running',artifacts:[art],events:[ev]};
    const params = [rid,token,0,'extract:0',JSON.stringify(state),JSON.stringify([art]),null,JSON.stringify([ev])];
    const commit = () => db.query<{rev:number}>('select commit_content_step($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb) as rev',params);
    expect((await commit()).rows[0].rev).toBe(1);
    expect((await commit()).rows[0].rev).toBe(1);
    expect((await db.query('select * from artifacts')).rows).toHaveLength(1);
    expect((await db.query('select * from flow_checkpoints')).rows).toHaveLength(1);
    await expect(db.query("select commit_content_step($1,$2,0,'bad', $3::jsonb)",[rid,token,JSON.stringify(state)])).rejects.toThrow('Revision conflict');
    await expect(db.query("select commit_content_step($1,$2,1,'bad', $3::jsonb)",[rid,crypto.randomUUID(),JSON.stringify(state)])).rejects.toThrow('Lease lost');
    await expect(db.query("select commit_content_step($1,$2,1,'bad-final',$3::jsonb)",[rid,token,JSON.stringify({...state,status:'completed',finalArtifactId:crypto.randomUUID()})])).rejects.toThrow('Final article must be approved');
    expect((await db.query<{r:number}>('select revision as r from runs where id=$1',[rid])).rows[0].r).toBe(1);
  });
  it('preserves the approved document version when a replacement fails', async () => {
    const saved = await db.query<{state:Record<string,unknown>}>('select state from runs where id=$1',[rid]);
    const art = {id:crypto.randomUUID(),stage:'polish',version:1,markdown:'# Approved article',title:'Approved',approved:true};
    const complete = {...saved.rows[0].state,status:'completed',phase:'done',finalArtifactId:art.id};
    await db.query("select commit_content_step($1,$2,1,'approve:0',$3::jsonb,$4::jsonb)",[rid,token,JSON.stringify(complete),JSON.stringify([art])]);
    expect((await db.query<{id:string}>('select active_artifact_id as id from documents where id=$1',[doc])).rows[0].id).toBe(art.id);
    await asUser(alice);
    const created = await db.query<{state:Record<string,unknown>}>("select create_content_run($1,'Replacement',$2::jsonb) as state",[doc,JSON.stringify(brief)]);
    const replacement = created.rows[0].state;
    await db.exec('reset role');
    await db.query('select claim_content_run($1,$2)',[replacement.id,token]);
    await db.query("select commit_content_step($1,$2,0,'failed:0',$3::jsonb)",[replacement.id,token,JSON.stringify({...replacement,status:'needs_review',phase:'done'})]);
    expect((await db.query<{id:string}>('select active_artifact_id as id from documents where id=$1',[doc])).rows[0].id).toBe(art.id);
    await asUser(bob);
    for (const table of ['stage_attempts','artifacts','run_events','sources','claim_verdicts','flow_checkpoints']) {
      expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0);
    }
  });
});
