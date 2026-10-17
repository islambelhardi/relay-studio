-- Run once in a new Supabase project's SQL editor.
create extension if not exists pgmq;
select pgmq.create('content_runs');

create table public.documents (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 title text not null, filename text not null, storage_path text not null unique,
 extension text not null check (extension in ('txt','md','pdf','docx')),
 byte_size integer not null check(byte_size between 1 and 10485760),
 extracted_text text, active_artifact_id uuid, created_at timestamptz not null default now()
);
create table public.runs (
 id uuid primary key, owner_id uuid not null references auth.users(id), document_id uuid not null references public.documents(id),
 state jsonb not null, revision integer not null default 0,
 lease_token uuid, lease_until timestamptz,
 created_at timestamptz not null default now()
);
create table public.stage_attempts (
 id uuid primary key, run_id uuid not null references public.runs(id), owner_id uuid not null references auth.users(id),
 step_key text not null, data jsonb not null, created_at timestamptz not null default now(), unique(run_id,step_key)
);
create table public.artifacts (
 id uuid primary key, run_id uuid not null references public.runs(id), owner_id uuid not null references auth.users(id),
 stage text not null, version integer not null, data jsonb not null, created_at timestamptz not null default now(), unique(run_id,stage,version)
);
alter table public.documents add constraint documents_active_artifact_fk foreign key(active_artifact_id) references public.artifacts(id);
create table public.run_events (
 id uuid primary key, run_id uuid not null references public.runs(id), owner_id uuid not null references auth.users(id),
 sequence bigint generated always as identity, data jsonb not null, created_at timestamptz not null default now()
);
create table public.sources (
 run_id uuid not null references public.runs(id), owner_id uuid not null references auth.users(id),
 source_id text not null, data jsonb not null, primary key(run_id,source_id)
);
create table public.claim_verdicts (
 id bigint generated always as identity primary key, run_id uuid not null references public.runs(id),
 owner_id uuid not null references auth.users(id), artifact_id uuid not null references public.artifacts(id), data jsonb not null
);
create table public.flow_checkpoints (
 run_id uuid not null references public.runs(id), step_key text not null, owner_id uuid not null references auth.users(id),
 state jsonb not null, created_at timestamptz not null default now(), primary key(run_id,step_key)
);

