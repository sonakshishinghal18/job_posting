# Lumen — Premium Job Search

A sleek dark-themed job search app for Bangalore full-time roles posted in the last 48 hours. Python Flask backend + vanilla HTML/CSS/JS frontend. Uses RapidAPI JSearch for jobs and Claude Sonnet 4.6 for resume matching and skill extraction.

## Project structure

```
job-search-app/
├── app.py              # Flask server: JSearch proxy + resume + LLM endpoints
├── app.js              # Frontend logic (search, panel, LLM actions, resume)
├── index.html          # Markup
├── styles.css          # Dark theme + panel + modal + match UI
├── requirements.txt    # Python deps (Flask, anthropic, pypdf, gunicorn, ...)
├── render.yaml         # Render infrastructure-as-code
├── runtime.txt         # Python version for Render
├── .env.example        # Template — copy to .env and fill in secrets
├── .gitignore
└── README.md
```

## Features

- Locked filters: **Bangalore, Full-time, Posted within 48 hours**
- User filters: **keywords** + **experience level**
- Max **40 jobs per request**
- **Skill chips on each card** — derived from JSearch `Qualifications` (free, no LLM)
- **Detail side panel** on card click with:
  - "Extract skills" — LLM splits required vs nice-to-have
  - "Analyze match" — LLM scores resume vs job (0–100, matched, missing, reasoning)
- **Resume upload once, reuse everywhere** — plaintext stored in browser localStorage (never on the server beyond the upload request)
- Premium dark UI: Fraunces display serif, amber accent, grain overlay, skeleton shimmer, animated match score ring

## Local setup

```bash
# 1. Install deps
pip install -r requirements.txt

# 2. Configure secrets
cp .env.example .env
# Edit .env and paste your actual keys:
#   RAPIDAPI_KEY=...
#   ANTHROPIC_API_KEY=...

# 3. Run
python app.py
```

Open **http://127.0.0.1:5000**.

## Deploying to Render

This repo includes `render.yaml` for one-click deployment. Two ways:

### Option A — Blueprint (recommended)

1. Push this repo to GitHub.
2. In Render, click **New → Blueprint** and point it at your GitHub repo.
3. Render detects `render.yaml` and creates the service. It will ask you to fill in the two secret env vars:
   - `RAPIDAPI_KEY`
   - `ANTHROPIC_API_KEY`
4. Deploy. Your app will be live at `https://lumen-jobsearch.onrender.com` (or similar).

### Option B — Manual web service

If you prefer not to use the blueprint:

1. **New → Web Service**, connect your repo.
2. Runtime: **Python 3**.
3. Build command: `pip install -r requirements.txt`
4. Start command: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 60`
5. Add environment variables under **Environment**:
   - `RAPIDAPI_KEY` = your JSearch key
   - `ANTHROPIC_API_KEY` = your Anthropic key
   - `CLAUDE_MODEL` = `claude-sonnet-4-6` (optional)
6. Health check path: `/api/health`

### Render plan notes

The `render.yaml` uses the **free** plan, which sleeps after 15 minutes of inactivity and takes 30–60s to cold-start. For a more responsive app, switch `plan: free` → `plan: starter` (paid). Region is set to **Singapore** for proximity to Bangalore.

## API surface (for reference)

| Endpoint              | Method | Purpose                                           |
|-----------------------|--------|---------------------------------------------------|
| `/api/health`         | GET    | Health check + which keys are configured          |
| `/api/search`         | POST   | Proxy to JSearch with locked filters applied      |
| `/api/resume/upload`  | POST   | Accept PDF / TXT / MD, return extracted plaintext |
| `/api/extract`        | POST   | LLM extracts required + nice-to-have skills       |
| `/api/match`          | POST   | LLM scores resume vs job with matched/missing     |

## Privacy & cost notes

- **Resume handling** — uploaded files are parsed to plaintext server-side but not stored. The plaintext lives only in the user's browser `localStorage`. On "Analyze match" the resume text is sent back to the server just for that single LLM call.
- **LLM cost** — calls happen **only when the user clicks** "Extract skills" or "Analyze match" on a specific job. There is no background batch processing. Skill chips on cards come from JSearch data (no LLM cost).
- **JSearch filter caveat** — JSearch's `date_posted` has no native 48-hour option. We fetch `3days` and trim to `≤ 48h` in code using `job_posted_at_timestamp`.
