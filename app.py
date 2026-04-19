"""
Lumen — Flask backend
Endpoints:
  GET  /                  -> serves frontend
  POST /api/search        -> proxies JSearch (40 results cap, Bangalore, FT, <=48h)
  POST /api/resume/upload -> parses uploaded PDF/text, returns plaintext
  POST /api/extract       -> LLM skill extraction for one job description
  POST /api/match         -> LLM resume<->job match (score + reasoning + skills)
"""
import os
import io
import time
import json
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from anthropic import Anthropic
from pypdf import PdfReader

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

RAPIDAPI_KEY    = os.getenv("RAPIDAPI_KEY", "").strip()
ANTHROPIC_KEY   = os.getenv("ANTHROPIC_API_KEY", "").strip()
CLAUDE_MODEL    = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6").strip()

RAPIDAPI_HOST = "jsearch.p.rapidapi.com"
JSEARCH_URL   = f"https://{RAPIDAPI_HOST}/search"

app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
CORS(app)

# Anthropic client — lazy init so app still boots without the key
_anthropic_client = None
def get_anthropic():
    global _anthropic_client
    if _anthropic_client is None:
        if not ANTHROPIC_KEY:
            return None
        _anthropic_client = Anthropic(api_key=ANTHROPIC_KEY)
    return _anthropic_client


# ---------------- static frontend ----------------
@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(BASE_DIR, path)


# ---------------- health check (Render uses this) ----------------
@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "jsearch_configured": bool(RAPIDAPI_KEY),
        "llm_configured": bool(ANTHROPIC_KEY),
        "model": CLAUDE_MODEL,
    })



# ---------------- query expansion ----------------
def expand_query(raw: str) -> str:
    """Use Claude to expand a short/vague keyword into a richer job search phrase.
    Falls back to the original keyword if LLM is unavailable or fails.
    e.g. "Tax"       -> "taxation finance GST accountant"
         "ML"        -> "machine learning AI deep learning engineer"
         "React dev" -> "React frontend developer JavaScript"
    """
    client = get_anthropic()
    if client is None:
        return raw

    system = (
        "You are a job search query optimizer. "
        "Given a short or vague keyword, return a concise expanded search phrase "
        "(4-8 words) that will find the most relevant job postings. "
        "Include common synonyms, related roles, and relevant skills. "
        "Return ONLY the expanded phrase — no explanation, no punctuation, no quotes."
    )
    try:
        msg = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=40,
            system=system,
            messages=[{"role": "user", "content": f"Keyword: {raw}"}],
        )
        expanded = "".join(
            b.text for b in msg.content if getattr(b, "type", "") == "text"
        ).strip()
        return expanded if expanded else raw
    except Exception:
        return raw  # graceful fallback — never break search


# ---------------- /api/search ----------------
@app.route("/api/search", methods=["POST"])
def search_jobs():
    if not RAPIDAPI_KEY:
        return jsonify({"error": "RAPIDAPI_KEY is not set on the server."}), 500

    body = request.get_json(silent=True) or {}
    keywords   = (body.get("query") or "").strip()
    experience = (body.get("experience") or "").strip()
    page       = int(body.get("page") or 1)

    # Locked filters
    location         = "Bangalore, India"
    employment_types = "FULLTIME"
    date_posted      = "3days"  # closest native option; trimmed to <=48h below

    # LLM query expansion — expand short/vague keywords into richer job search terms
    expanded_keywords = expand_query(keywords) if keywords else "jobs"
    query_string = expanded_keywords + f" in {location}"

    params = {
        "query": query_string,
        "page": str(page),
        "num_pages": "1",
        "num_results": "40",
        "country": "in",
        "date_posted": date_posted,
        "employment_types": employment_types,
    }

    exp_map = {
        "entry": "under_3_years_experience",
        "mid": "more_than_3_years_experience",
        "senior": "more_than_3_years_experience",
        "executive": "more_than_3_years_experience",
    }
    if experience in exp_map:
        params["job_requirements"] = exp_map[experience]

    headers = {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": RAPIDAPI_HOST,
    }

    try:
        r = requests.get(JSEARCH_URL, headers=headers, params=params, timeout=25)
        r.raise_for_status()
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Upstream request failed: {e}"}), 502

    payload = r.json()
    jobs = payload.get("data", []) or []

    # <= 48h filter
    now = time.time()
    two_days = 48 * 3600

    def within_48h(job):
        ts = job.get("job_posted_at_timestamp")
        if not ts:
            return True
        try:
            return (now - float(ts)) <= two_days
        except (TypeError, ValueError):
            return True

    jobs = [j for j in jobs if within_48h(j)]

    # Senior/executive keyword refinement
    if experience in ("senior", "executive"):
        needle = "senior" if experience == "senior" else "lead"
        jobs = [
            j for j in jobs
            if needle in (j.get("job_title") or "").lower()
            or needle in (j.get("job_description") or "").lower()[:400]
        ]

    slim = []
    for j in jobs:
        slim.append({
            "id": j.get("job_id"),
            "title": j.get("job_title"),
            "employer": j.get("employer_name"),
            "employer_logo": j.get("employer_logo"),
            "employment_type": j.get("job_employment_type"),
            "city": j.get("job_city"),
            "state": j.get("job_state"),
            "country": j.get("job_country"),
            "is_remote": j.get("job_is_remote"),
            "posted_at": j.get("job_posted_at_datetime_utc"),
            "posted_ts": j.get("job_posted_at_timestamp"),
            "apply_link": j.get("job_apply_link"),
            "description": j.get("job_description"),
            "highlights": j.get("job_highlights") or {},
            "salary_min": j.get("job_min_salary"),
            "salary_max": j.get("job_max_salary"),
            "salary_currency": j.get("job_salary_currency"),
            "salary_period": j.get("job_salary_period"),
            "publisher": j.get("job_publisher"),
        })

    return jsonify({"jobs": slim, "page": page, "count": len(slim), "expanded_query": expanded_keywords})


