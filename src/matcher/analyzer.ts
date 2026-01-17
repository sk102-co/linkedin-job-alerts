/**
 * @module matcher/analyzer
 *
 * Orchestrates job-resume matching analysis.
 *
 * This module coordinates the job matching workflow:
 * 1. Loads the candidate's resume from Google Docs (cached for session)
 * 2. Analyzes jobs in parallel (max 3 concurrent) using AI (Gemini, Claude, or both)
 * 3. Determines job status based on match probability threshold
 * 4. Returns aggregated statistics for logging
 *
 * Dual-model analysis (optional):
 * - When both Gemini and Claude are configured, runs Gemini first to fetch job description
 * - Job description from Gemini is passed to Claude for consistent evaluation
 * - Final probability is the average of both scores (ensemble)
 * - Individual scores stored for comparison (geminiProbability, claudeProbability)
 *
 * Parallel processing:
 * - Up to 3 jobs are analyzed concurrently for faster throughput
 * - Each job runs Gemini → Claude sequentially (to share job description)
 * - Results maintain original job order
 *
 * Status determination:
 * - Jobs with probability >= 70% get status "NEW" (worth reviewing)
 * - Jobs with probability < 70% get status "LOW MATCH" (likely poor fit)
 * - Jobs that couldn't be analyzed get status "NOT AVAILABLE" (posting expired/inaccessible)
 *
 * @example
 * ```typescript
 * // Single model (Gemini only)
 * const analyzer = new JobResumeAnalyzer(geminiClient, docsClient, logger);
 *
 * // Dual model (Gemini + Claude for comparison)
 * const analyzer = new JobResumeAnalyzer(geminiClient, docsClient, logger, claudeClient);
 *
 * await analyzer.loadResume(resumeDocId);
 * const results = await analyzer.analyzeJobs(jobs);
 *
 * for (const [jobId, result] of results) {
 *   console.log(`${jobId}: ${result.probability}% - ${result.status}`);
 *   if (result.geminiProbability !== undefined) {
 *     console.log(`  Gemini: ${result.geminiProbability}%, Claude: ${result.claudeProbability}%`);
 *   }
 * }
 * ```
 */

import { GeminiClient } from '../gemini';
import { ClaudeClient } from '../claude';
import { DocsClient } from '../docs';
import { Logger } from '../utils/logger';
import { Job } from '../types';
import { JobStatus, LOW_MATCH_THRESHOLD } from '../sheets/schema';

/**
 * Maximum number of jobs to analyze concurrently
 */
const MAX_CONCURRENT_JOBS = 3;

/**
 * Represents the result of analyzing a single job
 */
export interface MatchResult {
  jobId: string;
  probability: number | null;
  status: JobStatus;
  reasoning: string;
  /** Gemini's individual probability score (when dual-model is enabled) */
  geminiProbability?: number | null;
  /** Claude's individual probability score (when dual-model is enabled) */
  claudeProbability?: number | null;
  /** Gemini's reasoning (when dual-model is enabled) */
  geminiReasoning?: string;
  /** Claude's reasoning (when dual-model is enabled) */
  claudeReasoning?: string;
}

/**
 * Orchestrates job-resume matching analysis
 */
export class JobResumeAnalyzer {
  private readonly geminiClient: GeminiClient;
  private readonly claudeClient: ClaudeClient | null;
  private readonly docsClient: DocsClient;
  private readonly logger: Logger;
  private resumeText: string | null = null;

