/**
 * @module gemini/client
 *
 * Gemini AI client for job-resume matching analysis.
 *
 * This module uses Google's Gemini 2.5 Flash model with Google Search grounding
 * to analyze job postings and calculate match probabilities against a candidate's
 * resume. The grounding feature allows Gemini to search and fetch actual job
 * descriptions from LinkedIn URLs, enabling accurate analysis.
 *
 * Key features:
 * - Google Search grounding to fetch live job descriptions from LinkedIn
 * - Conservative scoring with explicit penalty guidelines (0-100 scale)
 * - Retry logic: falls back to non-grounded analysis if search fails
 * - Structured JSON response parsing with markdown code block handling
 *
 * Scoring guidelines:
 * - 0-40: Poor match (missing required qualifications)
 * - 41-55: Below average (meets minimum but gaps in preferred)
 * - 56-70: Average match (most requirements met)
 * - 71-80: Good match (all required, most preferred)
 * - 81-100: Strong/exceptional match (exceeds requirements)
 *
 * @example
 * ```typescript
 * const geminiClient = new GeminiClient(projectId, logger);
 * await geminiClient.initialize();
 * const result = await geminiClient.calculateMatchProbability(job, resumeText);
 * console.log(result.probability, result.reasoning);
 * ```
 */

import { GoogleGenAI } from '@google/genai';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { Logger } from '../utils/logger';
import { Job } from '../types';

/**
 * Secret names in Google Secret Manager
 */
const SECRET_NAMES = {
  GEMINI_API_KEY: 'linkedin-job-alert-gemini-api-key',
} as const;

/**
 * Model to use for analysis
 */
const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Represents the match analysis result
 */
export interface MatchAnalysisResult {
  probability: number;
  reasoning: string;
  jobDescription?: string;
  /** Number of requirements the candidate meets */
  requirementsMet?: number;
  /** Total number of requirements from the job posting */
  requirementsTotal?: number;
  /** List of unmet requirements with brief explanations */
  requirementsGaps?: string[];
}

/**
 * Gemini client for job-resume match analysis with Google Search grounding
 */
export class GeminiClient {
  private client: GoogleGenAI | null = null;
  private readonly logger: Logger;
  private readonly secretManager: SecretManagerServiceClient;
  private readonly projectId: string;

  constructor(projectId: string, logger: Logger) {
    this.projectId = projectId;
    this.logger = logger;
    this.secretManager = new SecretManagerServiceClient();
  }

  /**
   * Initializes the Gemini client with API key from Secret Manager
   */
  async initialize(): Promise<void> {
    const apiKey = await this.getSecret(SECRET_NAMES.GEMINI_API_KEY);

    this.client = new GoogleGenAI({ apiKey });
    this.logger.info('Gemini client initialized', { model: GEMINI_MODEL });
  }

  /**
   * Fetches a secret from Google Secret Manager
   */
  private async getSecret(secretName: string): Promise<string> {
    const name = `projects/${this.projectId}/secrets/${secretName}/versions/latest`;

    const [version] = await this.secretManager.accessSecretVersion({ name });
    const payload = version.payload?.data;

    if (!payload) {
      throw new Error(`Secret ${secretName} has no payload`);
    }

    if (typeof payload === 'string') {
      return payload;
    }
    return Buffer.from(payload).toString('utf8');
  }

