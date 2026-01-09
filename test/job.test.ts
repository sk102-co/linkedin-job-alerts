import { parseJob, safeParseJob, JobSchema } from '../src/types/job';
import { ZodError } from 'zod';

describe('Job validation', () => {
  const validJob = {
    jobId: '1234567890',
    title: 'Software Engineer',
    company: 'Acme Corp',
    officeLocation: 'San Francisco, CA',
    workType: '' as const,
    url: 'https://www.linkedin.com/jobs/view/1234567890',
  };

  describe('parseJob', () => {
    it('should accept valid job data', () => {
      const result = parseJob(validJob);

      expect(result).toEqual(validJob);
    });

    it('should throw ZodError for missing jobId', () => {
      const invalidJob = { ...validJob, jobId: '' };

      expect(() => parseJob(invalidJob)).toThrow(ZodError);
    });

    it('should throw ZodError for missing title', () => {
      const invalidJob = { ...validJob, title: '' };

      expect(() => parseJob(invalidJob)).toThrow(ZodError);
    });

    it('should throw ZodError for missing company', () => {
      const invalidJob = { ...validJob, company: '' };

      expect(() => parseJob(invalidJob)).toThrow(ZodError);
    });

    it('should accept empty officeLocation', () => {
      const job = { ...validJob, officeLocation: '' };

      expect(() => parseJob(job)).not.toThrow();
    });

    it('should throw ZodError for invalid workType', () => {
      const invalidJob = { ...validJob, workType: 'InvalidType' };

      expect(() => parseJob(invalidJob)).toThrow(ZodError);
    });

    it('should throw ZodError for invalid LinkedIn URL', () => {
      const invalidUrls = [
        'https://www.example.com/jobs/view/123',
        'https://linkedin.com/feed',
        'https://www.linkedin.com/jobs/',
        'not-a-url',
        '',
      ];

      for (const url of invalidUrls) {
        const invalidJob = { ...validJob, url };
        expect(() => parseJob(invalidJob)).toThrow(ZodError);
      }
    });

    it('should accept valid LinkedIn URLs', () => {
      const validUrls = [
        'https://www.linkedin.com/jobs/view/1234567890',
        'https://linkedin.com/jobs/view/9876543210',
      ];

      for (const url of validUrls) {
        const job = { ...validJob, url };
        expect(() => parseJob(job)).not.toThrow();
      }
    });
  });

  describe('safeParseJob', () => {
    it('should return job for valid data', () => {
      const result = safeParseJob(validJob);

      expect(result).toEqual(validJob);
    });

    it('should return null for invalid data', () => {
      const invalidJob = { ...validJob, jobId: '' };

      const result = safeParseJob(invalidJob);

      expect(result).toBeNull();
    });

    it('should return null for completely invalid input', () => {
      expect(safeParseJob(null)).toBeNull();
      expect(safeParseJob(undefined)).toBeNull();
      expect(safeParseJob('string')).toBeNull();
      expect(safeParseJob(123)).toBeNull();
      expect(safeParseJob({})).toBeNull();
    });
  });

  describe('JobSchema', () => {
    it('should be a valid Zod schema', () => {
      expect(JobSchema.parse).toBeDefined();
      expect(JobSchema.safeParse).toBeDefined();
    });
  });
});
