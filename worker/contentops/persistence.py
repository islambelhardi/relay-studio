from copy import deepcopy
from typing import Any
from pydantic import BaseModel, PrivateAttr
from crewai.flow.persistence.base import FlowPersistence

class SupabasePersistence(FlowPersistence):
    """CrewAI persistence adapter with atomic artifact/event/checkpoint commits."""
    persistence_type: str = "supabase"
    _db: Any = PrivateAttr()
    _token: str = PrivateAttr()
    _revision: int = PrivateAttr()
    _previous: dict = PrivateAttr()
    _attempt: dict | None = PrivateAttr(default=None)

    def __init__(self, db, token: str, revision: int, state: dict):
        super().__init__()
        self._db, self._token, self._revision = db, token, revision
        self._previous = deepcopy(state)

    def init_db(self):
        # Schema is managed by the reviewed SQL migration, not worker startup.
        pass

    def stage_attempt(self, attempt: dict | None):
        self._attempt = attempt

    def save_state(self, flow_uuid: str, method_name: str, state_data: dict | BaseModel):
        state = state_data.model_dump(mode="json") if isinstance(state_data,BaseModel) else deepcopy(state_data)
        old_ids = {a["id"] for a in self._previous["artifacts"]}
        old_events = {e["id"] for e in self._previous["events"]}
        result = self._db.rpc("commit_content_step",{
            "p_run_id":flow_uuid,"p_token":self._token,"p_revision":self._revision,
            "p_step_key":method_name,"p_state":state,
            "p_artifacts":[a for a in state["artifacts"] if a["id"] not in old_ids],
            "p_attempt":self._attempt,
            "p_events":[e for e in state["events"] if e["id"] not in old_events],
        }).execute()
        self._revision = result.data
        self._previous = deepcopy(state)
        self._attempt = None

    def load_state(self, flow_uuid: str) -> dict | None:
        rows = self._db.table("runs").select("state,revision").eq("id",flow_uuid).execute().data
        if not rows:
            return None
        self._revision = rows[0]["revision"]
        self._previous = deepcopy(rows[0]["state"])
        return deepcopy(self._previous)
