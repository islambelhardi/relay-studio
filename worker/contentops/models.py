from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

class Source(StrictModel):
    id: str
    title: str
    url: str
    excerpt: str
    retrievedAt: str
    searchEntryPoint: str | None = None

class Research(StrictModel):
    markdown: str = Field(min_length=1)
    product_facts: list[str] = Field(min_length=1)
    search_queries: list[str]
    sources: list[Source]

class Article(StrictModel):
    title: str = Field(min_length=1)
    markdown: str = Field(min_length=1)

class Claim(StrictModel):
    text: str = Field(min_length=1)
    sourceIds: list[str]
    verdict: Literal["supported", "contradicted", "insufficient_evidence"]
    explanation: str = Field(min_length=1)

class Scores(StrictModel):
    accuracy: int = Field(ge=0, le=100)
    coverage: int = Field(ge=0, le=100)
    fidelity: int = Field(ge=0, le=100)

class Verification(StrictModel):
    scores: Scores
    claims: list[Claim] = Field(min_length=1)
    feedback: list[str]

class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    search_calls: int = 0
    cost_usd: float | None = None

def gate(report: Verification, source_ids: set[str]) -> bool:
    return (
        all(score >= 85 for score in report.scores.model_dump().values())
        and bool(report.claims)
        and all(c.verdict == "supported" and bool(c.sourceIds) and set(c.sourceIds).issubset(source_ids) for c in report.claims)
    )

def quality_score(scores: Scores) -> int:
    # Match JavaScript's Math.round for nonnegative rubric scores.
    return int(scores.accuracy * .4 + scores.coverage * .35 + scores.fidelity * .25 + .5)
