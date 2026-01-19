import { Job } from '../types/job';
import { Logger } from './logger';

/**
 * Checks if a company is in the ignore list (case-insensitive exact match)
 * @param company The company name to check
 * @param ignoredCompanies Set of ignored company names (already lowercased)
 * @returns true if the company should be ignored
 */
export function isCompanyIgnored(
  company: string,
  ignoredCompanies: Set<string>
): boolean {
  return ignoredCompanies.has(company.toLowerCase().trim());
}

/**
 * Result of filtering jobs by company
 */
export interface CompanyFilterResult {
  filtered: Job[];
  ignoredCount: number;
}

/**
 * Filters out jobs from ignored companies
 * @param jobs The jobs to filter
 * @param ignoredCompanies Set of ignored company names (already lowercased)
 * @param logger Logger for recording skipped jobs
 * @returns Object containing filtered jobs and count of ignored jobs
 */
export function filterJobsByCompany(
  jobs: Job[],
  ignoredCompanies: Set<string>,
  logger: Logger
): CompanyFilterResult {
  if (ignoredCompanies.size === 0) {
    return { filtered: jobs, ignoredCount: 0 };
  }

  const filtered: Job[] = [];
  let ignoredCount = 0;

  for (const job of jobs) {
    if (isCompanyIgnored(job.company, ignoredCompanies)) {
      logger.info('Job ignored - company in ignore list', {
        jobId: job.jobId,
        company: job.company,
      });
      ignoredCount++;
    } else {
      filtered.push(job);
    }
  }

  return { filtered, ignoredCount };
}

/**
 * Normalizes company names from the config sheet to a lowercase Set
 * @param companyNames Raw company names from the sheet
 * @returns Set of normalized (lowercase, trimmed) company names
 */
export function normalizeCompanyNames(companyNames: string[]): Set<string> {
  const normalized = new Set<string>();

  for (const name of companyNames) {
    const trimmed = name.trim();
    if (trimmed.length > 0) {
      normalized.add(trimmed.toLowerCase());
    }
  }

  return normalized;
}
