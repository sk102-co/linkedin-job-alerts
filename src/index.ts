import { HttpFunction } from '@google-cloud/functions-framework';
import { GmailClient, LinkedInEmailParser } from './gmail';
import { SheetsClient, SheetsWriter } from './sheets';
import { DocsClient } from './docs';
import { GeminiClient } from './gemini';
import { JobResumeAnalyzer } from './matcher';
import { JobStatus } from './sheets/schema';
import { Logger } from './utils/logger';
import { Job } from './types/job';

/**
 * Environment variable names
 */
const ENV_VARS = {
  PROJECT_ID: 'GCP_PROJECT_ID',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  RESUME_DOC_ID: 'RESUME_DOC_ID',
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
  jobsAnalyzed: number;
  jobsLowMatch: number;
  jobsNotAvailable: number;
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
    jobsAnalyzed: 0,
    jobsLowMatch: 0,
    jobsNotAvailable: 0,
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
    const resumeDocId = process.env[ENV_VARS.RESUME_DOC_ID]; // Optional

    // Initialize core clients
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

    // Analyze jobs for match probability (if resume is configured)
    let matchResults: Map<string, { jobId: string; probability: number | null; status: JobStatus; reasoning: string }> | undefined;

    if (resumeDocId) {
      logger.info('Resume document configured, initializing matching analysis');

      const docsClient = new DocsClient(projectId, logger);
      const geminiClient = new GeminiClient(projectId, logger);

      await Promise.all([docsClient.initialize(), geminiClient.initialize()]);

      const analyzer = new JobResumeAnalyzer(geminiClient, docsClient, logger);

      try {
        await analyzer.loadResume(resumeDocId);
        matchResults = await analyzer.analyzeJobs(uniqueJobs);

        // Calculate stats
        const matchResultValues = Array.from(matchResults.values());
        result.jobsAnalyzed = matchResultValues.filter((r) => r.probability !== null).length;
        result.jobsLowMatch = matchResultValues.filter((r) => r.status === JobStatus.LOW_MATCH).length;
        result.jobsNotAvailable = matchResultValues.filter((r) => r.status === JobStatus.NOT_AVAILABLE).length;

        logger.info('Job matching analysis complete', {
          analyzed: result.jobsAnalyzed,
          lowMatch: result.jobsLowMatch,
          notAvailable: result.jobsNotAvailable,
        });
      } catch (matchError) {
        // Log error but continue without matching - jobs will get default NEW status
        logger.error('Job matching analysis failed, continuing without match scores', {
          error: matchError instanceof Error ? matchError.message : String(matchError),
        });
      }
    } else {
      logger.info('No resume document configured, skipping match analysis');
    }

    // Write jobs to sheet
    const writer = new SheetsWriter(sheetsClient, logger);
    const writeResult = await writer.appendJobs(uniqueJobs, matchResults);

    result.jobsAdded = writeResult.jobsAdded;
    result.jobsUpdated = writeResult.jobsUpdated;
    result.jobsSkipped = writeResult.jobsSkipped;

    // Update probabilities for existing jobs that were analyzed
    if (matchResults && matchResults.size > 0) {
      const probabilitiesUpdated = await writer.updateExistingJobProbabilities(matchResults);
      if (probabilitiesUpdated > 0) {
        logger.info('Updated probabilities for existing jobs', { count: probabilitiesUpdated });
      }
    }

    // Mark emails as processed (label, read, archive)
    const messageIds = emails.map((e) => e.id);
    await gmailClient.markAsProcessed(messageIds);

    result.success = true;
    logger.info('Processing complete', {
      emailsProcessed: result.emailsProcessed,
      jobsFound: result.jobsFound,
      jobsAnalyzed: result.jobsAnalyzed,
      jobsLowMatch: result.jobsLowMatch,
      jobsNotAvailable: result.jobsNotAvailable,
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
