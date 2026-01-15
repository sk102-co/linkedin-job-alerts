import { LinkedInEmailParser } from '../src/gmail/parser';
import { Logger } from '../src/utils/logger';

/**
 * Sample LinkedIn job alert email HTML
 * This represents the structure of actual LinkedIn job alert emails
 * with job cards using data-test-id="job-card"
 */
const SAMPLE_EMAIL_HTML = `
<!DOCTYPE html>
<html>
<head><title>Jobs for you</title></head>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/comm/jobs/view/1234567890?trackingId=abc123">
          <img alt="Acme Corp" src="logo.png">
        </a>
        <a class="font-bold" href="https://www.linkedin.com/comm/jobs/view/1234567890?trackingId=abc123">
          Software Engineer
        </a>
        <p>Acme Corp · San Francisco, CA (On-site)</p>
      </td>
    </tr>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/comm/jobs/view/9876543210?trackingId=def456">
          <img alt="TechStart Inc" src="logo.png">
        </a>
        <a class="font-bold" href="https://www.linkedin.com/comm/jobs/view/9876543210?trackingId=def456">
          Senior Developer
        </a>
        <p>TechStart Inc · United States (Remote)</p>
      </td>
    </tr>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/comm/jobs/view/5555555555?trackingId=ghi789">
          <img alt="BigData Co" src="logo.png">
        </a>
        <a class="font-bold" href="https://www.linkedin.com/comm/jobs/view/5555555555?trackingId=ghi789">
          Backend Engineer
        </a>
        <p>BigData Co · New York, NY (Hybrid)</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with duplicate job cards (same job ID)
 */
const EMAIL_WITH_DUPLICATES = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/comm/jobs/view/1111111111"><img alt="Company A"></a>
        <a class="font-bold" href="https://www.linkedin.com/comm/jobs/view/1111111111">Duplicate Job</a>
        <p>Company A · United States</p>
      </td>
    </tr>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/comm/jobs/view/1111111111"><img alt="Company A"></a>
        <a class="font-bold" href="https://www.linkedin.com/comm/jobs/view/1111111111">Duplicate Job</a>
        <p>Company A · United States</p>
      </td>
    </tr>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/comm/jobs/view/2222222222"><img alt="Company B"></a>
        <a class="font-bold" href="https://www.linkedin.com/comm/jobs/view/2222222222">Unique Job</a>
        <p>Company B · Remote</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with no job cards
 */
const EMPTY_EMAIL = `
<!DOCTYPE html>
<html>
<body>
  <p>No job listings in this email</p>
</body>
</html>
`;

describe('LinkedInEmailParser', () => {
  let parser: LinkedInEmailParser;
  let mockLogger: Logger;

  beforeEach(() => {
    // Create a mock logger that doesn't output during tests
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      errorWithStack: jest.fn(),
      getRunId: jest.fn().mockReturnValue('test-run-id'),
    } as unknown as Logger;

    parser = new LinkedInEmailParser(mockLogger);
  });

  describe('parseEmail', () => {
    it('should extract multiple jobs from a valid email', () => {
      const jobs = parser.parseEmail(SAMPLE_EMAIL_HTML);

      expect(jobs.length).toBe(3);

      // Verify first job
      expect(jobs[0].jobId).toBe('1234567890');
      expect(jobs[0].title).toBe('Software Engineer');
      expect(jobs[0].company).toBe('Acme Corp');
      expect(jobs[0].location).toBe('San Francisco, CA (On-site)');
      expect(jobs[0].url).toBe('https://www.linkedin.com/jobs/view/1234567890');

      // Verify second job
      expect(jobs[1].jobId).toBe('9876543210');
      expect(jobs[1].title).toBe('Senior Developer');
      expect(jobs[1].company).toBe('TechStart Inc');
      expect(jobs[1].location).toBe('United States (Remote)');
      expect(jobs[1].url).toBe('https://www.linkedin.com/jobs/view/9876543210');

      // Verify third job
      expect(jobs[2].jobId).toBe('5555555555');
      expect(jobs[2].title).toBe('Backend Engineer');
      expect(jobs[2].company).toBe('BigData Co');
      expect(jobs[2].location).toBe('New York, NY (Hybrid)');
      expect(jobs[2].url).toBe('https://www.linkedin.com/jobs/view/5555555555');
    });

    it('should deduplicate jobs with the same ID', () => {
      const jobs = parser.parseEmail(EMAIL_WITH_DUPLICATES);

      expect(jobs.length).toBe(2);

      const jobIds = jobs.map((j) => j.jobId);
      expect(jobIds).toContain('1111111111');
      expect(jobIds).toContain('2222222222');
    });

    it('should return empty array for emails with no job cards', () => {
      const jobs = parser.parseEmail(EMPTY_EMAIL);

      expect(jobs).toEqual([]);
    });

    it('should clean tracking parameters from URLs', () => {
      const jobs = parser.parseEmail(SAMPLE_EMAIL_HTML);

      // URLs should be cleaned of tracking parameters
      jobs.forEach((job) => {
        expect(job.url).not.toContain('trackingId');
        expect(job.url).toMatch(/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+$/);
      });
    });
  });

  describe('job data extraction', () => {
    it('should extract job title from font-bold link', () => {
      const jobs = parser.parseEmail(SAMPLE_EMAIL_HTML);

      expect(jobs[0].title).toBe('Software Engineer');
      expect(jobs[1].title).toBe('Senior Developer');
      expect(jobs[2].title).toBe('Backend Engineer');
    });

    it('should extract company name from img alt attribute', () => {
      const jobs = parser.parseEmail(SAMPLE_EMAIL_HTML);

      expect(jobs[0].company).toBe('Acme Corp');
      expect(jobs[1].company).toBe('TechStart Inc');
      expect(jobs[2].company).toBe('BigData Co');
    });

    it('should extract location from paragraph text', () => {
      const jobs = parser.parseEmail(SAMPLE_EMAIL_HTML);

      expect(jobs[0].location).toBe('San Francisco, CA (On-site)');
      expect(jobs[1].location).toBe('United States (Remote)');
      expect(jobs[2].location).toBe('New York, NY (Hybrid)');
    });
  });

  describe('logging', () => {
    it('should log parsing results', () => {
      parser.parseEmail(SAMPLE_EMAIL_HTML);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Parsed jobs from email',
        expect.objectContaining({
          totalFound: expect.any(Number),
          uniqueJobs: expect.any(Number),
        })
      );
    });
  });
});
