import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { Job, safeParseJob, WorkType } from '../types/job';
import { Logger } from '../utils/logger';

/**
 * Pattern to extract work type from location string
 * Matches: "Location (Remote)", "Location (On-site)", "Location (Hybrid)"
 */
const WORK_TYPE_PATTERN = /^(.+?)\s*\((Remote|On-site|Hybrid)\)$/i;

/**
 * Regex pattern to extract job ID from LinkedIn job URL
 * Handles both /jobs/view/ and /comm/jobs/view/ paths
 */
const JOB_ID_PATTERN = /\/(?:comm\/)?jobs\/view\/(\d+)/;

/**
 * Valid LinkedIn job URL pattern (after cleaning)
 * We validate the cleaned URL which uses the standard /jobs/view/ format
 */
const LINKEDIN_JOB_URL_PATTERN = /^https:\/\/(?:www\.)?linkedin\.com\/jobs\/view\/\d+$/;

/**
 * Parser for LinkedIn job alert emails
 * Extracts job postings from the HTML email body
 */
export class LinkedInEmailParser {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Parses a LinkedIn job alert email and extracts all job postings
   */
  parseEmail(htmlBody: string): Job[] {
    const $ = cheerio.load(htmlBody);
    const jobs: Job[] = [];

    // LinkedIn job alert emails have job cards with data-test-id="job-card"
    // Each card contains structured data: title link, company img, location paragraph
    $('td[data-test-id="job-card"]').each((_, element) => {
      const job = this.extractJobFromCard($, $(element));
      if (job) {
        jobs.push(job);
      }
    });

    // Deduplicate by job ID (same job might appear multiple times in email)
    const uniqueJobs = this.deduplicateJobs(jobs);

    this.logger.info('Parsed jobs from email', {
      totalFound: jobs.length,
      uniqueJobs: uniqueJobs.length,
    });

    return uniqueJobs;
  }

  /**
   * Extracts job information from a job card element
   *
   * LinkedIn job card structure:
   * - Title: <a class="font-bold"> with href containing jobs/view/
   * - Company: <img alt="CompanyName">
   * - Location: First <p> element often contains "Company · Location"
   */
  private extractJobFromCard(
    $: cheerio.CheerioAPI,
    card: cheerio.Cheerio<AnyNode>
  ): Job | null {
    // Find the job URL from any link with jobs/view
    const jobLink = card.find('a[href*="jobs/view"]').first();
    const rawUrl = jobLink.attr('href');
    if (!rawUrl) {
      return null;
    }

    // Clean and validate the URL
    const url = this.cleanUrl(rawUrl);
    if (!LINKEDIN_JOB_URL_PATTERN.test(url)) {
      return null;
    }

    // Extract job ID from URL
    const jobIdMatch = url.match(JOB_ID_PATTERN);
    if (!jobIdMatch) {
      return null;
    }
    const jobId = jobIdMatch[1];

    // Extract job title - try multiple selectors for different email formats
    let title = '';

    // Strategy 1: font-bold link (jobalerts-noreply format)
    const fontBoldLink = card.find('a.font-bold[href*="jobs/view"]');
    if (fontBoldLink.length > 0) {
      title = fontBoldLink.text().trim();
    }

    // Strategy 2: Any link to jobs/view with text (not containing an image)
    if (!title) {
      card.find('a[href*="jobs/view"]').each((_, el): boolean | void => {
        const $el = $(el);
        const linkText = $el.text().trim();
        // Skip links that only contain images or have no meaningful text
        if (linkText && linkText.length > 2 && !$el.find('img').length) {
          title = linkText;
          return false; // break
        }
      });
    }

    // Strategy 3: Look for job title in common heading elements within the card
    if (!title) {
      const headingSelectors = ['h3', 'h4', '[data-test-id="job-title"]'];
      for (const selector of headingSelectors) {
        const heading = card.find(selector).first();
        const text = heading.text().trim();
        if (text && text.length > 2) {
          title = text;
          break;
        }
      }
    }

    title = title || 'Unknown Title';

    // Extract company name from img alt attribute
    const companyImg = card.find('img[alt]:not([alt=""])').first();
    let company = companyImg.attr('alt') || '';

    // Filter out non-company alt texts like "Premium", empty strings, etc.
    if (['Premium', 'premium', ''].includes(company)) {
      company = '';
    }

    // Extract location from paragraph text
    let location = '';
    const paragraphs = card.find('p');
    paragraphs.each((_, p) => {
      const text = $(p).text().trim();
      // Look for text that contains location patterns (after ·)
      if (text.includes('·') && !location) {
        const parts = text.split('·').map(s => s.trim());
        if (parts.length >= 2) {
          // If we don't have company yet, try to get it from here
          if (!company && parts[0]) {
            company = parts[0];
          }
          location = parts.slice(1).join(' · ').trim();
        }
      }
    });

    // Fallback: look for common location patterns in the card text
    if (!location) {
      const cardText = card.text();
      const locationPatterns = [
        /United States(?:\s*\([^)]+\))?/i,
        /Remote/i,
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})(?:\s*\([^)]+\))?/,
      ];

      for (const pattern of locationPatterns) {
        const match = cardText.match(pattern);
        if (match) {
          location = match[0];
          break;
        }
      }
    }

    // Parse location into office location and work type
    const { officeLocation, workType } = this.parseLocation(location);

    const jobData = {
      jobId,
      title,
      company: company || 'Unknown Company',
      officeLocation,
      workType,
      url,
    };

    // Validate using Zod schema
    const validatedJob = safeParseJob(jobData);
    if (!validatedJob) {
      this.logger.warn('Job validation failed', { jobId });
      return null;
    }

    return validatedJob;
  }

  /**
   * Cleans a LinkedIn job URL by removing tracking parameters
   */
  private cleanUrl(rawUrl: string): string {
    try {
      const url = new URL(rawUrl);

      // Only keep the base job URL path
      const jobIdMatch = url.pathname.match(JOB_ID_PATTERN);
      if (jobIdMatch) {
        return `https://www.linkedin.com/jobs/view/${jobIdMatch[1]}`;
      }

      return rawUrl;
    } catch {
      // If URL parsing fails, return original
      return rawUrl;
    }
  }

  /**
   * Parses a location string into office location and work type
   * Examples:
   *   "United States (Remote)" → { officeLocation: "United States", workType: "Remote" }
   *   "Boston, MA" → { officeLocation: "Boston, MA", workType: "" }
   *   "Bedford, MA (On-site)" → { officeLocation: "Bedford, MA", workType: "On-site" }
   */
  private parseLocation(location: string): { officeLocation: string; workType: WorkType } {
    if (!location) {
      return { officeLocation: '', workType: '' };
    }

    const match = location.match(WORK_TYPE_PATTERN);
    if (match) {
      const rawWorkType = match[2];
      // Normalize work type to proper casing
      let workType: WorkType = '';
      if (rawWorkType.toLowerCase() === 'remote') {
        workType = 'Remote';
      } else if (rawWorkType.toLowerCase() === 'on-site') {
        workType = 'On-site';
      } else if (rawWorkType.toLowerCase() === 'hybrid') {
        workType = 'Hybrid';
      }
      return {
        officeLocation: match[1].trim(),
        workType,
      };
    }

    // No work type in parentheses - return location as-is
    return { officeLocation: location, workType: '' };
  }

  /**
   * Deduplicates jobs by job ID
   */
  private deduplicateJobs(jobs: Job[]): Job[] {
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
}