  /**
   * Creates a new JobResumeAnalyzer
   * @param geminiClient The Gemini client for AI analysis
   * @param docsClient The Google Docs client for resume loading
   * @param logger The logger instance
   * @param claudeClient Optional Claude client for dual-model analysis
   */
  constructor(
    geminiClient: GeminiClient,
    docsClient: DocsClient,
    logger: Logger,
    claudeClient?: ClaudeClient
  ) {
    this.geminiClient = geminiClient;
    this.docsClient = docsClient;
    this.logger = logger;
    this.claudeClient = claudeClient ?? null;

    if (this.claudeClient) {
      this.logger.info('Dual-model analysis enabled (Gemini + Claude)');
    }
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
      // Run dual-model analysis if Claude is configured
      if (this.claudeClient) {
        return await this.analyzeDualModel(job);
      }

      // Single-model analysis (Gemini only)
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
   * Performs dual-model analysis using both Gemini and Claude
   * Runs Gemini first to fetch job description, then passes it to Claude
   */
  private async analyzeDualModel(job: Job): Promise<MatchResult> {
    if (!this.resumeText || !this.claudeClient) {
      return this.createDefaultResult(job.jobId);
    }

    this.logger.info('Running dual-model analysis', {
      jobId: job.jobId,
      title: job.title,
    });

    // Run Gemini first to get job description
    const geminiResult = await this.geminiClient
      .calculateMatchProbability(job, this.resumeText)
      .catch((error) => {
        this.logger.error('Gemini analysis failed', {
          jobId: job.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

    // Extract job description from Gemini's response to share with Claude
    const jobDescription = geminiResult?.jobDescription;

    if (jobDescription) {
      this.logger.info('Job description fetched by Gemini, sharing with Claude', {
        jobId: job.jobId,
        descriptionLength: jobDescription.length,
      });
    }

    // Run Claude with the job description (if available)
    const claudeResult = await this.claudeClient
      .calculateMatchProbability(job, this.resumeText, jobDescription)
      .catch((error) => {
        this.logger.error('Claude analysis failed', {
          jobId: job.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

    // Both failed - mark as not available
    if (!geminiResult && !claudeResult) {
      this.logger.warn('Both models failed to analyze job', {
        jobId: job.jobId,
        title: job.title,
      });
      return this.createNotAvailableResult(job.jobId);
    }

    // Calculate ensemble probability (average of available scores)
    const geminiProbability = geminiResult?.probability ?? null;
    const claudeProbability = claudeResult?.probability ?? null;

    let probability: number | null;
    if (geminiProbability !== null && claudeProbability !== null) {
      // Both available - use average
      probability = Math.round((geminiProbability + claudeProbability) / 2);
    } else {
      // Only one available - use that one
      probability = geminiProbability ?? claudeProbability;
    }

    // Combine reasoning from both models
    const reasoningParts: string[] = [];
    if (geminiResult?.reasoning) {
      reasoningParts.push(`Gemini: ${geminiResult.reasoning}`);
    }
    if (claudeResult?.reasoning) {
      reasoningParts.push(`Claude: ${claudeResult.reasoning}`);
    }
    const combinedReasoning = reasoningParts.join(' | ');

    const status = this.determineStatus(probability);

    this.logger.info('Dual-model analysis complete', {
      jobId: job.jobId,
      geminiProbability,
      claudeProbability,
      ensembleProbability: probability,
      status,
    });

    return {
      jobId: job.jobId,
      probability,
      status,
      reasoning: combinedReasoning,
      geminiProbability,
      claudeProbability,
      geminiReasoning: geminiResult?.reasoning,
      claudeReasoning: claudeResult?.reasoning,
    };
  }

  /**
   * Analyzes multiple jobs with parallel processing (max 3 concurrent)
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

    this.logger.info('Starting parallel job analysis', {
      jobCount: jobs.length,
      maxConcurrent: MAX_CONCURRENT_JOBS,
    });

    // Process jobs in parallel with concurrency limit
    const jobResults = await this.processWithConcurrencyLimit(
      jobs,
      async (job, index) => {
        this.logger.info('Analyzing job', {
          index: index + 1,
          total: jobs.length,
          jobId: job.jobId,
          title: job.title,
        });
        return this.analyzeJob(job);
      },
      MAX_CONCURRENT_JOBS
    );

    // Populate results map
    for (let i = 0; i < jobs.length; i++) {
      results.set(jobs[i].jobId, jobResults[i]);
    }

    const stats = this.calculateStats(results);
    this.logger.info('Job analysis complete', stats);

    return results;
  }

  /**
   * Processes items with a concurrency limit
   * @param items Items to process
   * @param processor Function to process each item
   * @param limit Maximum concurrent operations
   * @returns Array of results in same order as input
   */
  private async processWithConcurrencyLimit<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    limit: number
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let currentIndex = 0;

    const runNext = async (): Promise<void> => {
      while (currentIndex < items.length) {
        const index = currentIndex++;
        const item = items[index];
        results[index] = await processor(item, index);
      }
    };

    // Start up to 'limit' concurrent workers
    const workers = Array.from(
      { length: Math.min(limit, items.length) },
      () => runNext()
    );

    await Promise.all(workers);
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

}
