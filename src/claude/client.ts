/**
 * @module claude/client
 *
 * Claude AI client for job-resume matching analysis.
 *
 * This module uses Anthropic's Claude API to analyze job postings and calculate
 * match probabilities against a candidate's resume. It provides an alternative
 * to Gemini for comparison or ensemble analysis.
 *
 * Key features:
 * - Conservative scoring with explicit penalty guidelines (0-100 scale)
 * - Structured JSON response parsing with markdown code block handling
 * - Consistent scoring criteria with Gemini for fair comparison
 *
 * Scoring guidelines (same as Gemini for consistency):
 * - 0-40: Poor match (missing required qualifications)
 * - 41-55: Below average (meets minimum but gaps in preferred)
 * - 56-70: Average match (most requirements met)
 * - 71-80: Good match (all required, most preferred)
 * - 81-100: Strong/exceptional match (exceeds requirements)
 *
 * @example
 * ```typescript
 * const claudeClient = new ClaudeClient(projectId, logger);
 * await claudeClient.initialize();
 * const result = await claudeClient.calculateMatchProbability(job, resumeText);
 * console.log(result.probability, result.reasoning);
 * ```
 */

import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '../utils/logger';
import { getSecret, SECRET_NAMES } from '../utils/secrets';
import { parseAIJsonResponse } from '../utils/json-parser';
import { Job } from '../types';

/**
 * Model to use for analysis
 */
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

/**
 * Maximum tokens for response
 */
const MAX_TOKENS = 1024;

/**
 * Represents the match analysis result
 */
export interface MatchAnalysisResult {
  probability: number;
  reasoning: string;
  /** Number of requirements the candidate meets */
  requirementsMet?: number;
  /** Total number of requirements from the job posting */
  requirementsTotal?: number;
  /** List of unmet requirements with brief explanations */
  requirementsGaps?: string[];
}

/**
 * Claude client for job-resume match analysis
 */
export class ClaudeClient {
  private client: Anthropic | null = null;
  private readonly logger: Logger;
  private readonly projectId: string;

  constructor(projectId: string, logger: Logger) {
    this.projectId = projectId;
    this.logger = logger;
  }

  /**
   * Initializes the Claude client with API key from Secret Manager
   */
  async initialize(): Promise<void> {
    const apiKey = await getSecret(this.projectId, SECRET_NAMES.CLAUDE_API_KEY);

    this.client = new Anthropic({ apiKey });
    this.logger.info('Claude client initialized', { model: CLAUDE_MODEL });
  }

