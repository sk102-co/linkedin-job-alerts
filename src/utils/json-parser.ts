/**
 * @module utils/json-parser
 *
 * Shared utility for parsing JSON responses from AI models.
 *
 * Handles common cases where AI models wrap JSON in markdown code blocks
 * or return slightly malformed responses.
 */

/**
 * Regex pattern to extract JSON from markdown code blocks.
 * Matches ```json ... ``` or ``` ... ``` formats.
 */
const CODE_BLOCK_PATTERN = /```(?:json)?\s*([\s\S]*?)\s*```/;

/**
 * Parses a JSON response from an AI model, handling markdown code blocks.
 *
 * AI models sometimes wrap JSON responses in markdown code blocks like:
 * ```json
 * {"key": "value"}
 * ```
 *
 * This function extracts the JSON content and parses it.
 *
 * @param responseText - The raw response text from the AI model
 * @returns The parsed JSON object, or null if parsing fails
 *
 * @example
 * ```typescript
 * const result = parseAIJsonResponse<{probability: number}>('```json\n{"probability": 75}\n```');
 * // Result: { probability: 75 }
 * ```
 */
export function parseAIJsonResponse<T>(responseText: string): T | null {
  try {
    let jsonStr = responseText;

    // Extract JSON from markdown code block if present
    const codeBlockMatch = responseText.match(CODE_BLOCK_PATTERN);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }

    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}
