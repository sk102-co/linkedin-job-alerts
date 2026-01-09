# LinkedIn Job Alert Agent - Setup Guide

This guide walks you through deploying the LinkedIn Job Alert agent to Google Cloud.

## Prerequisites

- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed and configured
- [Node.js 20+](https://nodejs.org/) installed
- A Google account with Gmail containing LinkedIn job alerts
- A Google Sheet to store job listings (or the agent will use an existing one)

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)

2. Create a new project:
   ```bash
   gcloud projects create linkedin-job-alert --name="LinkedIn Job Alert"
   gcloud config set project linkedin-job-alert
   ```

3. Enable billing for the project (required for Cloud Functions):
   - Navigate to **Billing** in the Cloud Console
   - Link a billing account to your project

4. Enable required APIs:
   ```bash
   gcloud services enable \
     gmail.googleapis.com \
     sheets.googleapis.com \
     cloudfunctions.googleapis.com \
     cloudscheduler.googleapis.com \
     secretmanager.googleapis.com \
     cloudbuild.googleapis.com
   ```

## Step 2: Create OAuth Credentials

1. Go to [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials)

2. Click **Configure Consent Screen**:
   - Choose **External** (or Internal if using Google Workspace)
   - Fill in app name: `LinkedIn Job Alert`
   - Add your email as a test user
   - Save

3. Create OAuth 2.0 credentials:
   - Click **Create Credentials** > **OAuth client ID**
   - Application type: **Desktop app**
   - Name: `LinkedIn Job Alert CLI`
   - Click **Create**

4. Download the credentials:
   - Click the download icon next to your new credential
   - Save as `credentials.json` in the project root

## Step 3: Obtain OAuth Refresh Token

1. Install project dependencies:
   ```bash
   npm install
   ```

2. Run the OAuth setup script:
   ```bash
   npm run setup-oauth
   ```

3. Follow the prompts:
   - Open the authorization URL in your browser
   - Sign in with your Google account
   - Grant permissions for Gmail (modify) and Sheets (edit)
   - The script will capture the authorization code automatically

4. The script outputs:
   - Your **Client ID**
   - Your **Client Secret**
   - Your **Refresh Token**

   Keep these values - you'll need them for the next step.

## Step 4: Store Secrets in Secret Manager

Store each credential as a secret:

```bash
# Replace <VALUE> with actual values from the previous step

# Store Client ID
echo -n "<YOUR_CLIENT_ID>" | \
  gcloud secrets create linkedin-job-alert-client-id --data-file=-

# Store Client Secret
echo -n "<YOUR_CLIENT_SECRET>" | \
  gcloud secrets create linkedin-job-alert-client-secret --data-file=-

# Store Refresh Token
echo -n "<YOUR_REFRESH_TOKEN>" | \
  gcloud secrets create linkedin-job-alert-refresh-token --data-file=-
```

Verify secrets were created:
```bash
gcloud secrets list
```

## Step 5: Create a Google Sheet