  /**
   * Calculates match probability between a job and resume
   * Uses Gemini with Google Search grounding to fetch job description from LinkedIn
   * @param job The job from the email (title, company, location, url)
   * @param resumeText The candidate's resume text
   * @returns Match probability (0-100) or null if analysis fails
   */
  async calculateMatchProbability(
    job: Job,
    resumeText: string
  ): Promise<MatchAnalysisResult | null> {
    if (!this.client) {
      throw new Error('Gemini client not initialized. Call initialize() first.');
    }

    this.logger.info('Calculating match probability', {
      jobTitle: job.title,
      company: job.company,
    });

    const prompt = `You are a strict, realistic technical recruiter evaluating job fit. Your assessments directly impact whether candidates waste time applying to unsuitable positions.

## STEP 1: FETCH JOB DESCRIPTION

Search for and retrieve the FULL job description from this LinkedIn job posting:
${job.url}

Job: "${job.title}" at "${job.company}" in "${job.location}"

Use Google Search to find the complete requirements, qualifications, and responsibilities. Pay special attention to:
- Required vs preferred qualifications
- Specific technologies, frameworks, or tools mentioned
- Years of experience requirements
- Education requirements
- Industry-specific experience requirements

## STEP 2: CANDIDATE'S RESUME

${resumeText}

## STEP 3: STRICT MATCH EVALUATION

Score the match probability from 0-100. BE CONSERVATIVE AND REALISTIC.

### AUTOMATIC SCORE PENALTIES (apply these strictly):

**Critical gaps (each reduces score by 15-25 points):**
- Missing a REQUIRED technical skill explicitly listed in job posting
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
- Related but not exact industry experience

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

## STEP 4: REQUIREMENTS TRACKING

Count the explicit requirements from the job posting:
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
{"probability": <number 0-100>, "reasoning": "<2-3 sentences citing SPECIFIC requirements from the job posting and how the candidate does or doesn't meet them>", "jobDescription": "<summarized job description including: role overview, required qualifications, preferred qualifications, key responsibilities, and any specific requirements like years of experience or technologies>", "requirementsMet": <number>, "requirementsTotal": <number>, "requirementsGaps": ["<unmet requirement 1 with brief explanation>", "<unmet requirement 2 with brief explanation>"]}`;

    // Try with Google Search grounding first, retry without if it fails
    for (let attempt = 1; attempt <= 2; attempt++) {
      const useGrounding = attempt === 1;

      try {
        const config = useGrounding
          ? { tools: [{ googleSearch: {} }] }
          : {}; // Fallback without grounding

        const response = await this.client.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config,
        });

        const responseText = response.text?.trim() ?? '';

        // Check for empty or minimal response
        if (!responseText || responseText.length < 10) {
          this.logger.warn('Empty response from Gemini', {
            attempt,
            useGrounding,
            jobTitle: job.title,
            company: job.company,
          });
          continue; // Retry without grounding
        }

        const parsed = this.parseJsonResponse<MatchAnalysisResult>(responseText);

        if (!parsed || typeof parsed.probability !== 'number') {
          this.logger.warn('Invalid match analysis response', {
            attempt,
            useGrounding,
            jobTitle: job.title,
            responsePreview: responseText.slice(0, 200),
          });
          continue; // Retry without grounding
        }

        const probability = Math.max(0, Math.min(100, Math.round(parsed.probability)));

        // Ensure jobDescription is a string (Gemini may return it as an object)
        let jobDescription: string | undefined;
        if (parsed.jobDescription) {
          jobDescription = typeof parsed.jobDescription === 'string'
            ? parsed.jobDescription
            : JSON.stringify(parsed.jobDescription);
        }

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

        this.logger.info('Match probability calculated', {
          probability,
          reasoning: parsed.reasoning,
          hasJobDescription: Boolean(jobDescription),
          jobDescriptionType: typeof parsed.jobDescription,
          useGrounding,
          requirementsMet,
          requirementsTotal,
          requirementsGapsCount: requirementsGaps?.length,
        });

        return {
          probability,
          reasoning: parsed.reasoning ?? '',
          jobDescription,
          requirementsMet,
          requirementsTotal,
          requirementsGaps,
        };
      } catch (error) {
        this.logger.error('Failed to calculate match probability', {
          attempt,
          useGrounding,
          jobTitle: job.title,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue to retry without grounding
      }
    }

    // Both attempts failed
    this.logger.error('All attempts failed for job analysis', {
      jobTitle: job.title,
      company: job.company,
      url: job.url,
    });
    return null;
  }

  /**
   * Parses JSON response from Gemini, handling markdown code blocks
   */
  private parseJsonResponse<T>(responseText: string): T | null {
    try {
      // Remove markdown code block if present
      let jsonStr = responseText;
      const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1];
      }

      return JSON.parse(jsonStr) as T;
    } catch {
      this.logger.warn('Failed to parse JSON response', {
        responsePreview: responseText.slice(0, 200),
      });
      return null;
    }
  }
}
