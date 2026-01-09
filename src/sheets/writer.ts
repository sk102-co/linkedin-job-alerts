import { Job } from '../types/job';
import { Logger } from '../utils/logger';
import { SheetsClient } from './client';
import {
  SHEET_NAMES,
  COLUMN_INDEX,
  JobStatus,
  sanitizeCellValue,
} from './schema';

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
  officeLocation: string;
  workType: string;
  url: string;
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
      range: `${SHEET_NAMES.JOBS}!A:J`,
    });

    const values = response.data.values ?? [];
    this.existingJobs = new Map();

    // Skip header row, start from row 2 (index 1)
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const jobId = row[COLUMN_INDEX.JOB_ID] as string;
      if (jobId) {
        this.existingJobs.set(jobId, {
          rowNumber: i + 1, // 1-based row number in sheet
          title: (row[COLUMN_INDEX.JOB_TITLE] as string) || '',
          company: (row[COLUMN_INDEX.COMPANY] as string) || '',
          officeLocation: (row[COLUMN_INDEX.OFFICE_LOCATION] as string) || '',
          workType: (row[COLUMN_INDEX.WORK_TYPE] as string) || '',
          url: (row[COLUMN_INDEX.URL] as string) || '',
        });
      }
    }

    this.logger.info('Loaded existing jobs', { count: this.existingJobs.size });
  }

  /**
   * Appends new jobs and updates existing jobs if data changed
   */
  async appendJobs(jobs: Job[]): Promise<WriteResult> {
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
      const rows = newJobs.map((job) => this.jobToRow(job));

      // Get the current row count to append at the correct position
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_NAMES.JOBS}!A:A`,
      });
      const currentRowCount = response.data.values?.length ?? 1;
      const nextRow = currentRowCount + 1;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAMES.JOBS}!A${nextRow}:J${nextRow + rows.length - 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: rows,
        },
      });

      // Update the local cache
      for (const job of newJobs) {
        this.existingJobs!.set(job.jobId, {
          rowNumber: currentRowCount + newJobs.indexOf(job) + 1,
          title: job.title,
          company: job.company,
          officeLocation: job.officeLocation,
          workType: job.workType,
          url: job.url,
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
   * Checks if job data has changed (excluding status, date_added, notes)
   */
  private hasJobChanged(job: Job, existing: ExistingJobData): boolean {
    return (
      sanitizeCellValue(job.title) !== existing.title ||
      sanitizeCellValue(job.company) !== existing.company ||
      sanitizeCellValue(job.officeLocation) !== existing.officeLocation ||
      job.workType !== existing.workType ||
      job.url !== existing.url
    );
  }

  /**
   * Updates existing jobs with new data (preserving status, date_added, notes)
   */
  private async updateExistingJobs(
    jobsToUpdate: { job: Job; rowNumber: number }[]
  ): Promise<void> {
    const sheets = this.client.getApi();
    const spreadsheetId = this.client.getSpreadsheetId();
    const now = this.formatDate(new Date());

    // Use batchUpdate for efficiency
    const data = jobsToUpdate.map(({ job, rowNumber }) => ({
      range: `${SHEET_NAMES.JOBS}!D${rowNumber}:I${rowNumber}`,
      values: [[
        now, // date_modified
        sanitizeCellValue(job.title),
        sanitizeCellValue(job.company),
        sanitizeCellValue(job.officeLocation),
        job.workType,
        job.url,
      ]],
    }));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    });

    // Update local cache
    for (const { job, rowNumber } of jobsToUpdate) {
      this.existingJobs!.set(job.jobId, {
        rowNumber,
        title: sanitizeCellValue(job.title),
        company: sanitizeCellValue(job.company),
        officeLocation: sanitizeCellValue(job.officeLocation),
        workType: job.workType,
        url: job.url,
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
   */
  private jobToRow(job: Job): (string | null)[] {
    const now = this.formatDate(new Date());

    const row: (string | null)[] = new Array(COLUMN_INDEX.NOTES + 1).fill(null);

    row[COLUMN_INDEX.JOB_ID] = job.jobId;
    row[COLUMN_INDEX.STATUS] = JobStatus.NEW;
    row[COLUMN_INDEX.DATE_ADDED] = now;
    row[COLUMN_INDEX.DATE_MODIFIED] = now;
    row[COLUMN_INDEX.JOB_TITLE] = sanitizeCellValue(job.title);
    row[COLUMN_INDEX.COMPANY] = sanitizeCellValue(job.company);
    row[COLUMN_INDEX.OFFICE_LOCATION] = sanitizeCellValue(job.officeLocation);
    row[COLUMN_INDEX.WORK_TYPE] = job.workType;
    row[COLUMN_INDEX.URL] = job.url;
    row[COLUMN_INDEX.NOTES] = '';

    return row;
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
}
