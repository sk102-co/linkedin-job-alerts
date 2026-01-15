import { z } from 'zod';

/**
 * LinkedIn job URL pattern for validation
 */
const LINKEDIN_JOB_URL_PATTERN = /^https:\/\/(?:www\.)?linkedin\.com\/jobs\/view\/\d+/;

/**
 * Zod schema for validating parsed job data
 */
export const JobSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
  title: z.string().min(1, 'Job title is required'),
  company: z.string().min(1, 'Company name is required'),
  location: z.string(),
  url: z.string().regex(LINKEDIN_JOB_URL_PATTERN, 'Invalid LinkedIn job URL'),
  probability: z.number().min(0).max(100).nullable().optional(),
});

/**
 * Represents a parsed LinkedIn job posting
 */
export interface Job {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  probability?: number | null;
}

/**
 * Represents a job row as stored in the Google Sheet
 */
export interface JobRow extends Job {
  status: string;
  dateAdded: Date;
  dateModified: Date;
  probability: number | null;
  notes: string;
}

/**
 * Validates and parses raw job data using Zod schema
 * @throws ZodError if validation fails
 */
export function parseJob(data: unknown): Job {
  return JobSchema.parse(data);
}

/**
 * Safely validates job data, returning null if invalid
 */
export function safeParseJob(data: unknown): Job | null {
  const result = JobSchema.safeParse(data);
  return result.success ? result.data : null;
}