1. Create a new Google Sheet at [sheets.google.com](https://sheets.google.com)

2. Copy the **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
   ```

3. The agent will automatically set up:
   - Headers row
   - Status dropdown validation
   - Conditional formatting by status
   - Hidden job_id column

## Step 6: Deploy the Cloud Function

1. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your values:
   ```bash
   GCP_PROJECT_ID=your-gcp-project-id
   SPREADSHEET_ID=your-google-sheet-id
   GCP_REGION=asia-northeast1
   ```

3. Deploy to Cloud Functions:
   ```bash
   npm run deploy
   ```

   This reads configuration from `.env` and deploys the function.

4. Grant the function access to secrets:
   ```bash
   source .env

   # Get the service account email
   SA_EMAIL=$(gcloud functions describe gc-linkedin-job-alert \
     --region=$GCP_REGION \
     --format='value(serviceConfig.serviceAccountEmail)')

   # Grant secret accessor role
   gcloud secrets add-iam-policy-binding linkedin-job-alert-client-id \
     --member="serviceAccount:$SA_EMAIL" \
     --role="roles/secretmanager.secretAccessor"

   gcloud secrets add-iam-policy-binding linkedin-job-alert-client-secret \
     --member="serviceAccount:$SA_EMAIL" \
     --role="roles/secretmanager.secretAccessor"

   gcloud secrets add-iam-policy-binding linkedin-job-alert-refresh-token \
     --member="serviceAccount:$SA_EMAIL" \
     --role="roles/secretmanager.secretAccessor"
   ```

## Step 7: Test the Function

1. Test using gcloud (handles authentication automatically):
   ```bash
   source .env
   gcloud functions call gc-linkedin-job-alert --region=$GCP_REGION
   ```

2. Check the response:
   ```json
   {
     "success": true,
     "emailsProcessed": 3,
     "jobsFound": 15,
     "jobsAdded": 12,
     "jobsSkipped": 3,
     "runId": "run-1234567890-abc123"
   }
   ```

4. Verify jobs appear in your Google Sheet.

## Step 8: Set Up Cloud Scheduler

Create a scheduled job to run every 6 hours:

```bash
source .env
gcloud scheduler jobs create http linkedin-job-sync \
  --location=$GCP_REGION \
  --schedule="0 */6 * * *" \
  --uri="$(gcloud functions describe gc-linkedin-job-alert \
    --region=$GCP_REGION \
    --format='value(serviceConfig.uri)')" \
  --http-method=POST \
  --time-zone="America/New_York"
```

### Schedule Options

| Frequency | Cron Expression |
|-----------|-----------------|
| Every 6 hours | `0 */6 * * *` |
| Every 4 hours | `0 */4 * * *` |
| Every 12 hours | `0 */12 * * *` |
| Daily at 9am | `0 9 * * *` |
| Twice daily (9am, 5pm) | `0 9,17 * * *` |

To update the schedule:
```bash
source .env
gcloud scheduler jobs update http linkedin-job-sync \
  --location=$GCP_REGION \
  --schedule="0 9,17 * * *"
```

## Step 9: Clean Up Local Credentials

After successful deployment, remove sensitive files:

```bash
rm -f credentials.json token.json
```

These are no longer needed - secrets are stored in Secret Manager.

---

## Troubleshooting

### "Permission denied" accessing secrets

Ensure the function's service account has the `secretAccessor` role:
```bash
gcloud secrets get-iam-policy linkedin-job-alert-refresh-token
```

### No emails found

1. Verify you have unread emails from `jobalerts-noreply@linkedin.com`, `jobs-noreply@linkedin.com`, or `jobs-listings@linkedin.com`
2. Check Gmail query in Cloud Function logs:
   ```bash
   source .env
   gcloud functions logs read gc-linkedin-job-alert --region=$GCP_REGION
   ```

### Jobs not appearing in sheet

1. Check the function response for errors
2. Verify the `SPREADSHEET_ID` environment variable is correct
3. Ensure your Google account has edit access to the sheet

### OAuth token expired

Refresh tokens don't expire unless:
- You revoke access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
- The app is in "Testing" mode and the token is older than 7 days

If expired, re-run `npm run setup-oauth` and update the secret:
```bash
echo -n "NEW_REFRESH_TOKEN" | \
  gcloud secrets versions add linkedin-job-alert-refresh-token --data-file=-
```

---

## Monitoring

```bash
source .env
```

### View function logs
```bash
gcloud functions logs read gc-linkedin-job-alert --region=$GCP_REGION --limit=50
```

### View scheduler job status
```bash
gcloud scheduler jobs describe linkedin-job-sync --location=$GCP_REGION
```

### Manually trigger the scheduler
```bash
gcloud scheduler jobs run linkedin-job-sync --location=$GCP_REGION
```

---

## Cost Estimate

With default settings (every 6 hours = 4 invocations/day):

| Service | Monthly Usage | Estimated Cost |
|---------|---------------|----------------|
| Cloud Functions | ~120 invocations | Free tier |
| Secret Manager | 3 secrets, ~120 accesses | Free tier |
| Cloud Scheduler | 1 job | Free tier |

**Total: $0/month** (within free tier limits)
