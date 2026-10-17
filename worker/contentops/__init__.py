"""Relay Studio's four-agent worker."""
import os
from pathlib import Path

# CrewAI initializes its storage paths at import time. Keep local auxiliary files
# inside this project; Supabase remains the authoritative workflow store.
os.environ.setdefault('CREWAI_STORAGE_DIR', str(Path(__file__).resolve().parents[1] / '.state'))
os.environ.setdefault('CREWAI_TELEMETRY_ENABLED', 'false')
os.environ.setdefault('CREWAI_TRACING_ENABLED', 'false')
os.environ.setdefault('OTEL_SDK_DISABLED', 'true')
