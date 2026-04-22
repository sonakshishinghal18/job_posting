"""
Lumen — Flask backend
  POST /api/search        -> Apify LinkedIn primary, JSearch fallback
  POST /api/resume/upload -> parses uploaded PDF/text
  POST /api/extract       -> LLM skill extraction
  POST /api/match         -> LLM resume<->job match
  POST /api/rewrite       -> LLM rewrite experience section for a job
  POST /api/batch-score   -> LLM batch score top-15 jobs vs resume
"""
import os, io, time, json, hashlib, logging
import requests as http_requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from anthropic import Anthropic
from pypdf import PdfReader

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("lumen")

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

RAPIDAPI_KEY  = os.getenv("RAPIDAPI_KEY", "").strip()
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
APIFY_TOKEN   = os.getenv("APIFY_TOKEN", "").strip()
CLAUDE_MODEL  = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6").strip()

RAPIDAPI_HOST = "jsearch.p.rapidapi.com"
JSEARCH_URL   = f"https://{RAPIDAPI_HOST}/search"
APIFY_ACTOR   = "bebity~linkedin-jobs-scraper"
APIFY_URL     = f"https://api.apify.com/v2/acts/{APIFY_ACTOR}/run-sync-get-dataset-items"

# Location configs
LOCATIONS = {
    "bangalore": {"apify": "BANGALORE", "jsearch": "Bangalore, India", "country": "in"},
    "delhi":     {"apify": "DELHI NCR",  "jsearch": "Delhi NCR, India",  "country": "in"},
}

app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
CORS(app)

_anthropic_client = None
def get_anthropic():
    global _anthropic_client
    if _anthropic_client is None:
        if not ANTHROPIC_KEY:
            return None
        try:
            _anthropic_client = Anthropic(api_key=ANTHROPIC_KEY)
        except Exception:
            return None
    return _anthropic_client

def _strip_fences(raw):
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw
        if raw.endswith("```"):
            raw = raw[:-3]
    return raw.strip()


# -------- static --------
@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(BASE_DIR, path)

@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "apify": bool(APIFY_TOKEN), "jsearch": bool(RAPIDAPI_KEY), "llm": bool(ANTHROPIC_KEY)})


# ====================================================================
#  QUERY EXPANSION
# ====================================================================
def expand_query(raw):
    client = get_anthropic()
    if client is None:
        return raw
    try:
        msg = client.messages.create(
            model=CLAUDE_MODEL, max_tokens=40,
            system="You are a job search query optimizer. Given a short keyword, return a concise expanded phrase (4-8 words) with synonyms and related roles. Return ONLY the phrase — no explanation, no quotes.",
            messages=[{"role": "user", "content": f"Keyword: {raw}"}],
        )
        expanded = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
        return expanded if expanded else raw
    except Exception as e:
        log.warning(f"Query expansion failed: {e}")
        return raw


# ====================================================================
#  SEARCH
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
    page       = int(body.get("page") or 1)

    try:
        expanded_keywords = expand_query(keywords) if keywords else keywords or "jobs"
    except Exception:
        expanded_keywords = keywords or "jobs"

    # Determine which locations to search
    if location == "both":
        locs = ["bangalore", "delhi"]
    elif location in LOCATIONS:
        locs = [location]
    else:
        locs = ["bangalore"]

    all_jobs = []

    for loc in locs:
        # --- Apify primary ---
        if APIFY_TOKEN:
            jobs, err = _fetch_apify(expanded_keywords, experience, loc)
            if jobs:
                all_jobs.extend(_normalize_apify(jobs, experience, loc))
                continue
            if err:
                log.warning(f"Apify ({loc}): {err}")

        # --- JSearch fallback ---
        if RAPIDAPI_KEY:
            jobs, err = _fetch_jsearch(expanded_keywords, experience, page, loc)
            if jobs:
                all_jobs.extend(_normalize_jsearch(jobs, experience))
                continue
            if err:
                log.warning(f"JSearch ({loc}): {err}")

    if not APIFY_TOKEN and not RAPIDAPI_KEY:
        return jsonify({"error": "No job API configured."}), 500

    # Cap at 50
    all_jobs = all_jobs[:50]
    source = "linkedin" if APIFY_TOKEN else "jsearch"

    return jsonify({
        "jobs": all_jobs,
        "page": page,
        "count": len(all_jobs),
        "source": source,
        "expanded_query": expanded_keywords,
    })


