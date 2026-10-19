# Relay Studio

A local content operations workbench: **PRD → researcher → writer → fact-checker → style polisher**. Built with Next.js, Supabase, CrewAI Flows, and a choice of OpenAI or Gemini.

## Start the credential-free demo

Requirements: Node.js 20.9+ (Node 24 recommended), npm, and PowerShell on Windows.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open **http://127.0.0.1:3000**. Or run `./scripts/start-app.ps1` from PowerShell. The seeded demo needs no API key, database, or account. It supports clean success, revision and recovery, exhausted retries, replay, pause, reset, evidence inspection, version comparison, Markdown export, history, and aggregate metrics. The Relay product and all demo articles and metrics are illustrative. The demo does not generate new copy from custom input.

## Enable live runs

1. Create a Supabase project. In its SQL editor, execute `supabase/migrations/001_contentops.sql`, then `supabase/migrations/002_ai_providers.sql` **once**, as the database owner. They enable `pgmq`, create the `content_runs` queue and private `prds` bucket, and apply the application schema, RPC grants, provider choice, and ownership policies. For an existing installation, apply only migrations you have not already run.
2. Copy `.env.example` to `.env.local` at the repository root. Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and at least one of `OPENAI_API_KEY` or `GEMINI_API_KEY`. Get the Supabase keys from Project Settings → API. Never place service-role or provider keys in `NEXT_PUBLIC_*` variables or commit `.env.local`.
3. In Supabase Auth, enable email/password. Set Site URL to `http://127.0.0.1:3000` and add it to allowed redirect URLs. If email confirmation is enabled, confirm the signup email before signing in. Email delivery uses your Supabase project's mail settings.
4. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and Python 3.12. The installed Python 3.14 is not supported by this worker; `uv python install 3.12` installs a separate interpreter without replacing it.
5. Start the worker in a second terminal:

```powershell
./scripts/start-worker.ps1
```

Or manually:

```powershell
cd worker
uv --cache-dir ../.uv-cache sync --frozen --python 3.12
uv --cache-dir ../.uv-cache run --frozen python -m contentops.main
```

6. Restart the Next.js development server after setting environment variables. Switch to **Live**, create an account, sign in, and create an article. The queued run starts when the worker is listening; the browser polls every two seconds until the run completes, fails, or needs review. Refreshing does not interrupt the worker; the selected live run ID is saved locally.

Choose **OpenAI** or **Gemini** in **New article → AI provider**. Only providers with server API keys are available in Live mode. The choice is saved in the run and used for all four roles and web research, including after worker restarts. Existing runs without a provider use OpenAI. Changing the choice affects new runs only; there is no automatic fallback to another provider.

OpenAI defaults to `gpt-5.4` and Gemini to `gemini-2.5-flash`. Override each role with `OPENAI_MODEL_*` or `GEMINI_MODEL_*` in `.env.local`. Gemini uses the native generateContent API with structured JSON and Google Search grounding; it does not call OpenAI. Configure the same provider keys on both the Next.js server and worker, then restart both.

