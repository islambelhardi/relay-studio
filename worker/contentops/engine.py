"""Pure routing rules, independently testable without network or model calls."""
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4
from .models import Verification, gate

TERMINAL = {"completed", "needs_review", "failed"}
def now() -> str:
    return datetime.now(timezone.utc).isoformat()

def event(stage: str, kind: str, message: str) -> dict:
    return {"id":str(uuid4()), "stage":stage, "kind":kind, "message":message, "createdAt":now()}

def artifact(state: dict, stage: str, markdown: str, title: str, **extras) -> dict:
    return {"id":str(uuid4()), "stage":stage, "version":1+sum(a["stage"] == stage for a in state["artifacts"]), "markdown":markdown, "title":title, "createdAt":now(), **extras}

def route_verification(state: dict, report: Verification, polished: bool) -> tuple[dict, list[dict], dict | None]:
    state = deepcopy(state)
    passed = gate(report, {s["id"] for s in state["sources"]})
    events: list[dict] = []
    promotion = None
    if not passed:
        feedback = list(report.feedback)
        if not feedback:
            feedback = [c.explanation for c in report.claims if c.verdict != "supported"] or ["Raise every rubric dimension to at least 85 and cite known sources for every factual claim."]
        state["feedback"] = feedback
        key = "polishRevision" if polished else "draftRevision"
        limit = 1 if polished else 2
        if state[key] < limit:
            state[key] += 1
            state["phase"] = "polish" if polished else "draft"
            state["currentStage"] = state["phase"]
            message = f"Evidence gate failed. Restored verified draft; polish retry {state[key]} of {limit}." if polished else f"Evidence gate failed. Returned to writer; revision {state[key]} of {limit}."
        else:
            state["status"] = "needs_review"
            state["phase"] = "done"
            message = "Revision limit reached. Inspect the findings and update the PRD or brief before starting a new run."
        events.append(event("polish" if polished else "draft", "rollback", message))
    elif polished:
        candidate = next(a for a in reversed(state["artifacts"]) if a["id"] == state["candidateId"])
        promotion = artifact(state,"polish",candidate["markdown"],"Approved polished article",approved=True,report={**report.model_dump(),"passed":True})
        state["artifacts"].append(promotion)
        state["finalArtifactId"] = promotion["id"]
        state["phase"] = "done"
        state["status"] = "completed"
        state["currentStage"] = "polish"
        events.append(event("polish","completed","Polished article verified and approved as final."))
    else:
        state["approvedDraftId"] = state["candidateId"]
        state["phase"] = "polish"
        state["currentStage"] = "polish"
        state["feedback"] = []
    return state, events, promotion
