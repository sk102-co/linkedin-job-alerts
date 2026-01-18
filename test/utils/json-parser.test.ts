import { parseAIJsonResponse } from '../../src/utils/json-parser';

interface TestResponse {
  probability: number;
  reasoning: string;
}

describe('parseAIJsonResponse', () => {
  it('should parse plain JSON response', () => {
    const response = '{"probability": 75, "reasoning": "Good match"}';

    const result = parseAIJsonResponse<TestResponse>(response);

    expect(result).toEqual({
      probability: 75,
      reasoning: 'Good match',
    });
  });

  it('should parse JSON wrapped in markdown code block with json tag', () => {
    const response = '```json\n{"probability": 80, "reasoning": "Strong match"}\n```';

    const result = parseAIJsonResponse<TestResponse>(response);

    expect(result).toEqual({
      probability: 80,
      reasoning: 'Strong match',
    });
  });

  it('should parse JSON wrapped in markdown code block without json tag', () => {
    const response = '```\n{"probability": 60, "reasoning": "Average match"}\n```';

    const result = parseAIJsonResponse<TestResponse>(response);

    expect(result).toEqual({
      probability: 60,
      reasoning: 'Average match',
    });
  });

  it('should handle extra whitespace in code blocks', () => {
    const response = '```json\n\n  {"probability": 50, "reasoning": "Below average"}  \n\n```';

    const result = parseAIJsonResponse<TestResponse>(response);

    expect(result).toEqual({
      probability: 50,
      reasoning: 'Below average',
    });
  });

  it('should return null for invalid JSON', () => {
    const response = 'This is not JSON at all';

    const result = parseAIJsonResponse<TestResponse>(response);

    expect(result).toBeNull();
  });

  it('should return null for malformed JSON', () => {
    const response = '{"probability": 75, "reasoning": }';

    const result = parseAIJsonResponse<TestResponse>(response);

    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = parseAIJsonResponse<TestResponse>('');

    expect(result).toBeNull();
  });

  it('should parse nested objects', () => {
    interface NestedResponse {
      data: {
        score: number;
        details: string[];
      };
    }

    const response = '{"data": {"score": 90, "details": ["skill1", "skill2"]}}';

    const result = parseAIJsonResponse<NestedResponse>(response);

    expect(result).toEqual({
      data: {
        score: 90,
        details: ['skill1', 'skill2'],
      },
    });
  });

  it('should parse arrays', () => {
    const response = '[1, 2, 3, 4, 5]';

    const result = parseAIJsonResponse<number[]>(response);

    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle code block with surrounding text (extracts only code block)', () => {
    const response = 'Here is the analysis:\n```json\n{"probability": 70, "reasoning": "Match"}\n```\nEnd of response.';

    const result = parseAIJsonResponse<TestResponse>(response);

    expect(result).toEqual({
      probability: 70,
      reasoning: 'Match',
    });
  });

  it('should parse response with special characters in strings', () => {
    const response = '{"probability": 65, "reasoning": "Missing \\"required\\" skills: C++, Node.js"}';

    const result = parseAIJsonResponse<TestResponse>(response);

    expect(result).toEqual({
      probability: 65,
      reasoning: 'Missing "required" skills: C++, Node.js',
    });
  });
});
