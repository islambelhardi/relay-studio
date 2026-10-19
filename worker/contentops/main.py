"""Run from worker/: uv run python -m contentops.main"""
import os
from pathlib import Path
import sys
import threading
import time
from uuid import uuid4
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env.local")
os.environ.setdefault("CREWAI_TELEMETRY_ENABLED","false")
os.environ.setdefault("OTEL_SDK_DISABLED","true")
os.environ.setdefault("CREWAI_TRACING_ENABLED","false")

from supabase import create_client
from .engine import TERMINAL

def require_environment():
    missing = [k for k in ("NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY") if not os.getenv(k)]
    if not any(os.getenv(k, "").strip() for k in ("OPENAI_API_KEY", "GEMINI_API_KEY")):
        missing.append("OPENAI_API_KEY or GEMINI_API_KEY")
    if missing:
        print("Live worker is not configured. Add these names to .env.local: " + ", ".join(missing),flush=True)
        return False
    return True

class LeaseHeartbeat:
    def __init__(self,db,run_id,token,message_id):
        self.db,self.run_id,self.token,self.message_id = db,run_id,token,message_id
        self.stopped = threading.Event()
        self.valid = threading.Event()
        self.valid.set()
        self.thread = threading.Thread(target=self.loop,daemon=True)
    def loop(self):
        while not self.stopped.wait(15):
            try:
                ok = self.db.rpc("heartbeat_content_run",{"p_run_id":self.run_id,"p_token":self.token,"p_message_id":self.message_id}).execute().data
                if not ok:
                    self.valid.clear()
                    return
            except Exception:
                self.valid.clear()
                return
    def __enter__(self):
        self.thread.start()
        return self
    def __exit__(self,*_):
        self.stopped.set()
        self.thread.join(timeout=3)

def process_job(db,job):
    from .flow import ContentFlow
    from .persistence import SupabasePersistence

    run_id, token = job["message"]["run_id"], str(uuid4())
    claim = db.rpc("claim_content_run",{"p_run_id":run_id,"p_token":token}).execute().data
    if not claim:
        return
    try:
        if claim["state"]["status"] in TERMINAL:
            db.rpc("archive_content_job",{"p_message_id":job["msg_id"]}).execute()
            return
        # Separate connection object for heartbeat calls, avoiding shared-client
        # HTTP state while an agent is performing long provider requests.
        heartbeat_db = create_client(os.environ["NEXT_PUBLIC_SUPABASE_URL"],os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        with LeaseHeartbeat(heartbeat_db,run_id,token,job["msg_id"]) as lease:
            store = SupabasePersistence(db,token,claim["revision"],claim["state"])
            flow = ContentFlow(db,store,claim["state"],lease.valid.is_set)
            flow.kickoff()
            if lease.valid.is_set() and flow.state["status"] in TERMINAL:
                db.rpc("archive_content_job",{"p_message_id":job["msg_id"]}).execute()
    finally:
        db.rpc("release_content_run",{"p_run_id":run_id,"p_token":token}).execute()

def main():
    if not require_environment():
        return 2
    db = create_client(os.environ["NEXT_PUBLIC_SUPABASE_URL"],os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    print("Relay worker ready. Listening for content runs. Ctrl+C to stop.",flush=True)
    while True:
        try:
            jobs = db.rpc("read_content_job").execute().data or []
            for job in jobs:
                print(f"Processing run {job['message']['run_id']}",flush=True)
                process_job(db,job)
            if not jobs:
                time.sleep(2)
        except KeyboardInterrupt:
            print("Worker stopped. Unfinished work will resume from its last committed stage.",flush=True)
            return 0
        except Exception as exc:
            # Log the exception class only; provider messages may contain input.
            print(f"Worker infrastructure error ({type(exc).__name__}). Job retained for checkpoint recovery. Check connection/migration; retrying in 5s.",flush=True)
            time.sleep(5)

if __name__ == "__main__":
    sys.exit(main())
