-- Existing runs without a provider continue using OpenAI.
-- Replace the RPC signature while preserving legacy calls through the default.
begin;
drop function public.create_content_run(uuid,text,jsonb);
create function public.create_content_run(p_document_id uuid,p_title text,p_brief jsonb,p_provider text default 'openai') returns jsonb
language plpgsql security definer set search_path = public,pgmq,pg_temp as $$
declare rid uuid := gen_random_uuid(); uid uuid := auth.uid(); ts text := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); state jsonb;
begin
 if p_provider is null or p_provider not in ('openai','gemini') then raise exception 'Invalid provider'; end if;
 if uid is null or not exists(select 1 from public.documents where id=p_document_id and owner_id=uid) then raise exception 'Document not found'; end if;
 if coalesce(length(trim(p_title)),0) not between 1 and 160
 or coalesce(jsonb_typeof(p_brief),'null') <> 'object'
 or coalesce(length(trim(p_brief->>'audience')),0) not between 1 and 200
 or coalesce(length(trim(p_brief->>'tone')),0) not between 1 and 200
 or coalesce(p_brief->>'targetWords','') !~ '^[0-9]{3,4}$' then raise exception 'Invalid brief'; end if;
 if (p_brief->>'targetWords')::int not between 300 and 3000 then raise exception 'Invalid brief'; end if;
 state := jsonb_build_object('id',rid,'documentId',p_document_id,'title',p_title,'brief',p_brief,'provider',p_provider,'status','queued','phase','extract','currentStage','prd','createdAt',ts,'updatedAt',ts,'artifacts','[]'::jsonb,'attempts','[]'::jsonb,'events','[]'::jsonb,'sources','[]'::jsonb,'finalArtifactId',null,'approvedDraftId',null,'draftRevision',0,'polishRevision',0,'simulated',false);
 insert into public.runs(id,owner_id,document_id,state) values(rid,uid,p_document_id,state);
 perform pgmq.send('content_runs',jsonb_build_object('run_id',rid));
 return state;
end $$;
revoke all on function public.create_content_run from public,anon;
grant execute on function public.create_content_run to authenticated;


commit;