# ------------------------------------------------------------------
#  Apify
# ------------------------------------------------------------------
def _fetch_apify(keywords, experience, loc):
    loc_cfg = LOCATIONS.get(loc, LOCATIONS["bangalore"])
    run_input = {
        "title": keywords,
        "location": loc_cfg["apify"],
        "contractType": "F",
        "publishedAt": "r172800",
        "rows": 50,
        "proxy": {"useApifyProxy": True, "apifyProxyGroups": ["RESIDENTIAL"]},
    }
    exp_map = {"entry": "2", "mid": "4", "senior": "4", "executive": "5"}
    if experience in exp_map:
        run_input["experienceLevel"] = exp_map[experience]
    try:
        log.info(f"Apify: '{keywords}' in {loc_cfg['apify']}")
        r = http_requests.post(APIFY_URL, params={"token": APIFY_TOKEN}, json=run_input,
                               headers={"Content-Type": "application/json"}, timeout=120)
        r.raise_for_status()
        jobs = r.json()
        return (jobs, None) if isinstance(jobs, list) else ([], "Bad format")
    except Exception as e:
        return [], str(e)

def _normalize_apify(jobs, experience, loc):
    slim = []
    for j in jobs:
        title = j.get("title") or j.get("jobTitle") or ""
        company = j.get("companyName") or j.get("company") or ""
        description = j.get("description") or j.get("descriptionText") or ""
        apply_link = j.get("link") or j.get("jobUrl") or j.get("url") or ""
        posted_at = j.get("publishedAt") or j.get("postedAt") or j.get("postedTime") or ""
        job_id = j.get("id") or j.get("jobId") or hashlib.md5(f"{title}:{company}:{apply_link}".encode()).hexdigest()[:12]

        posted_ts = None
        if posted_at:
            from datetime import datetime
            for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
                try:
                    posted_ts = datetime.strptime(posted_at, fmt).timestamp()
                    break
                except ValueError:
                    continue

        highlights = {}
        if description:
            short = [l.strip() for l in description.split("\n") if l.strip() and 3 <= len(l.split()) <= 6]
            if short:
                highlights["Qualifications"] = short[:8]

        is_remote = "remote" in (j.get("location") or "").lower() or "remote" in title.lower()
        city = "Delhi NCR" if loc == "delhi" else "Bangalore"

        slim.append({
            "id": job_id, "title": title, "employer": company,
            "employer_logo": j.get("companyLogo") or j.get("imgUrl") or "",
            "employment_type": "FULLTIME", "city": city, "state": "", "country": "IN",
            "is_remote": is_remote, "posted_at": posted_at, "posted_ts": posted_ts,
            "apply_link": apply_link, "description": description, "highlights": highlights,
            "salary_min": j.get("salary") or j.get("salaryMin"), "salary_max": j.get("salaryMax"),
            "salary_currency": "INR", "salary_period": j.get("salaryPeriod"), "publisher": "LinkedIn",
        })

    if experience in ("senior", "executive"):
        needle = "senior" if experience == "senior" else "lead"
        slim = [s for s in slim if needle in (s["title"]).lower() or needle in (s["description"])[:400].lower()]
    return slim


