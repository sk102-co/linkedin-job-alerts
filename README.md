# LinkedIn Job Alert Agent

Automated tool that processes LinkedIn job alert emails and maintains a deduplicated job list in Google Sheets.

## The Problem

LinkedIn sends job alerts from multiple email addresses, often containing the same jobs across different emails. Manually reviewing these becomes tedious—you end up seeing the same positions repeatedly, and interesting opportunities get buried.

## The Solution

This serverless agent:

1. **Fetches** unread LinkedIn job alert emails from Gmail
2. **Parses** job listings from the HTML email content
3. **Deduplicates** jobs using LinkedIn's unique job ID
4. **Stores** them in a Google Sheet with status tracking
5. **Marks** processed emails as read and archives them

The result: a clean, organized spreadsheet of unique job opportunities that you can review at your own pace.

## Features

- **Multi-sender support** — Processes emails from `jobalerts-noreply@linkedin.com`, `jobs-noreply@linkedin.com`, and `jobs-listings@linkedin.com`
- **Intelligent deduplication** — Same job appearing in 10 emails? You'll see it once
- **Status tracking** — Mark jobs as NEW, INTERESTED, APPLIED, etc.
- **Auto-updates** — If job details change, existing rows are updated (preserving your status and notes)
- **Secure credentials** — OAuth tokens stored in Google Secret Manager, never on your local machine
- **Scheduled execution** — Runs automatically via Cloud Scheduler

## Tech Stack

- **Runtime:** Google Cloud Functions (Node.js 20)
- **APIs:** Gmail API, Google Sheets API
- **Auth:** OAuth 2.0 with refresh tokens
- **Secrets:** Google Secret Manager
- **Scheduler:** Google Cloud Scheduler
- **Language:** TypeScript with Zod validation

## Sheet Schema

| Column | Field | Description |
|--------|-------|-------------|
| A | job_id | LinkedIn job ID (deduplication key) |
| B | status | Dropdown: NEW, READ, INTERESTED, APPLIED, etc. |
| C | date_added | When the job was first seen |
| D | date_modified | Last update timestamp |
| E | job_title | Position title |
| F | company | Company name |
| G | office_location | Location (city, state, country) |
| H | work_type | Remote, On-site, or Hybrid |
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

**Total: $0/month** within free tier limits.

## Security

- OAuth credentials stored in Secret Manager, not local files
- Minimal API scopes (`gmail.modify`, `spreadsheets`)
- Sender validation (defense in depth beyond Gmail query)
- URL validation (only LinkedIn job URLs accepted)
- Formula injection prevention in cell values

## License

MIT
