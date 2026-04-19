# JobBoard Platform

A full-stack job aggregator with AI-powered search using React + FastAPI + Claude.

## Stack

| Layer      | Tech                          |
|------------|-------------------------------|
| Frontend   | React 18 + Vite               |
| Backend    | Python 3.11 + FastAPI         |
| LLM        | Anthropic Claude (claude-sonnet-4) |
| Deployment | Render.com (or Railway)       |

---

## Project Structure

```
job-platform/
├── backend/
│   ├── main.py          # FastAPI app + all routes
│   ├── data.py          # Mock job data (replace with DB)
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # Root component
│   │   ├── components/
│   │   │   ├── JobCard.jsx       # Individual job card
│   │   │   ├── Filters.jsx       # Sidebar filters
│   │   │   └── PostJobModal.jsx  # Submit job form
│   │   ├── hooks/useJobs.js      # Data fetching + filter state
│   │   └── services/api.js       # API calls
│   ├── index.html
│   ├── vite.config.js
│   └── .env.example
└── render.yaml          # One-click Render deployment
```

---

## Local Development

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

uvicorn main:app --reload
# API running at http://localhost:8000
# Docs at http://localhost:8000/docs
```

### 2. Frontend

```bash
cd frontend
npm install

cp .env.example .env
# VITE_API_BASE_URL is already set to http://localhost:8000 for local dev

npm run dev
# App running at http://localhost:5173
```

---

## API Endpoints

| Method | Path             | Description                        |
|--------|------------------|------------------------------------|
| GET    | /api/jobs        | Fetch & filter jobs                |
| POST   | /api/ai-search   | Natural language search via Claude |
| POST   | /api/jobs        | Submit a new job posting           |

### GET /api/jobs — query params

| Param      | Example              | Notes                       |
|------------|----------------------|-----------------------------|
| field      | Engineering,Design   | Comma-separated             |
| experience | Junior,Mid           | Comma-separated             |
| location   | Remote,Bengaluru     | Partial match               |
| job_type   | Full-time,Contract   | Comma-separated             |
| source     | linkedin             | all / linkedin / indeed / ai / user |
| q          | react developer      | Full-text search            |
| sort       | recent               | recent / salary             |

### POST /api/ai-search

```json
{ "query": "remote senior ML engineer contract" }
```

Returns: `{ summary, filters_applied, total, jobs }`

---

## Deploy to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Blueprint
3. Connect your repo — Render reads `render.yaml` automatically
4. In the `job-platform-api` service, add environment variable:
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com
5. Deploy — both services spin up automatically

### Deploy to Railway (alternative)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set `ANTHROPIC_API_KEY` in the Railway dashboard under Variables.

---

## Next Steps

- [ ] Replace mock data in `backend/data.py` with a real DB (PostgreSQL via SQLAlchemy + Alembic)
- [ ] Add job API integrations: Adzuna (free tier), Remotive, Arbeitnow
- [ ] Add pagination (`/api/jobs?page=1&limit=20`)
- [ ] Rate-limit the `/api/ai-search` endpoint (slowapi)
- [ ] Add a `saved jobs` feature with localStorage on the frontend