# ------------------------------------------------------------------
#  JSearch
# ------------------------------------------------------------------
def _fetch_jsearch(keywords, experience, page, loc):
    loc_cfg = LOCATIONS.get(loc, LOCATIONS["bangalore"])
    params = {
        "query": f"{keywords} in {loc_cfg['jsearch']}", "page": str(page),
        "num_pages": "1", "num_results": "50", "country": loc_cfg["country"],
        "date_posted": "3days", "employment_types": "FULLTIME",
    }
    exp_map = {"entry": "under_3_years_experience", "mid": "more_than_3_years_experience",
               "senior": "more_than_3_years_experience", "executive": "more_than_3_years_experience"}
    if experience in exp_map:
        params["job_requirements"] = exp_map[experience]
    try:
        r = http_requests.get(JSEARCH_URL, headers={"x-rapidapi-key": RAPIDAPI_KEY, "x-rapidapi-host": RAPIDAPI_HOST},
                              params=params, timeout=25)
        r.raise_for_status()
        return r.json().get("data", []) or [], None
    except Exception as e:
        return [], str(e)

def _normalize_jsearch(jobs, experience):
    now = time.time()
    two_days = 48 * 3600
    jobs = [j for j in jobs if _within_48h(j, now, two_days)]
    if experience in ("senior", "executive"):
        needle = "senior" if experience == "senior" else "lead"
        jobs = [j for j in jobs if needle in (j.get("job_title") or "").lower() or needle in (j.get("job_description") or "").lower()[:400]]
    return [{
        "id": j.get("job_id"), "title": j.get("job_title"), "employer": j.get("employer_name"),
        "employer_logo": j.get("employer_logo"), "employment_type": j.get("job_employment_type"),
        "city": j.get("job_city"), "state": j.get("job_state"), "country": j.get("job_country"),
        "is_remote": j.get("job_is_remote"), "posted_at": j.get("job_posted_at_datetime_utc"),
        "posted_ts": j.get("job_posted_at_timestamp"), "apply_link": j.get("job_apply_link"),
        "description": j.get("job_description"), "highlights": j.get("job_highlights") or {},
        "salary_min": j.get("job_min_salary"), "salary_max": j.get("job_max_salary"),
        "salary_currency": j.get("job_salary_currency"), "salary_period": j.get("job_salary_period"),
        "publisher": j.get("job_publisher"),
    } for j in jobs]

def _within_48h(job, now, two_days):
    ts = job.get("job_posted_at_timestamp")
    if not ts:
        return True
    try:
        return (now - float(ts)) <= two_days
    except:
        return True


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
        try:
            text = "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(raw)).pages)
        except Exception as e:
            return jsonify({"error": f"PDF error: {e}"}), 400
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
    if not client:
        return jsonify({"error": "LLM not configured."}), 500
    desc = ((request.get_json(silent=True) or {}).get("description") or "").strip()[:12000]
    if not desc:
        return jsonify({"error": "No description."}), 400
    try:
        msg = client.messages.create(model=CLAUDE_MODEL, max_tokens=600,
            system='Extract skills from job descriptions. Return ONLY valid JSON: {"required": [...], "nice_to_have": [...]}. Max 3 words per skill, max 12 each.',
            messages=[{"role": "user", "content": f"Job description:\n\n{desc}\n\nReturn JSON now."}])
        data = json.loads(_strip_fences("".join(b.text for b in msg.content if getattr(b, "type", "") == "text")))
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid LLM JSON."}), 502
    except Exception as e:
        return jsonify({"error": f"LLM failed: {e}"}), 502
    return jsonify({"required": data.get("required", [])[:12], "nice_to_have": data.get("nice_to_have", [])[:12]})


# ====================================================================
#  LLM: RESUME MATCH
# ====================================================================
@app.route("/api/match", methods=["POST"])
def match_resume():
    client = get_anthropic()
    if not client:
        return jsonify({"error": "LLM not configured."}), 500
    body = request.get_json(silent=True) or {}
    resume = (body.get("resume") or "").strip()[:15000]
    desc = (body.get("description") or "").strip()[:12000]
    title = (body.get("title") or "").strip()
    if not resume or not desc:
        return jsonify({"error": "Resume and description required."}), 400
    try:
        msg = client.messages.create(model=CLAUDE_MODEL, max_tokens=900,
            system='Expert recruiter. Compare resume to job. Return ONLY JSON: {"score": 0-100, "verdict": "one sentence", "matched": [...], "missing": [...], "reasoning": "2-3 sentences"}. 80+=strong, 60-79=worth applying, 40-59=stretch, <40=weak. Max 8 items each.',
            messages=[{"role": "user", "content": f"JOB: {title}\n\nDESCRIPTION:\n{desc}\n\nRESUME:\n{resume}\n\nJSON now."}])
        data = json.loads(_strip_fences("".join(b.text for b in msg.content if getattr(b, "type", "") == "text")))
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid LLM JSON."}), 502
    except Exception as e:
        return jsonify({"error": f"LLM failed: {e}"}), 502
    return jsonify({"score": max(0, min(100, int(data.get("score", 0)))), "verdict": data.get("verdict", ""),
                    "matched": (data.get("matched") or [])[:8], "missing": (data.get("missing") or [])[:8],
                    "reasoning": data.get("reasoning", "")})


