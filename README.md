# LinkedIn Job Alert Agent

Automated tool that processes LinkedIn job alert emails, matches jobs against your resume using AI, and maintains a deduplicated job list in Google Sheets.

## The Problem

LinkedIn sends job alerts from multiple email addresses, often containing the same jobs across different emails. Manually reviewing these becomes tedious—you end up seeing the same positions repeatedly, and interesting opportunities get buried.

## The Solution

This serverless agent:

1. **Fetches** unread LinkedIn job alert emails from Gmail
2. **Parses** job listings from the HTML email content
3. **Deduplicates** jobs using LinkedIn's unique job ID
4. **Analyzes** each job against your resume using Gemini 2.5 Flash AI
5. **Scores** match probability (0-100%) using Google Search grounding
6. **Stores** them in a Google Sheet with status tracking
7. **Marks** processed emails as read and archives them

The result: a clean, organized spreadsheet of unique job opportunities ranked by how well they match your background.

## Features

- **AI-powered matching** — Gemini 2.5 Flash analyzes each job against your resume
- **Match probability** — See a 0-100% score for how well each job fits your background
- **Smart filtering** — Jobs below 70% match are auto-labeled "LOW MATCH"
- **Google Search grounding** — AI fetches actual job descriptions from LinkedIn postings
- **Multi-sender support** — Processes emails from `jobalerts-noreply@linkedin.com`, `jobs-noreply@linkedin.com`, and `jobs-listings@linkedin.com`
- **Intelligent deduplication** — Same job appearing in 10 emails? You'll see it once
- **Status tracking** — Mark jobs as NEW, INTERESTED, APPLIED, etc.
- **Auto-updates** — If job details change, existing rows are updated (preserving your status and notes)
- **Secure credentials** — OAuth tokens stored in Google Secret Manager, never on your local machine
- **Scheduled execution** — Runs automatically via Cloud Scheduler

## Tech Stack

- **Runtime:** Google Cloud Functions (Node.js 20)
- **AI:** Gemini 2.5 Flash with Google Search grounding
- **APIs:** Gmail API, Google Sheets API, Google Docs API
- **Auth:** OAuth 2.0 with refresh tokens
- **Secrets:** Google Secret Manager
- **Scheduler:** Google Cloud Scheduler
- **Language:** TypeScript with Zod validation

## Sheet Schema

| Column | Field | Description |
|--------|-------|-------------|
| A | job_id | LinkedIn job ID (deduplication key) |
| B | status | Dropdown: NEW, LOW MATCH, NOT AVAILABLE, etc. |
| C | date_added | When the job was first seen |
| D | date_modified | Last update timestamp |
| E | probability | AI match score (0-100%) |
| F | job_title | Position title |
| G | company | Company name |
| H | location | Location with work type (e.g., "San Francisco, CA (Remote)") |
| I | url | Direct link to LinkedIn job posting |
| J | notes | Your notes (never overwritten) |

## Setup

See [docs/SETUP.md](docs/SETUP.md) for detailed setup instructions.

### Quick Overview

1. Create a Google Cloud project and enable APIs (Gmail, Sheets, Secret Manager, Cloud Functions)
2. Create OAuth 2.0 credentials and run `npm run setup-oauth`
3. Store credentials in Secret Manager
4. Create a Google Sheet for job listings
5. Configure `.env` with your project ID, spreadsheet ID, and region
6. Deploy with `npm run deploy`
7. Set up Cloud Scheduler for automatic execution

## Configuration

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Required variables:

```
GCP_PROJECT_ID=your-gcp-project-id
SPREADSHEET_ID=your-google-sheet-id
GCP_REGION=us-central1
```

Optional (for AI matching):

```
RESUME_DOC_ID=your-google-doc-id
```

To enable AI-powered job matching, create a Google Doc with your resume and set `RESUME_DOC_ID` to the document ID from the URL (the part after `/d/` and before `/edit`).

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Run locally (requires .env and local credentials)
npm run dev

# Deploy to Cloud Functions
npm run deploy
```

## Cost

With default settings (running every 4 hours = ~180 invocations/month):

| Service | Usage | Cost |
|---------|-------|------|
| Cloud Functions | ~180 invocations | Free tier |
| Secret Manager | 3 secrets | Free tier |
| Cloud Scheduler | 1 job | Free tier |
| Gemini API | ~500 requests/month | Free tier (up to 1,500/day) |

**Total: $0/month** within free tier limits.

Note: Gemini 2.5 Flash with Google Search grounding is free within Google AI Studio's generous limits. Each job analysis takes ~30-40 seconds due to search grounding.

## Security

- OAuth credentials stored in Secret Manager, not local files
- Minimal API scopes (`gmail.modify`, `spreadsheets`, `documents.readonly`)
- Sender validation (defense in depth beyond Gmail query)
- URL validation (only LinkedIn job URLs accepted)
- Formula injection prevention in cell values
- Resume data stays within Google's ecosystem (Docs → Gemini)

## License

MIT
