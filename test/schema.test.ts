import {
  sanitizeCellValue,
  JobStatus,
  JOB_STATUS_VALUES,
  COLUMN_HEADERS,
  COLUMN_INDEX,
  LOW_MATCH_THRESHOLD,
} from '../src/sheets/schema';

describe('sanitizeCellValue', () => {
  it('should prefix formula injection characters with single quote', () => {
    expect(sanitizeCellValue('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(sanitizeCellValue('+1234567890')).toBe("'+1234567890");
    expect(sanitizeCellValue('-100')).toBe("'-100");
    expect(sanitizeCellValue('@user')).toBe("'@user");
  });

  it('should not modify safe values', () => {
    expect(sanitizeCellValue('Software Engineer')).toBe('Software Engineer');
    expect(sanitizeCellValue('Acme Corp')).toBe('Acme Corp');
    expect(sanitizeCellValue('San Francisco, CA')).toBe('San Francisco, CA');
    expect(sanitizeCellValue('123 Main St')).toBe('123 Main St');
  });

  it('should handle empty strings', () => {
    expect(sanitizeCellValue('')).toBe('');
  });

  it('should only check the first character', () => {
    expect(sanitizeCellValue('Hello = World')).toBe('Hello = World');
    expect(sanitizeCellValue('A+B')).toBe('A+B');
  });
});

describe('JobStatus enum', () => {
  it('should have all expected status values', () => {
    expect(JobStatus.NEW).toBe('NEW');
    expect(JobStatus.LOW_MATCH).toBe('LOW MATCH');
    expect(JobStatus.NOT_AVAILABLE).toBe('NOT AVAILABLE');
    expect(JobStatus.READ).toBe('READ');
    expect(JobStatus.INTERESTED).toBe('INTERESTED');
    expect(JobStatus.NOT_INTERESTED).toBe('NOT INTERESTED');
    expect(JobStatus.APPLIED).toBe('APPLIED');
    expect(JobStatus.INTERVIEW_SCHEDULED).toBe('INTERVIEW SCHEDULED');
    expect(JobStatus.DECLINED).toBe('DECLINED');
    expect(JobStatus.ACCEPTED).toBe('ACCEPTED');
  });

  it('should have JOB_STATUS_VALUES array with all values', () => {
    expect(JOB_STATUS_VALUES.length).toBe(10);
    expect(JOB_STATUS_VALUES).toContain('NEW');
    expect(JOB_STATUS_VALUES).toContain('LOW MATCH');
    expect(JOB_STATUS_VALUES).toContain('NOT AVAILABLE');
    expect(JOB_STATUS_VALUES).toContain('APPLIED');
    expect(JOB_STATUS_VALUES).toContain('ACCEPTED');
  });
});

describe('Column definitions', () => {
  it('should have correct column headers', () => {
    expect(COLUMN_HEADERS).toEqual([
      'job_id',
      'status',
      'date_added',
      'date_modified',
      'probability',
      'gemini_score',
      'gemini_argument',
      'claude_score',
      'claude_argument',
      'job_title',
      'company',
      'location',
      'url',
      'notes',
    ]);
  });

  it('should have correct column indices', () => {
    expect(COLUMN_INDEX.JOB_ID).toBe(0);
    expect(COLUMN_INDEX.STATUS).toBe(1);
    expect(COLUMN_INDEX.DATE_ADDED).toBe(2);
    expect(COLUMN_INDEX.DATE_MODIFIED).toBe(3);
    expect(COLUMN_INDEX.PROBABILITY).toBe(4);
    expect(COLUMN_INDEX.GEMINI_SCORE).toBe(5);
    expect(COLUMN_INDEX.GEMINI_ARGUMENT).toBe(6);
    expect(COLUMN_INDEX.CLAUDE_SCORE).toBe(7);
    expect(COLUMN_INDEX.CLAUDE_ARGUMENT).toBe(8);
    expect(COLUMN_INDEX.JOB_TITLE).toBe(9);
    expect(COLUMN_INDEX.COMPANY).toBe(10);
    expect(COLUMN_INDEX.LOCATION).toBe(11);
    expect(COLUMN_INDEX.URL).toBe(12);
    expect(COLUMN_INDEX.NOTES).toBe(13);
  });

  it('should have header count matching column count', () => {
    expect(COLUMN_HEADERS.length).toBe(COLUMN_INDEX.NOTES + 1);
  });
});

describe('LOW_MATCH_THRESHOLD', () => {
  it('should be 70', () => {
    expect(LOW_MATCH_THRESHOLD).toBe(70);
  });
});
