from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4
import pytest
from contentops.agents import ProviderFailure
from contentops.engine import now
from contentops.flow import ContentFlow
from contentops.models import Article, Claim, Research, Scores, Source, Usage, Verification
from contentops.persistence import SupabasePersistence

def initial_state():
    return {"id":str(uuid4()),"documentId":str(uuid4()),"title":"Test","brief":{"audience":"Teams","tone":"Professional","targetWords":1000},"createdAt":now(),"updatedAt":now(),"status":"queued","phase":"extract","currentStage":"prd","artifacts":[],"attempts":[],"events":[],"sources":[],"finalArtifactId":None,"approvedDraftId":None,"draftRevision":0,"polishRevision":0,"simulated":False}

class MemoryStore:
    def __init__(self,state):
        self.current = deepcopy(state)
        self.keys = []
        self.fail_at = None
    def stage_attempt(self,attempt):
        self.attempt = attempt
    def save_state(self,rid,key,state):
        if self.fail_at == key:
            raise RuntimeError("Database unavailable")
        assert key not in self.keys
        self.keys.append(key)
        self.current = deepcopy(state)

class FakeRunner:
    def __init__(self,draft_failures=0,polish_failures=0,malformed=False):
        self.draft_failures,self.polish_failures = draft_failures,polish_failures
        self.verifications,self.polish_verifications = 0,0
        self.calls = []
        self.malformed = malformed
    def begin(self,sources,stage):
        self.sources,self.events,self.model = deepcopy(sources),[],"test-model"
    def finish_usage(self):
        return Usage(input_tokens=100,output_tokens=50,cost_usd=.01)
    def research(self,prd,brief):
        self.calls.append("research")
        self.sources.append({"id":"s1","title":"Public evidence","url":"https://example.com/reference","excerpt":"Context","retrievedAt":now()})
        return Research(markdown="# Research",product_facts=["Beta planned"],search_queries=["Editorial handoffs"],sources=[Source.model_validate(s) for s in self.sources])
    def write(self,*args):
        self.calls.append("draft")
        return Article(title="Draft",markdown="# Draft\nPlanned beta. [PRD](#source-prd)")
    def polish(self,*args):
        self.calls.append("polish")
        return Article(title="Polished",markdown="# Polished\nPlanned beta. [PRD](#source-prd)")
    def verify(self,prd,candidate,research):
        self.calls.append("verify")
        if self.malformed:
            return Verification.model_validate({"scores":{}})
        polished = candidate["stage"] == "polish"
        if polished:
            self.polish_verifications += 1
            passed = self.polish_verifications > self.polish_failures
        else:
            self.verifications += 1
            passed = self.verifications > self.draft_failures
        return Verification(scores=Scores(accuracy=95 if passed else 70,coverage=100,fidelity=100),claims=[Claim(text="Beta planned",sourceIds=["prd"],verdict="supported" if passed else "contradicted",explanation="PRD comparison")],feedback=[] if passed else ["Fix claim"])

def db_stub():
    db = Mock()
    db.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"storage_path":"owner/prd.md","extension":"md","title":"Test PRD"}
    db.storage.from_.return_value.download.return_value = b"# PRD\nBeta is planned."
    return db

@pytest.mark.parametrize("draft_failures,polish_failures,status",[(0,0,"completed"),(1,0,"completed"),(3,0,"needs_review"),(0,1,"completed"),(0,2,"needs_review")])
def test_full_flow_routes_and_commits(draft_failures,polish_failures,status):
    state = initial_state()
    store,runner = MemoryStore(state),FakeRunner(draft_failures,polish_failures)
    ContentFlow(db_stub(),store,state,runner=runner).kickoff()
    assert store.current["status"] == status
    assert len(store.keys) == len(set(store.keys))
    assert len(store.current["attempts"]) == len(runner.calls)
    assert bool(store.current["finalArtifactId"]) == (status == "completed")
    if status == "completed":
        final = next(a for a in store.current["artifacts"] if a["id"] == store.current["finalArtifactId"])
        assert final["approved"] and final["report"]["passed"]

def test_worker_restart_skips_committed_research():
    state = initial_state()
    store = MemoryStore(state)
    store.fail_at = "draft:0"
    with pytest.raises(RuntimeError,match="Database unavailable"):
        ContentFlow(db_stub(),store,state,runner=FakeRunner()).kickoff()
    assert store.current["phase"] == "draft"
    store.fail_at = None
    restarted = FakeRunner()
    ContentFlow(db_stub(),store,store.current,runner=restarted).kickoff()
    assert "research" not in restarted.calls
    assert store.current["status"] == "completed"
    no_work = FakeRunner()
    ContentFlow(db_stub(),store,store.current,runner=no_work).kickoff()
    assert no_work.calls == []

def test_malformed_output_records_usage_and_stops():
    state = initial_state()
    store = MemoryStore(state)
    ContentFlow(db_stub(),store,state,runner=FakeRunner(malformed=True)).kickoff()
    assert store.current["status"] == "failed"
    assert store.current["attempts"][-1]["status"] == "error"
    assert store.current["attempts"][-1]["inputTokens"] == 100
    assert store.current["finalArtifactId"] is None

def test_lost_lease_prevents_work():
    state = initial_state()
    store = MemoryStore(state)
    with pytest.raises(RuntimeError,match="lease lost"):
        ContentFlow(db_stub(),store,state,lambda:False,FakeRunner()).kickoff()
    assert store.keys == []

def test_persistence_commits_deltas_and_recovers_revision():
    state = initial_state()
    db = Mock()
    db.rpc.return_value.execute.return_value.data = 1
    store = SupabasePersistence(db,str(uuid4()),0,state)
    next_state = deepcopy(state)
    next_state["artifacts"].append({"id":"new","stage":"prd"})
    store.stage_attempt(None)
    store.save_state(state["id"],"extract:0",next_state)
    payload = db.rpc.call_args.args[1]
    assert payload["p_revision"] == 0
    assert len(payload["p_artifacts"]) == 1
    db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{"revision":1,"state":next_state}]
    assert store.load_state(state["id"]) == next_state
