from copy import deepcopy
import time
from uuid import uuid4
from pydantic import ValidationError
from crewai.flow.flow import Flow, listen, start
from .agents import AgentRunner, PROMPT_VERSION, ProviderFailure
from .engine import TERMINAL, artifact, event, now, route_verification
from .extraction import ExtractionError, extract_document
from .models import gate

class ContentFlow(Flow[dict]):
    def __init__(self, db, persistence, state: dict, lease_valid=lambda: True, runner=None):
        super().__init__()
        self.db, self.store = db, persistence
        self.initial = deepcopy(state)
        self.lease_valid = lease_valid
        self.runner = runner or AgentRunner(provider=state.get("provider", "openai"))

    @start()
    def restore_checkpoint(self):
        self.state.update(deepcopy(self.initial))
        return self.state

    @listen(restore_checkpoint)
    def run_pipeline(self, _):
        while self.state["status"] not in TERMINAL:
            if not self.lease_valid():
                raise RuntimeError("Worker lease lost; another delivery will recover the checkpoint.")
            self.execute_step()
        return self.state

    def save(self, key: str, state: dict, attempt=None):
        if not self.lease_valid():
            raise RuntimeError("Worker lease lost before commit.")
        self.store.stage_attempt(attempt)
        self.store.save_state(state["id"],key,state)
        self.state.update(state)

    def execute_step(self):
        state = deepcopy(dict(self.state))
        phase = state["phase"]
        stage = "prd" if phase == "extract" else "verify" if phase.startswith("verify") else phase
        revision = state["polishRevision"] if phase in {"polish","verify_polish"} else state["draftRevision"]
        key = f"{phase}:{revision}"
        state["status"] = "running"
        state["currentStage"] = stage
        started = time.monotonic()
        attempt = None
        try:
            if phase == "extract":
                document = self.db.table("documents").select("*").eq("id",state["documentId"]).single().execute().data
                data = self.db.storage.from_("prds").download(document["storage_path"])
                prd = extract_document(data,document["extension"])
                a = artifact(state,"prd",prd,"Product requirements")
                state["artifacts"].append(a)
                state["sources"] = [{"id":"prd","title":document["title"],"url":"","excerpt":prd,"retrievedAt":now()}]
                state["phase"] = "research"
                state["currentStage"] = "research"
                state["events"].append(event("prd","completed","Product requirements extracted and ready."))
            else:
                self.runner.begin(state["sources"],stage)
                prd = next(a["markdown"] for a in state["artifacts"] if a["stage"] == "prd")
                research = next((a["markdown"] for a in state["artifacts"] if a["stage"] == "research"),"")
                promotion = None
                if phase == "research":
                    output = self.runner.research(prd,state["brief"])
                    state["sources"] = self.runner.sources
                    a = artifact(state,"research",output.markdown,"Research brief",sources=state["sources"])
                    state["phase"] = "draft"
                    state["currentStage"] = "draft"
                elif phase == "draft":
                    output = self.runner.write(prd,state["brief"],research,state.get("feedback",[]))
                    a = artifact(state,"draft",output.markdown,output.title)
                    state["candidateId"] = a["id"]
                    state["phase"] = "verify_draft"
                    state["currentStage"] = "verify"
                elif phase == "polish":
                    approved = next(a for a in state["artifacts"] if a["id"] == state["approvedDraftId"])
                    output = self.runner.polish(state["brief"],approved,state.get("feedback",[]))
                    a = artifact(state,"polish",output.markdown,output.title,approved=False)
                    state["candidateId"] = a["id"]
                    state["phase"] = "verify_polish"
                    state["currentStage"] = "verify"
                elif phase in {"verify_draft","verify_polish"}:
                    candidate = next(a for a in state["artifacts"] if a["id"] == state["candidateId"])
                    output = self.runner.verify(prd,candidate,research)
                    state["sources"] = self.runner.sources
                    passed = gate(output,{s["id"] for s in state["sources"]})
                    report = {**output.model_dump(),"passed":passed}
                    summary = "# Evidence gate " + ("passed" if passed else "failed") + "\n\n" + "\n".join(f"- {c.text}: **{c.verdict.replace('_',' ')}** — {c.explanation}" for c in output.claims)
                    a = artifact(state,"verify",summary,"Polish verification" if phase == "verify_polish" else "Draft verification",report=report,inputArtifactId=candidate["id"])
                    state["artifacts"].append(a)
                    state, routing_events, promotion = route_verification(state,output,phase == "verify_polish")
                    state["events"].extend(routing_events)
                else:
                    raise ValueError("Unknown workflow phase")
                if not phase.startswith("verify"):
                    state["artifacts"].append(a)
                usage = self.runner.finish_usage()
                attempt = self.make_attempt(state,stage,a,usage,started)
                if phase.startswith("verify") and not a["report"]["passed"]:
                    attempt["status"] = "rejected"
                state["attempts"].append(attempt)
                for message in self.runner.events:
                    state["events"].append(event(stage,"error",message))
                state["events"].append(event(stage,"completed",f"{a['title']} saved" + (" · evidence gate passed" if a.get("report",{}).get("passed") else " · evidence gate failed" if a.get("report") else "")))
        except (ExtractionError, ProviderFailure, ValidationError) as exc:
            state["status"], state["phase"] = "failed", "done"
            state["error"] = str(exc) if isinstance(exc,(ExtractionError,ProviderFailure)) else "The agent returned malformed structured output. No article was approved. Retry the run."
            state["events"].append(event(stage,"error",state["error"]))
            if phase != "extract":
                for message in self.runner.events:
                    state["events"].append(event(stage,"error",message))
                usage = self.runner.finish_usage()
                attempt = self.make_attempt(state,stage,None,usage,started)
                attempt.update(status="error",error=state["error"])
                state["attempts"].append(attempt)
        # Database/storage errors escape: do not convert persistence outages into
        # terminal model failures. The unacknowledged queue job is retried later.
        state["updatedAt"] = now()
        self.save(key,state,attempt)

    def make_attempt(self,state,stage,a,usage,started):
        return {"id":str(uuid4()),"stage":stage,"artifactId":a["id"] if a else None,"status":"passed","durationMs":int((time.monotonic()-started)*1000),"inputTokens":usage.input_tokens,"outputTokens":usage.output_tokens,"searchCalls":usage.search_calls,"costUsd":usage.cost_usd,"model":self.runner.model,"promptVersion":PROMPT_VERSION,"createdAt":now()}
