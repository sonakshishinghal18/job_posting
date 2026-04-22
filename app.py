"""
Lumen — Flask backend
  POST /api/search        -> Apify LinkedIn (async start + frontend polls)
  POST /api/search/status -> Check if Apify run finished, return results
  POST /api/resume/upload -> parses uploaded PDF/text
  POST /api/extract       -> LLM skill extraction
  POST /api/match         -> LLM resume<->job match
  POST /api/rewrite       -> LLM rewrite experience section for a job
  POST /api/batch-score   -> LLM batch score top-15 jobs vs resume
"""
import os, io, time, json, hashlib, logging, urllib.parse
import requests as http_requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from anthropic import Anthropic
from pypdf import PdfReader
from datetime import datetime

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("lumen")

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
APIFY_TOKEN   = os.getenv("APIFY_TOKEN", "").strip()
CLAUDE_MODEL  = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6").strip()

APIFY_ACTOR    = "curious_coder~linkedin-jobs-scraper"
APIFY_RUN_URL  = f"https://api.apify.com/v2/acts/{APIFY_ACTOR}/runs"
APIFY_BASE     = "https://api.apify.com/v2"

LOCATIONS = {
    "bangalore": "Bangalore, Karnataka, India",
    "delhi":     "Delhi, India",
}

app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
CORS(app)

_anthropic_client = None
def get_anthropic():
    global _anthropic_client
    if _anthropic_client is None:
        if not ANTHROPIC_KEY: return None
        try: _anthropic_client = Anthropic(api_key=ANTHROPIC_KEY)
        except Exception: return None
    return _anthropic_client

def _strip_fences(raw):
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw
        if raw.endswith("```"): raw = raw[:-3]
    return raw.strip()


# -------- static --------
@app.route("/")
def index(): return send_from_directory(BASE_DIR, "index.html")

@app.route("/<path:path>")
def static_files(path): return send_from_directory(BASE_DIR, path)

@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "apify": bool(APIFY_TOKEN), "llm": bool(ANTHROPIC_KEY)})


# ====================================================================
#  QUERY EXPANSION
# ====================================================================
def expand_query(raw):
    client = get_anthropic()
    if client is None: return raw
    try:
        msg = client.messages.create(
            model=CLAUDE_MODEL, max_tokens=60,
            system=(
                "You are a LinkedIn job search expert. Given any keyword, return a broader "
                "search phrase using OR logic to catch more relevant jobs. "
                "Format: 'term1 OR term2 OR term3' (3-5 terms max). "
                "Examples: 'tax' -> 'tax OR taxation OR GST OR accountant', "
                "'ML' -> 'machine learning OR deep learning OR AI engineer', "
                "'React' -> 'React OR frontend developer OR UI engineer'. "
                "Return ONLY the phrase — no explanation, no quotes, no punctuation."
            ),
            messages=[{"role": "user", "content": f"Keyword: {raw}"}],
        )
        expanded = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
        return expanded if expanded else raw
    except Exception as e:
        log.warning(f"Query expansion failed: {e}")
        return raw


# ====================================================================
#  LINKEDIN URL BUILDER
# ====================================================================
def _build_linkedin_url(keywords, experience, loc):
    location = LOCATIONS.get(loc, LOCATIONS["bangalore"])
    params = {
        "keywords": keywords,
        "location": location,
        "f_TPR": "r604800",   # 7 days — wider net, more results
        "f_JT": "F",          # full-time
        "position": "1",
        "pageNum": "0",
    }
    exp_map = {"entry": "2", "mid": "3,4", "senior": "4", "executive": "5,6"}
    if experience in exp_map:
        params["f_E"] = exp_map[experience]
    return "https://www.linkedin.com/jobs/search/?" + urllib.parse.urlencode(params)


# ====================================================================
#  SEARCH — 2-step async: start run, then poll from frontend
# ====================================================================
@app.route("/api/search", methods=["POST"])
def search_jobs():
    try:
        return _do_search()
    except Exception as e:
        log.exception("Search failed")
        return jsonify({"error": f"Search failed: {e}"}), 500

