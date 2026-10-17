from copy import deepcopy
from unittest.mock import Mock
import pytest
from contentops.models import Claim, Scores, Verification, gate, quality_score
from contentops.engine import route_verification

def report(passed=True):
    return Verification(scores=Scores(accuracy=98 if passed else 70,coverage=100,fidelity=96),claims=[Claim(text="Beta is planned",sourceIds=["prd"],verdict="supported" if passed else "contradicted",explanation="Compared against PRD")],feedback=[] if passed else ["Preserve planned release status"])

def state():
    return {"id":"test","phase":"verify_draft","status":"running","sources":[{"id":"prd"}],"artifacts":[{"id":"draft","stage":"draft","version":1,"markdown":"Draft"},{"id":"candidate","stage":"polish","version":1,"markdown":"Polished"}],"candidateId":"draft","approvedDraftId":None,"finalArtifactId":None,"draftRevision":0,"polishRevision":0}

def test_quality_gate_thresholds_and_source_mapping():
    r = report()
    assert gate(r,{"prd"})
    assert not gate(r,{"s1"})
    r.scores.accuracy = 84
    assert not gate(r,{"prd"})
    r.scores.accuracy = 85
    assert gate(r,{"prd"})
    r.claims[0].sourceIds = []
    assert not gate(r,{"prd"})

def test_weighted_score():
    assert quality_score(Scores(accuracy=90,coverage=100,fidelity=80)) == 91

def test_initial_plus_two_revisions_then_human_review():
    s = state()
    original = deepcopy(s["artifacts"])
    for i in range(3):
        s, events, promoted = route_verification(s,report(False),False)
        assert promoted is None
        assert events[0]["kind"] == "rollback"
        assert s["artifacts"] == original
        assert s["finalArtifactId"] is None
        if i < 2:
            assert s["phase"] == "draft"
    assert s["status"] == "needs_review"
    assert s["draftRevision"] == 2

def test_polish_can_only_follow_verified_draft():
    s,_,_ = route_verification(state(),report(),False)
    assert s["phase"] == "polish"
    assert s["approvedDraftId"] == "draft"

def test_factual_change_in_polish_rolls_back_once():
    s = state()
    s.update(candidateId="candidate",approvedDraftId="draft")
    s,_,_ = route_verification(s,report(False),True)
    assert s["phase"] == "polish" and s["approvedDraftId"] == "draft"
    assert s["polishRevision"] == 1
    s,_,_ = route_verification(s,report(False),True)
    assert s["status"] == "needs_review" and s["finalArtifactId"] is None

def test_final_approval_is_new_immutable_version():
    s = state()
    s["candidateId"] = "candidate"
    s,_,promotion = route_verification(s,report(),True)
    assert s["status"] == "completed"
    assert promotion["approved"]
    assert promotion["id"] != "candidate"
    assert promotion["version"] == 2
    assert s["finalArtifactId"] == promotion["id"]

def test_failed_replacement_preserves_previous_final_pointer():
    s = state()
    s.update(finalArtifactId="previous-approved",draftRevision=2)
    s,_,_ = route_verification(s,report(False),False)
    assert s["finalArtifactId"] == "previous-approved"

def test_malformed_structured_output_is_rejected():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Verification.model_validate({"scores":{"accuracy":101},"claims":[]})