Gemini has a [free tier](https://ai.google.dev/gemini-api/docs/pricing) for eligible models/accounts, subject to quotas and Google's data terms. Choosing Gemini does not guarantee free usage: your account, model, search usage, and billing tier determine charges. OpenAI calls are billable. Token counts come from returned usage (Gemini output includes thinking tokens). Cost remains unavailable unless all three optional pricing variables for the selected provider are supplied. Set zero rates only when applicable; estimates use one rate schedule per provider and are not invoices.

For an existing database, apply `supabase/migrations/002_ai_providers.sql` before creating new runs. This changes the run-creation RPC without rewriting old runs.


## Workflow and evidence policy

- PRD inputs: pasted text, UTF-8 TXT/Markdown, selectable-text PDF, or DOCX including tables. Upload cap: 10 MB. PDFs with passwords, image-only PDFs, corrupt files, decompressed DOCX over 50 MB, PDFs over 300 pages, and extracted text over 200,000 characters produce actionable failures. OCR is outside v1.
- The researcher extracts product facts and generates at most three general public-context queries. Full PRDs are sent to the selected AI provider for processing, but are not deliberately submitted as web-search queries. Search-query minimization is prompt-guided, not a formal data-loss-prevention guarantee.
- Every source records its ID, title, URL, evidence text, and retrieval time. Web evidence text is the actual returned search synthesis, explicitly labeled **not a verbatim page quotation**. URL metadata is copied from provider tool results, never accepted from model-authored source records. No arbitrary page fetcher is exposed.
- The writer uses product facts and linked research. The fact-checker independently evaluates all factual assertions and corroborates public references with web search. Claim verdicts are `supported`, `contradicted`, or `insufficient_evidence`.
- All factual claims require known, nonempty source references; every dimension must reach 85. Displayed quality is 40% accuracy, 35% evidence coverage, 25% PRD fidelity. Scores and claim enumeration are model assessments, with evidence available for human inspection.
- Failed checks preserve the rejected draft and send findings back to the writer. The initial draft gets at most two revisions. Exhausted checks become `needs_review`; inspect findings and start a new run with an updated PRD/brief. There is no bypass-approval control.
- Polishing starts only from the verified draft. The same fact-checker evaluates the polished output. One corrective polish is allowed; persistent failure stops for review. Final approval creates a new immutable artifact version. Failed replacement runs do not alter the document's previous active article.
- Provider timeouts, connection failures, 429s, and 5xxs get two retries with backoff, independently of editorial retries. Failed structured outputs stop the run. Completed-call usage is retained even on a failed stage. A process crash before a commit can repeat an external call, and provider charges for that interrupted call may be unavailable to the application.

## Persistence and recovery

The Next.js server authenticates through Supabase cookies and user-scoped clients. All operational tables use ownership RLS. Only the worker's service-role connection can execute queue/lease/commit RPCs or write immutable artifacts and logs. Uploaded files use private user-ID folders.

The worker claims a 60-second queue lease and run token, heartbeats every 15 seconds, and commits each stage's artifact(s), attempt, ordered events, sources, claim verdicts, and checkpoint in a single Postgres transaction. Commits verify a lease token and expected revision. Unique step keys prevent duplicate commits. Infrastructure failures leave the queue job unacknowledged; a later delivery resumes from the last committed stage. Only terminal runs are archived from the queue.

CrewAI's auxiliary local files live in `worker/.state`; its own package may also initialize normal per-user application-data files. Supabase is the authoritative workflow store. Telemetry and third-party CrewAI tracing are disabled; logs retain concise events, not hidden model reasoning. Run metadata, prompts' version numbers, and final outputs are retained until explicitly removed through project administration; v1 has no deletion UI.

## Interfaces

| Endpoint | Behavior |
|---|---|
| `GET /api/auth` | Current user email or signed-out state |
| `POST /api/auth` | `signin`, `signup`, or `signout` |
| `POST /api/documents` | Multipart `file` or `text`, plus `title`; returns document ID |
| `POST /api/runs` | `{documentId, title, brief: {audience, tone, targetWords}}`; returns queued run with HTTP 202 |
| `GET /api/runs` | Owner's run snapshots |
| `GET /api/runs/:id` | Owner's persisted run and artifacts |
| `GET /api/runs/:id/export` | Approved final Markdown, or HTTP 409 before approval |
| `GET /api/metrics` | Owner-scoped metrics including rejected attempts |

The UI offers copy/download for intermediate versions as well, clearly distinguished from approved final output. Live user accounts are separate; shared teams, invitations, CMS publishing, and online deployment are outside this version.

## Verification

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
cd worker
uv --cache-dir ../.uv-cache run --frozen python -m pytest -q
```

The TypeScript suite exercises fixture behavior, metric arithmetic, validation, and the **actual application migration in embedded PostgreSQL**. Supabase-managed Auth/Storage tables and `pgmq` are test stubs; application RLS, grants, stored procedures, leases, and atomic commits are real PostgreSQL. This does not substitute for a hosted Supabase smoke test.

The Python suite covers extraction, gates, retry bounds, real CrewAI execution with a mocked Responses client, full Flow routing, malformed output, worker restart recovery, lost leases, and checkpoint payloads. It does not spend OpenAI credits.

Live smoke test after configuration: create two accounts; start a run from each; verify private run/Storage isolation; inspect source evidence and persisted attempts; stop/restart the worker between stages; confirm the queued run recovers; download the approved Markdown. No live credentials were available during implementation, so hosted Auth/Queues/Storage and actual OpenAI calls must be smoke-tested in your project.

For a production-mode local build: `npm.cmd run build` then `npm.cmd start`. Development and production scripts bind to loopback, not your LAN.