# ====================================================================
#  LLM: REWRITE EXPERIENCE FOR A JOB
# ====================================================================
@app.route("/api/rewrite", methods=["POST"])
def rewrite_resume():
    client = get_anthropic()
    if not client:
        return jsonify({"error": "LLM not configured."}), 500
    body = request.get_json(silent=True) or {}
    resume = (body.get("resume") or "").strip()[:15000]
    desc = (body.get("description") or "").strip()[:12000]
    title = (body.get("title") or "").strip()
    if not resume or not desc:
        return jsonify({"error": "Resume and description required."}), 400
    try:
        msg = client.messages.create(model=CLAUDE_MODEL, max_tokens=2000,
            system=(
                "You are a professional resume writer. Rewrite the candidate's experience section "
                "to be highly tailored for the specific job. Use keywords from the job description. "
                "Make bullet points achievement-oriented with metrics where possible. "
                "Keep the same jobs/roles but reframe accomplishments to align with the role. "
                "Return ONLY the rewritten experience section — no preamble, no explanation. "
                "Format as clean text with role headings and bullet points."
            ),
            messages=[{"role": "user", "content": f"TARGET JOB: {title}\n\nJOB DESCRIPTION:\n{desc}\n\nMY RESUME:\n{resume}\n\nRewrite my experience section now."}])
        rewritten = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    except Exception as e:
        return jsonify({"error": f"LLM failed: {e}"}), 502
    return jsonify({"rewritten": rewritten})


# ====================================================================
#  LLM: BATCH SCORE (top 15 jobs)
# ====================================================================
@app.route("/api/batch-score", methods=["POST"])
def batch_score():
    client = get_anthropic()
    if not client:
        return jsonify({"error": "LLM not configured."}), 500
    body = request.get_json(silent=True) or {}
    resume = (body.get("resume") or "").strip()[:10000]
    jobs = (body.get("jobs") or [])[:15]
    if not resume or not jobs:
        return jsonify({"error": "Resume and jobs required."}), 400

    # Build a compact job list for the prompt
    job_list = "\n".join(
        f'[{i}] "{j.get("title","")} at {j.get("employer","")}" — {(j.get("description",""))[:200]}'
        for i, j in enumerate(jobs)
    )
    try:
        msg = client.messages.create(model=CLAUDE_MODEL, max_tokens=600,
            system=(
                "Score how well a resume matches each job. Return ONLY a JSON array of objects: "
                '[{"index": 0, "score": 0-100}, ...]. '
                "One object per job. Score honestly: 80+=strong, 60-79=decent, 40-59=stretch, <40=weak. "
                "No explanation, just the array."
            ),
            messages=[{"role": "user", "content": f"RESUME:\n{resume}\n\nJOBS:\n{job_list}\n\nReturn JSON array now."}])
        raw = _strip_fences("".join(b.text for b in msg.content if getattr(b, "type", "") == "text"))
        scores = json.loads(raw)
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid LLM JSON."}), 502
    except Exception as e:
        return jsonify({"error": f"LLM failed: {e}"}), 502

    # Normalize to dict { job_index: score }
    result = {}
    if isinstance(scores, list):
        for item in scores:
            idx = item.get("index")
            sc = item.get("score", 0)
            if idx is not None:
                result[str(idx)] = max(0, min(100, int(sc)))
    return jsonify({"scores": result})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