  /**
   * Calculates match probability between a job and resume
   * @param job The job from the email (title, company, location, url)
   * @param resumeText The candidate's resume text
   * @param jobDescription Optional job description fetched by Gemini
   * @returns Match probability (0-100) or null if analysis fails
   */
  async calculateMatchProbability(
    job: Job,
    resumeText: string,
    jobDescription?: string
  ): Promise<MatchAnalysisResult | null> {
    if (!this.client) {
      throw new Error('Claude client not initialized. Call initialize() first.');
    }

    this.logger.info('Calculating match probability with Claude', {
      jobTitle: job.title,
      company: job.company,
      hasJobDescription: Boolean(jobDescription),
    });

    const jobInfoSection = jobDescription
      ? `## JOB INFORMATION

Job: "${job.title}" at "${job.company}" in "${job.location}"
LinkedIn URL: ${job.url}

## JOB DESCRIPTION

${jobDescription}`
      : `## JOB INFORMATION

Job: "${job.title}" at "${job.company}" in "${job.location}"
LinkedIn URL: ${job.url}

Note: You don't have access to the full job description. Base your analysis on the job title, company, and location provided, combined with typical requirements for this type of role.`;

    const penaltiesSection = jobDescription
      ? `### AUTOMATIC SCORE PENALTIES (apply these strictly):

**Critical gaps (each reduces score by 15-25 points):**
- Missing a REQUIRED technical skill explicitly listed in the job description
- Less experience than the MINIMUM years required
- Missing required degree/certification if stated as "required"
- No experience in a required industry/domain (e.g., "fintech experience required")

**Significant gaps (each reduces score by 10-15 points):**
- Missing 2+ preferred technical skills
- Experience is in a different domain (e.g., B2C vs B2B, startup vs enterprise)
- Location mismatch for non-remote roles
- Missing preferred degree level (e.g., has BS, role prefers MS/PhD)

**Minor gaps (each reduces score by 5-10 points):**
- Missing 1 preferred skill
- Slightly less experience than preferred (but meets minimum)
- Related but not exact industry experience`
      : `### AUTOMATIC SCORE PENALTIES (apply these strictly):

**Critical gaps (each reduces score by 15-25 points):**
- Missing a REQUIRED technical skill typically needed for this role type
- Less experience than typically required for senior/lead roles
- No experience in the required industry/domain if role implies it

**Significant gaps (each reduces score by 10-15 points):**
- Missing 2+ preferred technical skills for this role type
- Experience is in a different domain (e.g., B2C vs B2B, startup vs enterprise)
- Location mismatch for non-remote roles

**Minor gaps (each reduces score by 5-10 points):**
- Missing 1 preferred skill
- Slightly less experience than typically preferred
- Related but not exact industry experience`;

    const reasoningInstruction = jobDescription
      ? '2-3 sentences citing SPECIFIC requirements from the job description and how the candidate does or doesn\'t meet them'
      : '2-3 sentences explaining how the candidate\'s specific skills and experience align or don\'t align with typical requirements for this role type';

    const prompt = `You are a strict, realistic technical recruiter evaluating job fit. Your assessments directly impact whether candidates waste time applying to unsuitable positions.

${jobInfoSection}

## CANDIDATE'S RESUME

${resumeText}

## STRICT MATCH EVALUATION

Score the match probability from 0-100. BE CONSERVATIVE AND REALISTIC.

${penaltiesSection}

### SCORING SCALE:

- 0-25: Severely unqualified - missing multiple required qualifications
- 26-40: Poor match - missing 1-2 required qualifications or 3+ preferred
- 41-55: Below average - meets minimum but missing several preferred qualifications
- 56-70: Average match - meets most requirements, some gaps in preferred skills
- 71-80: Good match - meets all required, most preferred qualifications
- 81-90: Strong match - exceeds requirements in key areas
- 91-100: Exceptional - rare, exceeds all requirements significantly

### IMPORTANT GUIDELINES:

1. Start at 50 (neutral) and adjust based on gaps and strengths
2. NEVER score above 75 if ANY required qualification is missing
3. NEVER score above 60 if the candidate lacks the core technical skills for the role
4. Most candidates should realistically score between 35-65
5. A score of 70+ should be reserved for genuinely strong matches
6. Consider: would this resume make it past an ATS and initial recruiter screen?

## REQUIREMENTS TRACKING

Count the explicit requirements from the job posting (or typical requirements for this role type if no job description is provided):
- requirementsTotal: Total number of distinct required AND strongly preferred qualifications
- requirementsMet: How many the candidate clearly demonstrates
- requirementsGaps: List each unmet requirement with brief explanation

Only count clear, specific requirements (not vague "nice to haves"). Examples of countable requirements:
- "5+ years Python experience" → 1 requirement
- "Bachelor's degree in CS or related field" → 1 requirement
- "Experience with React, TypeScript, and Node.js" → 3 requirements (count each technology)
- "Strong communication skills" → 0 (too vague, don't count)

## RESPONSE FORMAT

Respond ONLY with valid JSON (no markdown, no code blocks):
{"probability": <number 0-100>, "reasoning": "<${reasoningInstruction}>", "requirementsMet": <number>, "requirementsTotal": <number>, "requirementsGaps": ["<unmet requirement 1 with brief explanation>", "<unmet requirement 2 with brief explanation>"]}`;

    try {
      const response = await this.client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Extract text from response
      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        this.logger.warn('No text response from Claude', {
          jobTitle: job.title,
          company: job.company,
        });
        return null;
      }

      const responseText = textBlock.text.trim();

      // Check for empty or minimal response
      if (!responseText || responseText.length < 10) {
        this.logger.warn('Empty response from Claude', {
          jobTitle: job.title,
          company: job.company,
        });
        return null;
      }

      const parsed = parseAIJsonResponse<MatchAnalysisResult>(responseText);

      if (!parsed || typeof parsed.probability !== 'number') {
        this.logger.warn('Invalid match analysis response from Claude', {
          jobTitle: job.title,
          responsePreview: responseText.slice(0, 200),
        });
        return null;
      }

      const probability = Math.max(0, Math.min(100, Math.round(parsed.probability)));

      // Extract requirements tracking fields
      const requirementsMet = typeof parsed.requirementsMet === 'number'
        ? Math.max(0, Math.round(parsed.requirementsMet))
        : undefined;
      const requirementsTotal = typeof parsed.requirementsTotal === 'number'
        ? Math.max(0, Math.round(parsed.requirementsTotal))
        : undefined;
      const requirementsGaps = Array.isArray(parsed.requirementsGaps)
        ? parsed.requirementsGaps.filter((g): g is string => typeof g === 'string')
        : undefined;

      this.logger.info('Claude match probability calculated', {
        probability,
        reasoning: parsed.reasoning,
        requirementsMet,
        requirementsTotal,
        requirementsGapsCount: requirementsGaps?.length,
      });

      return {
        probability,
        reasoning: parsed.reasoning ?? '',
        requirementsMet,
        requirementsTotal,
        requirementsGaps,
      };
    } catch (error) {
      this.logger.error('Failed to calculate match probability with Claude', {
        jobTitle: job.title,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

}
