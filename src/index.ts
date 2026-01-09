import { HttpFunction } from '@google-cloud/functions-framework';
import { GmailClient, LinkedInEmailParser } from './gmail';
import { SheetsClient, SheetsWriter } from './sheets';
import { Logger } from './utils/logger';
import { Job } from './types/job';

/**
 * Environment variable names
 */
const ENV_VARS = {
  PROJECT_ID: 'GCP_PROJECT_ID',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
} as const;

/**
 * Gets a required environment variable
 * @throws Error if the variable is not set
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Response structure for the Cloud Function
 */
interface ProcessingResult {
  success: boolean;
  emailsProcessed: number;
  jobsFound: number;
  jobsAdded: number;
  jobsUpdated: number;
  jobsSkipped: number;
  error?: string;
  runId: string;
}

/**
 * Main Cloud Function entry point
 * Processes LinkedIn job alert emails and updates the Google Sheet
 */
export const processJobAlerts: HttpFunction = async (_req, res) => {
  const logger = new Logger();
  const result: ProcessingResult = {
    success: false,
    emailsProcessed: 0,
    jobsFound: 0,
    jobsAdded: 0,
    jobsUpdated: 0,
    jobsSkipped: 0,
    runId: logger.getRunId(),
  };

  try {
    logger.info('Starting job alert processing');

    // Get required environment variables
    const projectId = getRequiredEnv(ENV_VARS.PROJECT_ID);
    const spreadsheetId = getRequiredEnv(ENV_VARS.SPREADSHEET_ID);

    // Initialize clients
    const gmailClient = new GmailClient(projectId, logger);
    const sheetsClient = new SheetsClient(projectId, spreadsheetId, logger);

    await Promise.all([gmailClient.initialize(), sheetsClient.initialize()]);

    // Ensure sheet structure is set up
    await sheetsClient.ensureSheetSetup();

    // Fetch unread job alert emails
    const emails = await gmailClient.fetchJobAlertEmails();
    result.emailsProcessed = emails.length;

    if (emails.length === 0) {
      logger.info('No new job alert emails found');
      result.success = true;
      res.status(200).json(result);
      return;
    }

    // Parse jobs from emails
    const parser = new LinkedInEmailParser(logger);
    const allJobs: Job[] = [];

    for (const email of emails) {
      const jobs = parser.parseEmail(email.htmlBody);
      allJobs.push(...jobs);
    }

    result.jobsFound = allJobs.length;

    if (allJobs.length === 0) {
      logger.info('No jobs extracted from emails');
      result.success = true;

      // Mark emails as processed even if no jobs were extracted
      const messageIds = emails.map((e) => e.id);
      await gmailClient.markAsProcessed(messageIds);

      res.status(200).json(result);
      return;
    }

    // Deduplicate jobs across all emails
    const uniqueJobs = deduplicateJobs(allJobs);
    logger.info('Jobs deduplicated across emails', {
      before: allJobs.length,
      after: uniqueJobs.length,
    });

    // Write jobs to sheet
    const writer = new SheetsWriter(sheetsClient, logger);
    const writeResult = await writer.appendJobs(uniqueJobs);

    result.jobsAdded = writeResult.jobsAdded;
    result.jobsUpdated = writeResult.jobsUpdated;
    result.jobsSkipped = writeResult.jobsSkipped;

    // Mark emails as processed (label, read, archive)
    const messageIds = emails.map((e) => e.id);
    await gmailClient.markAsProcessed(messageIds);

    result.success = true;
    logger.info('Processing complete', {
      emailsProcessed: result.emailsProcessed,
      jobsFound: result.jobsFound,
      jobsAdded: result.jobsAdded,
      jobsUpdated: result.jobsUpdated,
      jobsSkipped: result.jobsSkipped,
    });

    res.status(200).json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.errorWithStack(
      'Job alert processing failed',
      error instanceof Error ? error : new Error(errorMessage)
    );

    result.error = errorMessage;
    res.status(500).json(result);
  }
};

/**
 * Deduplicates jobs by job ID
 */
function deduplicateJobs(jobs: Job[]): Job[] {
  const seen = new Set<string>();
  const unique: Job[] = [];

  for (const job of jobs) {
    if (!seen.has(job.jobId)) {
      seen.add(job.jobId);
      unique.push(job);
    }
  }

  return unique;
}
