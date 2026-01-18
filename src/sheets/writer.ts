import { Job } from '../types/job';
import { Logger } from '../utils/logger';
import { SheetsClient } from './client';
import {
  SHEET_NAMES,
  COLUMN_INDEX,
  JobStatus,
  sanitizeCellValue,
} from './schema';
import { MatchResult } from '../matcher';

/**
 * Result of a write operation
 */
export interface WriteResult {
  jobsAdded: number;
  jobsUpdated: number;
  jobsSkipped: number;
}

/**
 * Stored job data with row number for updates
 */
interface ExistingJobData {
  rowNumber: number;
  title: string;
  company: string;
  location: string;
  url: string;
  probability: number | null;
  status: string;
}

/**
 * Writer for appending jobs to the Google Sheet with deduplication
 */
export class SheetsWriter {
  private readonly client: SheetsClient;
  private readonly logger: Logger;
  private existingJobs: Map<string, ExistingJobData> | null = null;

  constructor(client: SheetsClient, logger: Logger) {
    this.client = client;
    this.logger = logger;
  }

  /**
   * Loads existing job data from the sheet for deduplication and updates
   */
  async loadExistingJobs(): Promise<void> {
    const sheets = this.client.getApi();
    const spreadsheetId = this.client.getSpreadsheetId();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAMES.JOBS}!A:P`,
    });

    const values = response.data.values ?? [];
    this.existingJobs = new Map();

    // Skip header row, start from row 2 (index 1)
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const jobId = row[COLUMN_INDEX.JOB_ID] as string;
      if (jobId) {
        const probValue = row[COLUMN_INDEX.PROBABILITY];
        const probability = probValue !== undefined && probValue !== '' && probValue !== null
          ? Number(probValue)
          : null;

        this.existingJobs.set(jobId, {
          rowNumber: i + 1, // 1-based row number in sheet
          title: (row[COLUMN_INDEX.JOB_TITLE] as string) ?? '',
          company: (row[COLUMN_INDEX.COMPANY] as string) ?? '',
          location: (row[COLUMN_INDEX.LOCATION] as string) ?? '',
          url: (row[COLUMN_INDEX.URL] as string) ?? '',
          probability,
          status: (row[COLUMN_INDEX.STATUS] as string) ?? '',
        });
      }
    }

    this.logger.info('Loaded existing jobs', { count: this.existingJobs.size });
  }

  /**
   * Appends new jobs and updates existing jobs if data changed
   * @param jobs The jobs to append
   * @param matchResults Optional match results for setting probability and status
   */
  async appendJobs(
    jobs: Job[],
    matchResults?: Map<string, MatchResult>
  ): Promise<WriteResult> {
    if (this.existingJobs === null) {
      await this.loadExistingJobs();
    }

    const newJobs: Job[] = [];
    const jobsToUpdate: { job: Job; rowNumber: number }[] = [];
    let skippedCount = 0;

    for (const job of jobs) {
      const existing = this.existingJobs!.get(job.jobId);
      if (!existing) {
        newJobs.push(job);
      } else if (this.hasJobChanged(job, existing)) {
        jobsToUpdate.push({ job, rowNumber: existing.rowNumber });
      } else {
        skippedCount++;
      }
    }

    if (skippedCount > 0) {
      this.logger.info('Skipping unchanged jobs', { count: skippedCount });
    }

    const sheets = this.client.getApi();
    const spreadsheetId = this.client.getSpreadsheetId();

    // Update existing jobs that have changed
    if (jobsToUpdate.length > 0) {
      await this.updateExistingJobs(jobsToUpdate);
      this.logger.info('Updated existing jobs', { count: jobsToUpdate.length });
    }

    // Add new jobs
    if (newJobs.length > 0) {
      const rows = newJobs.map((job) => this.jobToRow(job, matchResults?.get(job.jobId)));

      // Get the current row count to append at the correct position
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_NAMES.JOBS}!A:A`,
      });
      const currentRowCount = response.data.values?.length ?? 1;
      const nextRow = currentRowCount + 1;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAMES.JOBS}!A${nextRow}:P${nextRow + rows.length - 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: rows,
        },
      });

      // Update the local cache
      for (const job of newJobs) {
        const matchResult = matchResults?.get(job.jobId);
        this.existingJobs!.set(job.jobId, {
          rowNumber: currentRowCount + newJobs.indexOf(job) + 1,
          title: job.title,
          company: job.company,
          location: job.location,
          url: job.url,
          probability: matchResult?.probability ?? null,
          status: matchResult?.status ?? JobStatus.NEW,
        });
      }

      this.logger.info('Appended new jobs', { count: newJobs.length });
    } else {
      this.logger.info('No new jobs to add');
    }

    return {
      jobsAdded: newJobs.length,
      jobsUpdated: jobsToUpdate.length,
      jobsSkipped: skippedCount,
    };
  }

  /**
   * Updates probability and status for existing jobs that don't have probability set yet
   * @param matchResults Map of job IDs to match results
   * @returns Number of jobs updated
   */
  async updateExistingJobProbabilities(
    matchResults: Map<string, MatchResult>
  ): Promise<number> {
    if (this.existingJobs === null) {
      await this.loadExistingJobs();
    }

    const sheets = this.client.getApi();
    const spreadsheetId = this.client.getSpreadsheetId();

    // Find existing jobs that need probability updates
    const jobsToUpdate: { jobId: string; rowNumber: number; matchResult: MatchResult }[] = [];

    for (const [jobId, matchResult] of matchResults) {
      const existing = this.existingJobs!.get(jobId);
      if (existing && existing.probability === null && matchResult.probability !== null) {
        jobsToUpdate.push({
          jobId,
          rowNumber: existing.rowNumber,
          matchResult,
        });
      }
    }

    if (jobsToUpdate.length === 0) {
      return 0;
    }

    // Batch update probability (column E), requirements (columns O-P), and potentially status (column B)
    const data = jobsToUpdate.flatMap(({ rowNumber, matchResult }) => {
      const updates: { range: string; values: (string | number | null)[][] }[] = [
        {
          range: `${SHEET_NAMES.JOBS}!E${rowNumber}`,
          values: [[matchResult.probability]],
        },
        {
          range: `${SHEET_NAMES.JOBS}!O${rowNumber}:P${rowNumber}`,
          values: [[
            this.formatRequirementsFraction(matchResult.requirementsMet, matchResult.requirementsTotal),
            this.formatRequirementsGaps(matchResult.requirementsGaps),
          ]],
        },
      ];

      // Update status to LOW_MATCH if probability < 50 and status is NEW
      const existing = this.existingJobs!.get(
        jobsToUpdate.find((j) => j.rowNumber === rowNumber)!.jobId
      );
      if (existing && existing.status === JobStatus.NEW && matchResult.status === JobStatus.LOW_MATCH) {
        updates.push({
          range: `${SHEET_NAMES.JOBS}!B${rowNumber}`,
          values: [[JobStatus.LOW_MATCH]],
        });
      }

      return updates;
    });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    });

    // Update local cache
    for (const { jobId, matchResult } of jobsToUpdate) {
      const existing = this.existingJobs!.get(jobId);
      if (existing) {
        existing.probability = matchResult.probability;
        if (existing.status === JobStatus.NEW && matchResult.status === JobStatus.LOW_MATCH) {
          existing.status = JobStatus.LOW_MATCH;
        }
      }
    }

    this.logger.info('Updated probabilities for existing jobs', { count: jobsToUpdate.length });
    return jobsToUpdate.length;
  }

  /**
   * Checks if job data has changed (excluding status, date_added, probability, notes)
   */
  private hasJobChanged(job: Job, existing: ExistingJobData): boolean {
    return (
      sanitizeCellValue(job.title) !== existing.title ||
      sanitizeCellValue(job.company) !== existing.company ||
      sanitizeCellValue(job.location) !== existing.location ||
      job.url !== existing.url
    );
  }

  /**
   * Updates existing jobs with new data (preserving status, date_added, probability, notes)
   */
  private async updateExistingJobs(
    jobsToUpdate: { job: Job; rowNumber: number }[]
  ): Promise<void> {
    const sheets = this.client.getApi();
    const spreadsheetId = this.client.getSpreadsheetId();
    const now = this.formatDate(new Date());

    // Use batchUpdate for efficiency
    // Update columns D (date_modified) and J-M (job_title, company, location, url)
    // Skip E-I (probability, AI scores/arguments) as they're only set on initial insert
    const data = jobsToUpdate.flatMap(({ job, rowNumber }) => [
      {
        range: `${SHEET_NAMES.JOBS}!D${rowNumber}`,
        values: [[now]], // date_modified
      },
      {
        range: `${SHEET_NAMES.JOBS}!J${rowNumber}:M${rowNumber}`,
        values: [[
          sanitizeCellValue(job.title),
          sanitizeCellValue(job.company),
          sanitizeCellValue(job.location),
          job.url,
        ]],
      },
    ]);

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    });

    // Update local cache (preserve existing probability and status)
    for (const { job, rowNumber } of jobsToUpdate) {
      const existing = this.existingJobs!.get(job.jobId);
      this.existingJobs!.set(job.jobId, {
        rowNumber,
        title: sanitizeCellValue(job.title),
        company: sanitizeCellValue(job.company),
        location: sanitizeCellValue(job.location),
        url: job.url,
        probability: existing?.probability ?? null,
        status: existing?.status ?? '',
      });
    }
  }

  /**
   * Formats a date as "YYYY-MM-DD HH:mm:ss" in Guam time (UTC+10)
   */
  private formatDate(date: Date): string {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'Pacific/Guam',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    };

    const formatter = new Intl.DateTimeFormat('en-CA', options);
    const parts = formatter.formatToParts(date);

    const get = (type: string): string =>
      parts.find((p) => p.type === type)?.value ?? '00';

    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hours = get('hour');
    const minutes = get('minute');
    const seconds = get('second');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * Converts a Job to a sheet row
   * @param job The job to convert
   * @param matchResult Optional match result for setting probability and status
   */
  private jobToRow(job: Job, matchResult?: MatchResult): (string | number | null)[] {
    const now = this.formatDate(new Date());
    const status = matchResult?.status ?? JobStatus.NEW;
    const probability = matchResult?.probability ?? null;

    const row: (string | number | null)[] = new Array(COLUMN_INDEX.REQUIREMENTS_GAPS + 1).fill(null);

    row[COLUMN_INDEX.JOB_ID] = job.jobId;
    row[COLUMN_INDEX.STATUS] = status;
    row[COLUMN_INDEX.DATE_ADDED] = now;
    row[COLUMN_INDEX.DATE_MODIFIED] = now;
    row[COLUMN_INDEX.PROBABILITY] = probability;
    row[COLUMN_INDEX.GEMINI_SCORE] = matchResult?.geminiProbability ?? null;
    row[COLUMN_INDEX.GEMINI_ARGUMENT] = matchResult?.geminiReasoning
      ? sanitizeCellValue(matchResult.geminiReasoning)
      : '';
    row[COLUMN_INDEX.CLAUDE_SCORE] = matchResult?.claudeProbability ?? null;
    row[COLUMN_INDEX.CLAUDE_ARGUMENT] = matchResult?.claudeReasoning
      ? sanitizeCellValue(matchResult.claudeReasoning)
      : '';
    row[COLUMN_INDEX.JOB_TITLE] = sanitizeCellValue(job.title);
    row[COLUMN_INDEX.COMPANY] = sanitizeCellValue(job.company);
    row[COLUMN_INDEX.LOCATION] = sanitizeCellValue(job.location);
    row[COLUMN_INDEX.URL] = job.url;
    row[COLUMN_INDEX.NOTES] = '';
    row[COLUMN_INDEX.REQUIREMENTS_MET] = this.formatRequirementsFraction(
      matchResult?.requirementsMet,
      matchResult?.requirementsTotal
    );
    row[COLUMN_INDEX.REQUIREMENTS_GAPS] = this.formatRequirementsGaps(matchResult?.requirementsGaps);

    return row;
  }

  /**
   * Formats requirements as a fraction string (e.g., "7/10")
   */
  private formatRequirementsFraction(met?: number | null, total?: number | null): string {
    if (met === null || met === undefined || total === null || total === undefined) {
      return '';
    }
    return `${met}/${total}`;
  }

  /**
   * Formats requirements gaps as a semicolon-separated string
   */
  private formatRequirementsGaps(gaps?: string[]): string {
    if (!gaps || gaps.length === 0) {
      return '';
    }
    return sanitizeCellValue(gaps.join('; '));
  }

  /**
   * Gets the count of existing jobs in the sheet
   */
  async getExistingJobCount(): Promise<number> {
    if (this.existingJobs === null) {
      await this.loadExistingJobs();
    }
    return this.existingJobs!.size;
  }

  /**
   * Checks if a job already exists in the sheet
   */
  async jobExists(jobId: string): Promise<boolean> {
    if (this.existingJobs === null) {
      await this.loadExistingJobs();
    }
    return this.existingJobs!.has(jobId);
  }

  /**
   * Returns the set of existing job IDs for filtering before analysis
   * Also returns job IDs that exist but don't have a probability score yet
   */
  async getExistingJobIds(): Promise<{
    allJobIds: Set<string>;
    jobsNeedingAnalysis: Set<string>;
  }> {
    if (this.existingJobs === null) {
      await this.loadExistingJobs();
    }

    const allJobIds = new Set<string>();
    const jobsNeedingAnalysis = new Set<string>();

    for (const [jobId, data] of this.existingJobs!) {
      allJobIds.add(jobId);
      // Jobs that exist but don't have probability and are still NEW status
      if (data.probability === null && data.status === JobStatus.NEW) {
        jobsNeedingAnalysis.add(jobId);
      }
    }

    return { allJobIds, jobsNeedingAnalysis };
  }

  /**
   * Gets existing job data for a specific job ID (for re-analysis)
   */
  getExistingJobData(jobId: string): ExistingJobData | undefined {
    return this.existingJobs?.get(jobId);
  }
}