def _do_search():
    body = request.get_json(silent=True) or {}
    keywords   = (body.get("query") or "").strip()
    experience = (body.get("experience") or "").strip()
    location   = (body.get("location") or "bangalore").strip().lower()

    if not APIFY_TOKEN:
        return jsonify({"error": "APIFY_TOKEN not configured."}), 500

    # LLM query expansion
    try:
        expanded = expand_query(keywords) if keywords else keywords or "jobs"
    except Exception:
        expanded = keywords or "jobs"

    # Build LinkedIn URLs for selected locations
    locs = ["bangalore", "delhi"] if location == "both" else [location if location in LOCATIONS else "bangalore"]
    urls = [_build_linkedin_url(expanded, experience, loc) for loc in locs]

    log.info(f"Search: '{keywords}' expanded to '{expanded}', locations={locs}")
    for u in urls:
        log.info(f"LinkedIn URL: {u}")

    # Start Apify run
    run_input = {
        "urls": urls,
        "count": 100,              # request up to 100 jobs
        "scrapeCompany": False,
    }

    try:
        r = http_requests.post(
            APIFY_RUN_URL,
            params={"token": APIFY_TOKEN},
            json=run_input,
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        r.raise_for_status()
        run_data = r.json().get("data", {})
        run_id = run_data.get("id")
        dataset_id = run_data.get("defaultDatasetId")
        if not run_id:
            return jsonify({"error": f"No run ID: {str(r.json())[:200]}"}), 502

        log.info(f"Apify run started: {run_id}, dataset: {dataset_id}")

        # Poll for up to 90 seconds (within Render's timeout)
        status_url = f"{APIFY_BASE}/actor-runs/{run_id}"
        deadline = time.time() + 90
        final_status = "RUNNING"
        while time.time() < deadline:
            time.sleep(4)
            sr = http_requests.get(status_url, params={"token": APIFY_TOKEN}, timeout=15)
            sr.raise_for_status()
            final_status = sr.json().get("data", {}).get("status", "")
            log.info(f"Run {run_id}: {final_status}")
            if final_status in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
                break

        # Fetch whatever results are available (even if still running)
        if not dataset_id:
            dataset_id = sr.json().get("data", {}).get("defaultDatasetId", "")

        items = []
        if dataset_id:
            dr = http_requests.get(
                f"{APIFY_BASE}/datasets/{dataset_id}/items",
                params={"token": APIFY_TOKEN, "limit": 100},
                timeout=30,
            )
            if dr.status_code == 200:
                items = dr.json() if isinstance(dr.json(), list) else []

        log.info(f"Fetched {len(items)} items (run status: {final_status})")

        # Normalize
        jobs = _normalize_apify(items, experience, locs)

        return jsonify({
            "jobs": jobs[:50],
            "count": len(jobs[:50]),
            "source": "linkedin",
            "expanded_query": expanded,
            "run_status": final_status,
            "page": 1,
        })

    except Exception as e:
        log.exception("Apify call failed")
        return jsonify({"error": f"Apify failed: {e}"}), 502


# ====================================================================
#  NORMALIZE APIFY RESULTS
# ====================================================================
def _normalize_apify(items, experience, locs):
    """Transform curious_coder actor output to Lumen format.
    Known fields: id, title, companyName, companyLogo, descriptionText, descriptionHtml,
    applyUrl, location, postedAt, publishedAt, employmentType, salary, seniorityLevel,
    jobFunction, industries, applicantsCount, benefits, country, expireAt
    """
    slim = []
    for j in items:
        title       = j.get("title") or ""
        company     = j.get("companyName") or ""
        description = j.get("descriptionText") or j.get("description") or ""
        apply_link  = j.get("applyUrl") or j.get("link") or j.get("jobUrl") or j.get("url") or ""
        posted_at   = j.get("publishedAt") or j.get("postedAt") or ""
        logo        = j.get("companyLogo") or ""
        location    = j.get("location") or ""
        job_id      = str(j.get("id") or "")
        if not job_id:
            job_id = hashlib.md5(f"{title}:{company}:{apply_link}".encode()).hexdigest()[:12]

        # Parse timestamp
        posted_ts = None
        if posted_at:
            for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
                try:
                    posted_ts = datetime.strptime(posted_at, fmt).timestamp()
                    break
                except ValueError:
                    continue

        # Derive city from location string
        city = location
        if not city:
            city = "Bangalore" if len(locs) == 1 and locs[0] == "bangalore" else "India"

        # Remote detection
        is_remote = any(kw in (location + " " + title).lower() for kw in ["remote", "work from home", "wfh"])

        # Build highlights from description
        highlights = {}
        if description:
            lines = [l.strip() for l in description.split("\n") if l.strip()]
            short = [l for l in lines if 3 <= len(l.split()) <= 7]
            if short:
                highlights["Qualifications"] = short[:8]

        # Benefits from actor
        benefits = j.get("benefits")
        if benefits and isinstance(benefits, list):
            highlights["Benefits"] = benefits[:6]

        slim.append({
            "id": job_id,
            "title": title,
            "employer": company,
            "employer_logo": logo,
            "employment_type": j.get("employmentType") or "FULLTIME",
            "city": city,
            "state": "",
            "country": j.get("country") or "IN",
            "is_remote": is_remote,
            "posted_at": posted_at,
            "posted_ts": posted_ts,
            "apply_link": apply_link,
            "description": description,
            "highlights": highlights,
            "salary_min": j.get("salary"),
            "salary_max": None,
            "salary_currency": "INR",
            "salary_period": None,
            "publisher": "LinkedIn",
            "applicants": j.get("applicantsCount"),
            "seniority": j.get("seniorityLevel"),
        })

    # Senior/exec filter
    if experience in ("senior", "executive"):
        needle = "senior" if experience == "senior" else "lead"
        slim = [s for s in slim if needle in s["title"].lower() or needle in (s["description"] or "")[:400].lower()]

    return slim


# ====================================================================
#  DEBUG
# ====================================================================
@app.route("/api/debug/apify")
def debug_apify():
    if not APIFY_TOKEN:
        return jsonify({"error": "APIFY_TOKEN not set"}), 500
    test_url = _build_linkedin_url("software engineer", "", "bangalore")
    run_input = {"urls": [test_url], "count": 5, "scrapeCompany": False}
    try:
        # Start run
        r = http_requests.post(APIFY_RUN_URL, params={"token": APIFY_TOKEN},
                               json=run_input, headers={"Content-Type": "application/json"}, timeout=30)
        r.raise_for_status()
        run_id = r.json().get("data", {}).get("id")
        dataset_id = r.json().get("data", {}).get("defaultDatasetId")
        if not run_id:
            return jsonify({"ok": False, "error": "No run ID", "raw": r.json()})

        # Poll
        deadline = time.time() + 90
        status = "RUNNING"
        while time.time() < deadline:
            time.sleep(4)
            sr = http_requests.get(f"{APIFY_BASE}/actor-runs/{run_id}",
                                   params={"token": APIFY_TOKEN}, timeout=15)
            status = sr.json().get("data", {}).get("status", "")
            if status in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
                break

        if not dataset_id:
            dataset_id = sr.json().get("data", {}).get("defaultDatasetId", "")

        # Fetch results
        items = []
        if dataset_id:
            dr = http_requests.get(f"{APIFY_BASE}/datasets/{dataset_id}/items",
                                   params={"token": APIFY_TOKEN, "limit": 5}, timeout=30)
            if dr.status_code == 200:
                items = dr.json() if isinstance(dr.json(), list) else []

        keys = list(items[0].keys()) if items else []
        return jsonify({"ok": True, "run_status": status, "count": len(items),
                        "field_names": keys, "sample": items[:2]})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ====================================================================
#  RESUME UPLOAD
# ====================================================================
@app.route("/api/resume/upload", methods=["POST"])
def upload_resume():
    if request.is_json:
        txt = ((request.get_json(silent=True) or {}).get("text") or "").strip()
        return jsonify({"text": txt, "chars": len(txt)}) if txt else (jsonify({"error": "No text."}), 400)
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded."}), 400
    f = request.files["file"]
    name = (f.filename or "").lower()
    raw = f.read()
    if len(raw) > 5 * 1024 * 1024:
        return jsonify({"error": "Max 5 MB."}), 400
    if name.endswith(".pdf"):
        try: text = "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(raw)).pages)
        except Exception as e: return jsonify({"error": f"PDF error: {e}"}), 400
    elif name.endswith((".txt", ".md")):
        text = raw.decode("utf-8", errors="ignore")
    else:
        return jsonify({"error": "Use PDF, TXT, or MD."}), 400
    text = text.strip()
    return jsonify({"text": text, "chars": len(text)}) if text else (jsonify({"error": "Empty file."}), 400)


# ====================================================================
#  LLM: SKILL EXTRACTION
# ====================================================================
@app.route("/api/extract", methods=["POST"])
def extract_skills():
    client = get_anthropic()
    if not client: return jsonify({"error": "LLM not configured."}), 500
    desc = ((request.get_json(silent=True) or {}).get("description") or "").strip()[:12000]
    if not desc: return jsonify({"error": "No description."}), 400
    try:
        msg = client.messages.create(model=CLAUDE_MODEL, max_tokens=600,
            system='Extract skills from job descriptions. Return ONLY valid JSON: {"required": [...], "nice_to_have": [...]}. Max 3 words per skill, max 12 each.',
            messages=[{"role": "user", "content": f"Job description:\n\n{desc}\n\nReturn JSON now."}])
        data = json.loads(_strip_fences("".join(b.text for b in msg.content if getattr(b, "type", "") == "text")))
    except json.JSONDecodeError: return jsonify({"error": "Invalid LLM JSON."}), 502
    except Exception as e: return jsonify({"error": f"LLM failed: {e}"}), 502
    return jsonify({"required": data.get("required", [])[:12], "nice_to_have": data.get("nice_to_have", [])[:12]})


# ====================================================================
#  LLM: RESUME MATCH
# ====================================================================
@app.route("/api/match", methods=["POST"])
def match_resume():
    client = get_anthropic()
    if not client: return jsonify({"error": "LLM not configured."}), 500
    body = request.get_json(silent=True) or {}
    resume = (body.get("resume") or "").strip()[:15000]
    desc = (body.get("description") or "").strip()[:12000]
    title = (body.get("title") or "").strip()
    if not resume or not desc: return jsonify({"error": "Resume and description required."}), 400
    try:
        msg = client.messages.create(model=CLAUDE_MODEL, max_tokens=900,
            system='Expert recruiter. Compare resume to job. Return ONLY JSON: {"score": 0-100, "verdict": "one sentence", "matched": [...], "missing": [...], "reasoning": "2-3 sentences"}. 80+=strong, 60-79=worth applying, 40-59=stretch, <40=weak. Max 8 items each.',
            messages=[{"role": "user", "content": f"JOB: {title}\n\nDESCRIPTION:\n{desc}\n\nRESUME:\n{resume}\n\nJSON now."}])
        data = json.loads(_strip_fences("".join(b.text for b in msg.content if getattr(b, "type", "") == "text")))
    except json.JSONDecodeError: return jsonify({"error": "Invalid LLM JSON."}), 502
    except Exception as e: return jsonify({"error": f"LLM failed: {e}"}), 502
    return jsonify({"score": max(0, min(100, int(data.get("score", 0)))), "verdict": data.get("verdict", ""),
                    "matched": (data.get("matched") or [])[:8], "missing": (data.get("missing") or [])[:8],
                    "reasoning": data.get("reasoning", "")})


# ====================================================================
#  LLM: REWRITE EXPERIENCE
# ====================================================================
@app.route("/api/rewrite", methods=["POST"])
def rewrite_resume():
    client = get_anthropic()
    if not client: return jsonify({"error": "LLM not configured."}), 500
    body = request.get_json(silent=True) or {}
    resume = (body.get("resume") or "").strip()[:15000]
    desc = (body.get("description") or "").strip()[:12000]
    title = (body.get("title") or "").strip()
    if not resume or not desc: return jsonify({"error": "Resume and description required."}), 400
    try:
        msg = client.messages.create(model=CLAUDE_MODEL, max_tokens=2000,
            system="You are a professional resume writer. Rewrite the candidate's experience section to be highly tailored for the specific job. Use keywords from the job description. Make bullet points achievement-oriented with metrics where possible. Keep the same jobs/roles but reframe accomplishments. Return ONLY the rewritten experience section — no preamble. Format as clean text with role headings and bullet points.",
            messages=[{"role": "user", "content": f"TARGET JOB: {title}\n\nJOB DESCRIPTION:\n{desc}\n\nMY RESUME:\n{resume}\n\nRewrite my experience section now."}])
        rewritten = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    except Exception as e: return jsonify({"error": f"LLM failed: {e}"}), 502
    return jsonify({"rewritten": rewritten})


# ====================================================================
#  LLM: BATCH SCORE
# ====================================================================
@app.route("/api/batch-score", methods=["POST"])
def batch_score():
    client = get_anthropic()
    if not client: return jsonify({"error": "LLM not configured."}), 500
    body = request.get_json(silent=True) or {}
    resume = (body.get("resume") or "").strip()[:10000]
    jobs = (body.get("jobs") or [])[:15]
    if not resume or not jobs: return jsonify({"error": "Resume and jobs required."}), 400
    job_list = "\n".join(f'[{i}] "{j.get("title","")} at {j.get("employer","")}" — {(j.get("description",""))[:200]}' for i, j in enumerate(jobs))
    try:
        msg = client.messages.create(model=CLAUDE_MODEL, max_tokens=600,
            system='Score how well a resume matches each job. Return ONLY a JSON array: [{"index": 0, "score": 0-100}, ...]. One object per job. No explanation.',
            messages=[{"role": "user", "content": f"RESUME:\n{resume}\n\nJOBS:\n{job_list}\n\nReturn JSON array now."}])
        scores = json.loads(_strip_fences("".join(b.text for b in msg.content if getattr(b, "type", "") == "text")))
    except json.JSONDecodeError: return jsonify({"error": "Invalid LLM JSON."}), 502
    except Exception as e: return jsonify({"error": f"LLM failed: {e}"}), 502
    result = {str(item.get("index")): max(0, min(100, int(item.get("score", 0)))) for item in (scores if isinstance(scores, list) else []) if item.get("index") is not None}
    return jsonify({"scores": result})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