# ---------------- /api/resume/upload ----------------
@app.route("/api/resume/upload", methods=["POST"])
def upload_resume():
    """Accepts either a multipart file (PDF or txt) or raw JSON {text: '...'}.
    Returns the plaintext extracted from it. The client persists the text in
    localStorage — the server does not store anything.
    """
    # JSON path — user pasted text directly
    if request.is_json:
        data = request.get_json(silent=True) or {}
        txt = (data.get("text") or "").strip()
        if not txt:
            return jsonify({"error": "No resume text provided."}), 400
        return jsonify({"text": txt, "chars": len(txt)})

    # Multipart path
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded."}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "Empty filename."}), 400

    name = f.filename.lower()
    raw = f.read()
    if len(raw) > 5 * 1024 * 1024:
        return jsonify({"error": "File too large (max 5 MB)."}), 400

    if name.endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(raw))
            text = "\n".join((p.extract_text() or "") for p in reader.pages)
        except Exception as e:
            return jsonify({"error": f"Could not read PDF: {e}"}), 400
    elif name.endswith(".txt") or name.endswith(".md"):
        try:
            text = raw.decode("utf-8", errors="ignore")
        except Exception as e:
            return jsonify({"error": f"Could not read text: {e}"}), 400
    else:
        return jsonify({"error": "Unsupported file type. Use PDF, TXT, or MD."}), 400

    text = text.strip()
    if not text:
        return jsonify({"error": "Could not extract any text from this file."}), 400

    return jsonify({"text": text, "chars": len(text)})


# ---------------- /api/extract ----------------
@app.route("/api/extract", methods=["POST"])
def extract_skills():
    """LLM skill extraction for a single job description.
    Request body: { "description": "..." }
    Returns: { "required": [...], "nice_to_have": [...] }
    """
    client = get_anthropic()
    if client is None:
        return jsonify({"error": "ANTHROPIC_API_KEY is not set on the server."}), 500

    body = request.get_json(silent=True) or {}
    description = (body.get("description") or "").strip()
    if not description:
        return jsonify({"error": "No description provided."}), 400

    # Trim very long descriptions
    if len(description) > 12000:
        description = description[:12000]

    system_prompt = (
        "You extract skills from job descriptions. Return ONLY valid JSON — no prose, "
        "no markdown fences. Schema: "
        '{"required": ["skill", ...], "nice_to_have": ["skill", ...]}. '
        "Keep each skill under 3 words. Deduplicate. Cap each list at 12 items."
    )

    try:
        msg = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=600,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": f"Job description:\n\n{description}\n\nReturn the JSON now.",
            }],
        )
        raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
        # Strip accidental code fences
        if raw.startswith("```"):
            raw = raw.strip("`")
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw
            if raw.endswith("```"):
                raw = raw[:-3]
        data = json.loads(raw)
    except json.JSONDecodeError:
        return jsonify({"error": "LLM returned invalid JSON."}), 502
    except Exception as e:
        return jsonify({"error": f"LLM call failed: {e}"}), 502

    return jsonify({
        "required": data.get("required", [])[:12],
        "nice_to_have": data.get("nice_to_have", [])[:12],
    })


# ---------------- /api/match ----------------
@app.route("/api/match", methods=["POST"])
def match_resume():
    """Compare resume against a job.
    Request body: { "resume": "...", "description": "...", "title": "..." }
    Returns: { "score": 0-100, "verdict": "...", "matched": [...], "missing": [...], "reasoning": "..." }
    """
    client = get_anthropic()
    if client is None:
        return jsonify({"error": "ANTHROPIC_API_KEY is not set on the server."}), 500

    body = request.get_json(silent=True) or {}
    resume      = (body.get("resume") or "").strip()
    description = (body.get("description") or "").strip()
    title       = (body.get("title") or "").strip()

    if not resume:
        return jsonify({"error": "No resume provided."}), 400
    if not description:
        return jsonify({"error": "No job description provided."}), 400

    if len(resume) > 15000:
        resume = resume[:15000]
    if len(description) > 12000:
        description = description[:12000]

    system_prompt = (
        "You are an expert technical recruiter. Compare a candidate's resume to a job. "
        "Return ONLY valid JSON — no prose, no markdown fences. Schema: "
        '{"score": <int 0-100>, "verdict": "<one sentence>", '
        '"matched": ["skill/experience", ...], "missing": ["skill/experience", ...], '
        '"reasoning": "<2-3 sentences>"}. '
        "Score honestly: 80+ = strong match, 60-79 = worth applying, 40-59 = stretch, <40 = weak fit. "
        "Cap matched and missing at 8 items each. Keep each item short."
    )

    user_prompt = (
        f"JOB TITLE: {title}\n\n"
        f"JOB DESCRIPTION:\n{description}\n\n"
        f"CANDIDATE RESUME:\n{resume}\n\n"
        "Return the JSON now."
    )

    try:
        msg = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=900,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw
            if raw.endswith("```"):
                raw = raw[:-3]
        data = json.loads(raw)
    except json.JSONDecodeError:
        return jsonify({"error": "LLM returned invalid JSON."}), 502
    except Exception as e:
        return jsonify({"error": f"LLM call failed: {e}"}), 502

    score = int(data.get("score", 0))
    score = max(0, min(100, score))

    return jsonify({
        "score": score,
        "verdict": data.get("verdict", ""),
        "matched": (data.get("matched") or [])[:8],
        "missing": (data.get("missing") or [])[:8],
        "reasoning": data.get("reasoning", ""),
    })


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
