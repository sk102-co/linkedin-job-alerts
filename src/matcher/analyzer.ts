/**
 * @module matcher/analyzer
 *
 * Orchestrates job-resume matching analysis.
 *
 * This module coordinates the job matching workflow:
 * 1. Loads the candidate's resume from Google Docs (cached for session)
 * 2. Analyzes each job using Gemini AI with rate limiting
 * 3. Determines job status based on match probability threshold
 * 4. Returns aggregated statistics for logging
 *
 * Status determination:
 * - Jobs with probability >= 70% get status "NEW" (worth reviewing)
 * - Jobs with probability < 70% get status "LOW MATCH" (likely poor fit)
 * - Jobs that couldn't be analyzed get status "NOT AVAILABLE" (posting expired/inaccessible)
 *
 * Rate limiting:
 * - 500ms delay between API calls to avoid Gemini rate limits
 * - Each analysis takes ~30-40 seconds due to Google Search grounding
 *
 * @example
 * ```typescript
 * const analyzer = new JobResumeAnalyzer(geminiClient, docsClient, logger);
 * await analyzer.loadResume(resumeDocId);
 * const results = await analyzer.analyzeJobs(jobs);
 *
 * for (const [jobId, result] of results) {
 *   console.log(`${jobId}: ${result.probability}% - ${result.status}`);
 * }
 * ```
 */

import { GeminiClient } from '../gemini';
import { DocsClient } from '../docs';
import { Logger } from '../utils/logger';
import { Job } from '../types';
import { JobStatus, LOW_MATCH_THRESHOLD } from '../sheets/schema';

/**
 * Delay between Gemini API calls to avoid rate limiting (ms)
 */
const API_CALL_DELAY_MS = 500;

/**
 * Represents the result of analyzing a single job
 */
export interface MatchResult {
  jobId: string;
  probability: number | null;
  status: JobStatus;
  reasoning: string;
}

/**
 * Orchestrates job-resume matching analysis
 */
export class JobResumeAnalyzer {
  private readonly geminiClient: GeminiClient;
  private readonly docsClient: DocsClient;
  private readonly logger: Logger;
  private resumeText: string | null = null;

  constructor(geminiClient: GeminiClient, docsClient: DocsClient, logger: Logger) {
    this.geminiClient = geminiClient;
    this.docsClient = docsClient;
    this.logger = logger;
  }

  /**
   * Loads the resume from Google Docs and caches it for the session
   * @param documentId The Google Docs document ID containing the resume
   */
  async loadResume(documentId: string): Promise<void> {
    this.logger.info('Loading resume from Google Docs');

    try {
      this.resumeText = await this.docsClient.getDocumentText(documentId);
      this.logger.info('Resume loaded successfully', {
        characterCount: this.resumeText.length,
      });
    } catch (error) {
      this.logger.error('Failed to load resume', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Analyzes a single job and returns the match result
   * @param job The job to analyze
   * @returns Match result with probability and status
   */
  async analyzeJob(job: Job): Promise<MatchResult> {
    if (!this.resumeText) {
      this.logger.warn('Resume not loaded, returning default status', { jobId: job.jobId });
      return this.createDefaultResult(job.jobId);
    }

    try {
      // Calculate match probability using Gemini
      const analysisResult = await this.geminiClient.calculateMatchProbability(
        job,
        this.resumeText
      );

      if (!analysisResult) {
        this.logger.warn('Could not calculate match probability - job may no longer be available', {
          jobId: job.jobId,
          title: job.title,
        });
        return this.createNotAvailableResult(job.jobId);
      }

      const status = this.determineStatus(analysisResult.probability);

      return {
        jobId: job.jobId,
        probability: analysisResult.probability,
        status,
        reasoning: analysisResult.reasoning,
      };
    } catch (error) {
      this.logger.error('Error analyzing job - marking as not available', {
        jobId: job.jobId,
        title: job.title,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.createNotAvailableResult(job.jobId);
    }
  }

  /**
   * Analyzes multiple jobs with rate limiting
   * @param jobs The jobs to analyze
   * @returns Map of job ID to match result
   */
  async analyzeJobs(jobs: Job[]): Promise<Map<string, MatchResult>> {
    const results = new Map<string, MatchResult>();

    if (jobs.length === 0) {
      return results;
    }

    if (!this.resumeText) {
      this.logger.warn('Resume not loaded, returning default status for all jobs');
      for (const job of jobs) {
        results.set(job.jobId, this.createDefaultResult(job.jobId));
      }
      return results;
    }

    this.logger.info('Starting job analysis', { jobCount: jobs.length });

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];

      this.logger.info('Analyzing job', {
        index: i + 1,
        total: jobs.length,
        jobId: job.jobId,
        title: job.title,
      });

      const result = await this.analyzeJob(job);
      results.set(job.jobId, result);

      // Add delay between API calls to avoid rate limiting (except for last job)
      if (i < jobs.length - 1) {
        await this.delay(API_CALL_DELAY_MS);
      }
    }

    const stats = this.calculateStats(results);
    this.logger.info('Job analysis complete', stats);

    return results;
  }

  /**
   * Determines the job status based on match probability
   */
  private determineStatus(probability: number | null): JobStatus {
    if (probability === null) {
      return JobStatus.NEW;
    }

    if (probability < LOW_MATCH_THRESHOLD) {
      return JobStatus.LOW_MATCH;
    }

    return JobStatus.NEW;
  }

  /**
   * Creates a default result when resume is not loaded
   */
  private createDefaultResult(jobId: string): MatchResult {
    return {
      jobId,
      probability: null,
      status: JobStatus.NEW,
      reasoning: '',
    };
  }

  /**
   * Creates a result for jobs that couldn't be analyzed (likely no longer available)
   */
  private createNotAvailableResult(jobId: string): MatchResult {
    return {
      jobId,
      probability: null,
      status: JobStatus.NOT_AVAILABLE,
      reasoning: 'Job posting could not be found or is no longer accepting applications',
    };
  }

  /**
   * Calculates statistics from analysis results
   */
  private calculateStats(results: Map<string, MatchResult>): {
    total: number;
    analyzed: number;
    lowMatch: number;
    notAvailable: number;
    averageProbability: number | null;
  } {
    const values = Array.from(results.values());
    const analyzedJobs = values.filter((r) => r.probability !== null);
    const lowMatchJobs = values.filter((r) => r.status === JobStatus.LOW_MATCH);
    const notAvailableJobs = values.filter((r) => r.status === JobStatus.NOT_AVAILABLE);

    const probabilities = analyzedJobs.map((r) => r.probability).filter((p): p is number => p !== null);
    const averageProbability =
      probabilities.length > 0
        ? Math.round(probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length)
        : null;

    return {
      total: values.length,
      analyzed: analyzedJobs.length,
      lowMatch: lowMatchJobs.length,
      notAvailable: notAvailableJobs.length,
      averageProbability,
    };
  }

  /**
   * Delays execution for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
