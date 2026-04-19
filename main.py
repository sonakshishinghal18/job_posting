from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import anthropic
import os
import json
from dotenv import load_dotenv
from data import MOCK_JOBS

load_dotenv()

app = FastAPI(title="Job Platform API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# Resolve frontend/dist relative to repo root
# __file__ is at <repo>/backend/main.py, so go up one level to reach repo root
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Render clones into /opt/render/project/src — handle both local and Render paths
if not os.path.exists(os.path.join(BASE_DIR, "frontend")):
    BASE_DIR = os.path.join(BASE_DIR, "src")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend", "dist")

print(f"Looking for frontend at: {FRONTEND_DIR}")
print(f"Frontend exists: {os.path.exists(FRONTEND_DIR)}")


# ---------- Models ----------

class AISearchRequest(BaseModel):
    query: str

class JobPostRequest(BaseModel):
    title: str
    company: str
    field: str
    experience: str
    location: str
    job_type: str
    salary: str
    description: str
    source: str = "user"


# ---------- API Routes ----------

@app.get("/health")
def health():
    return {"status": "ok", "frontend_dir": FRONTEND_DIR, "frontend_exists": os.path.exists(FRONTEND_DIR)}


@app.get("/api/jobs")
def get_jobs(
    field: Optional[str] = Query(None),
    experience: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    job_type: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    sort: Optional[str] = Query("recent"),
):
    jobs = list(MOCK_JOBS)

    if field:
        fields = [f.strip() for f in field.split(",")]
        jobs = [j for j in jobs if j["field"] in fields]

    if experience:
        exps = [e.strip() for e in experience.split(",")]
        jobs = [j for j in jobs if j["experience"] in exps]

    if location:
        locs = [l.strip().lower() for l in location.split(",")]
        jobs = [j for j in jobs if any(l in j["location"].lower() for l in locs)]

    if job_type:
        types = [t.strip() for t in job_type.split(",")]
        jobs = [j for j in jobs if j["type"] in types]

    if source and source != "all":
        jobs = [j for j in jobs if j["source"] == source]

    if q:
        q_lower = q.lower()
        jobs = [
            j for j in jobs
            if q_lower in j["title"].lower()
            or q_lower in j["company"].lower()
            or q_lower in j["description"].lower()
            or q_lower in j["field"].lower()
        ]

    if sort == "salary":
        jobs.sort(key=lambda j: j.get("salary_sort", 0), reverse=True)
    else:
        jobs.sort(key=lambda j: j.get("days_ago", 99))

    return {"total": len(jobs), "jobs": jobs}


@app.post("/api/ai-search")
def ai_search(body: AISearchRequest):
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    system_prompt = """You are a job search assistant. The user will describe what kind of job they are looking for in natural language.
Your task is to extract structured filters AND generate a smart search summary.

Return ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "filters": {
    "field": ["Engineering"] or [],
    "experience": ["Junior","Mid","Senior"] or [],
    "location": ["Remote","Bengaluru"] or [],
    "job_type": ["Full-time","Contract","Freelance","Internship"] or []
  },
  "summary": "A one-sentence friendly description of what you searched for",
  "keywords": ["keyword1", "keyword2"]
}

Valid field values: Engineering, Design, AI/ML, Data, Marketing
Valid experience values: Junior, Mid, Senior
Valid location values: Remote, Hybrid, Bengaluru, On-site, (or any city name)
Valid job_type values: Full-time, Contract, Freelance, Internship"""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=512,
        system=system_prompt,
        messages=[{"role": "user", "content": body.query}],
    )

    raw = message.content[0].text.strip()

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="LLM returned invalid JSON")

    filters = parsed.get("filters", {})
    jobs = list(MOCK_JOBS)

    if filters.get("field"):
        jobs = [j for j in jobs if j["field"] in filters["field"]]
    if filters.get("experience"):
        jobs = [j for j in jobs if j["experience"] in filters["experience"]]
    if filters.get("location"):
        locs = [l.lower() for l in filters["location"]]
        jobs = [j for j in jobs if any(l in j["location"].lower() for l in locs)]
    if filters.get("job_type"):
        jobs = [j for j in jobs if j["type"] in filters["job_type"]]

    keywords = parsed.get("keywords", [])
    if keywords:
        def score(j):
            text = f"{j['title']} {j['company']} {j['description']}".lower()
            return sum(1 for k in keywords if k.lower() in text)
        jobs.sort(key=score, reverse=True)

    return {
        "summary": parsed.get("summary", ""),
        "filters_applied": filters,
        "total": len(jobs),
        "jobs": jobs,
    }


@app.post("/api/jobs", status_code=201)
def post_job(body: JobPostRequest):
    new_job = {
        "id": max(j["id"] for j in MOCK_JOBS) + 1,
        "title": body.title,
        "company": body.company,
        "field": body.field,
        "experience": body.experience,
        "location": body.location,
        "type": body.job_type,
        "salary": body.salary,
        "salary_sort": 0,
        "description": body.description,
        "source": "user",
        "days_ago": 0,
        "featured": False,
    }
    MOCK_JOBS.append(new_job)
    return {"message": "Job posted successfully", "job": new_job}


# ---------- Serve React frontend (must be last) ----------

if os.path.exists(FRONTEND_DIR):
    assets_dir = os.path.join(FRONTEND_DIR, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/")
    def serve_root():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        file_path = os.path.join(FRONTEND_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
else:
    @app.get("/")
    def serve_root_fallback():
        return {"error": f"Frontend not built. Expected at: {FRONTEND_DIR}"}