do $$ declare t text; begin
 foreach t in array array['documents','runs','stage_attempts','artifacts','run_events','sources','claim_verdicts','flow_checkpoints'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy owner_read on public.%I for select to authenticated using (owner_id = (select auth.uid()))',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('revoke all on public.%I from anon',t);
 end loop;
end $$;
create policy owner_insert on public.documents for insert to authenticated with check(owner_id = (select auth.uid()) and active_artifact_id is null and extracted_text is null);
grant insert on public.documents to authenticated;
-- User sessions cannot alter immutable artifacts, operational logs, or queue state.
revoke insert,update,delete on public.runs,public.stage_attempts,public.artifacts,public.run_events,public.sources,public.claim_verdicts,public.flow_checkpoints from authenticated;
revoke update,delete on public.documents from authenticated;
grant all on public.documents,public.runs,public.stage_attempts,public.artifacts,public.run_events,public.sources,public.claim_verdicts,public.flow_checkpoints to service_role;
grant usage,select on all sequences in schema public to service_role;
create index runs_owner_created on public.runs(owner_id,created_at desc);
create index attempts_run on public.stage_attempts(run_id);
create index events_run on public.run_events(run_id,sequence);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('prds','prds',false,10485760,array['text/plain','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
create policy private_prd_read on storage.objects for select to authenticated using(bucket_id='prds' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy private_prd_insert on storage.objects for insert to authenticated with check(bucket_id='prds' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy private_prd_delete on storage.objects for delete to authenticated using(bucket_id='prds' and (storage.foldername(name))[1]=(select auth.uid())::text);

create function public.create_content_run(p_document_id uuid,p_title text,p_brief jsonb) returns jsonb
language plpgsql security definer set search_path = public,pgmq,pg_temp as $$
declare rid uuid := gen_random_uuid(); uid uuid := auth.uid(); ts text := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); state jsonb;
begin
 if uid is null or not exists(select 1 from public.documents where id=p_document_id and owner_id=uid) then raise exception 'Document not found'; end if;
 if coalesce(length(trim(p_title)),0) not between 1 and 160
 or coalesce(jsonb_typeof(p_brief),'null') <> 'object'
 or coalesce(length(trim(p_brief->>'audience')),0) not between 1 and 200
 or coalesce(length(trim(p_brief->>'tone')),0) not between 1 and 200
 or coalesce(p_brief->>'targetWords','') !~ '^[0-9]{3,4}$' then raise exception 'Invalid brief'; end if;
 if (p_brief->>'targetWords')::int not between 300 and 3000 then raise exception 'Invalid brief'; end if;
 state := jsonb_build_object('id',rid,'documentId',p_document_id,'title',p_title,'brief',p_brief,'status','queued','phase','extract','currentStage','prd','createdAt',ts,'updatedAt',ts,'artifacts','[]'::jsonb,'attempts','[]'::jsonb,'events','[]'::jsonb,'sources','[]'::jsonb,'finalArtifactId',null,'approvedDraftId',null,'draftRevision',0,'polishRevision',0,'simulated',false);
 insert into public.runs(id,owner_id,document_id,state) values(rid,uid,p_document_id,state);
 perform pgmq.send('content_runs',jsonb_build_object('run_id',rid));
 return state;
end $$;
revoke all on function public.create_content_run from public,anon;
grant execute on function public.create_content_run to authenticated;

-- Queue access is only exposed to the Python worker's service-role connection.
create function public.read_content_job() returns setof pgmq.message_record language sql security definer set search_path=pgmq,pg_temp as $$ select * from pgmq.read('content_runs',60,1); $$;
create function public.archive_content_job(p_message_id bigint) returns boolean language sql security definer set search_path=pgmq,pg_temp as $$ select pgmq.archive('content_runs',p_message_id); $$;
create function public.claim_content_run(p_run_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 update public.runs set lease_token=p_token,lease_until=now()+interval '60 seconds'
 where id=p_run_id and (lease_until is null or lease_until < now()) returning jsonb_build_object('state',state,'revision',revision,'owner_id',owner_id,'document_id',document_id) into result;
 return result;
end $$;
create function public.heartbeat_content_run(p_run_id uuid,p_token uuid,p_message_id bigint) returns boolean language plpgsql security definer set search_path=public,pgmq,pg_temp as $$
begin
 update public.runs set lease_until=now()+interval '60 seconds' where id=p_run_id and lease_token=p_token and lease_until>now();
 if not found then return false; end if;
 perform pgmq.set_vt('content_runs',p_message_id,60); return true;
end $$;
create function public.release_content_run(p_run_id uuid,p_token uuid) returns void language sql security definer set search_path=public,pg_temp as $$ update public.runs set lease_until=null,lease_token=null where id=p_run_id and lease_token=p_token; $$;

-- Every durable stage boundary is committed in one transaction, guarded by both a
-- lease token and an optimistic revision. Re-delivery cannot overwrite later work.
create function public.commit_content_step(p_run_id uuid,p_token uuid,p_revision integer,p_step_key text,p_state jsonb,p_artifacts jsonb default '[]',p_attempt jsonb default null,p_events jsonb default '[]') returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.runs; event jsonb; source jsonb; claim jsonb; art jsonb;
begin
 select * into r from public.runs where id=p_run_id for update;
 if r.lease_token is distinct from p_token or r.lease_until < now() then raise exception 'Lease lost'; end if;
 if exists(select 1 from public.flow_checkpoints where run_id=p_run_id and step_key=p_step_key) then return r.revision; end if;
 if r.revision <> p_revision then raise exception 'Revision conflict'; end if;
 for art in select value from jsonb_array_elements(p_artifacts) loop
 insert into public.artifacts(id,run_id,owner_id,stage,version,data) values((art->>'id')::uuid,p_run_id,r.owner_id,art->>'stage',(art->>'version')::int,art);
 for claim in select value from jsonb_array_elements(coalesce(art->'report'->'claims','[]')) loop
 insert into public.claim_verdicts(run_id,owner_id,artifact_id,data) values(p_run_id,r.owner_id,(art->>'id')::uuid,claim);
 end loop;
 end loop;
 if p_attempt is not null then insert into public.stage_attempts(id,run_id,owner_id,step_key,data) values((p_attempt->>'id')::uuid,p_run_id,r.owner_id,p_step_key,p_attempt); end if;
 for event in select value from jsonb_array_elements(p_events) loop insert into public.run_events(id,run_id,owner_id,data) values((event->>'id')::uuid,p_run_id,r.owner_id,event); end loop;
 for source in select value from jsonb_array_elements(p_state->'sources') loop insert into public.sources(run_id,owner_id,source_id,data) values(p_run_id,r.owner_id,source->>'id',source) on conflict(run_id,source_id) do nothing; end loop;
 insert into public.flow_checkpoints(run_id,step_key,owner_id,state) values(p_run_id,p_step_key,r.owner_id,p_state);
 update public.runs set state=p_state,revision=revision+1 where id=p_run_id;
 if p_state->>'status'='completed' then
 if not exists(select 1 from public.artifacts where id=(p_state->>'finalArtifactId')::uuid and run_id=p_run_id and data->>'approved'='true') then raise exception 'Final article must be approved'; end if;
 update public.documents set active_artifact_id=(p_state->>'finalArtifactId')::uuid where id=r.document_id;
 end if;
 return r.revision+1;
end $$;

do $$ declare f text; begin
 foreach f in array array['read_content_job','archive_content_job','claim_content_run','heartbeat_content_run','release_content_run','commit_content_step'] loop
 execute format('revoke all on function public.%I from public,anon,authenticated',f);
 execute format('grant execute on function public.%I to service_role',f);
 end loop;
end $$;
