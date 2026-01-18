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

/**
 * Email with job card missing href (no link)
 */
const EMAIL_NO_HREF = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a><img alt="Company"></a>
        <a class="font-bold">Job Title Without Link</a>
        <p>Company · Location</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with invalid LinkedIn URL
 */
const EMAIL_INVALID_URL = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://example.com/not-linkedin"><img alt="Company"></a>
        <a class="font-bold" href="https://example.com/not-linkedin">Some Job</a>
        <p>Company · Location</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with title in regular link (not font-bold) - Strategy 2
 */
const EMAIL_TITLE_IN_REGULAR_LINK = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/jobs/view/1234567890">
          Data Scientist Position
        </a>
        <img alt="Analytics Co">
        <p>Analytics Co · Boston, MA</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with title in heading element - Strategy 3
 */
const EMAIL_TITLE_IN_HEADING = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/jobs/view/9999999999">
          <img alt="Startup Inc">
        </a>
        <h3>Product Manager</h3>
        <p>Startup Inc · Austin, TX</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with Premium badge (should be filtered out as company name)
 */
const EMAIL_WITH_PREMIUM_BADGE = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/jobs/view/7777777777">
          <img alt="Premium">
        </a>
        <a class="font-bold" href="https://www.linkedin.com/jobs/view/7777777777">
          Premium Job Title
        </a>
        <p>Real Company · Seattle, WA</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with company name only in paragraph (not in img alt)
 */
const EMAIL_COMPANY_IN_PARAGRAPH = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/jobs/view/8888888888">
          <img alt="">
        </a>
        <a class="font-bold" href="https://www.linkedin.com/jobs/view/8888888888">
          DevOps Engineer
        </a>
        <p>CloudTech Solutions · Denver, CO (Remote)</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with location using fallback patterns (no paragraph with ·)
 */
const EMAIL_LOCATION_FALLBACK_US = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/jobs/view/6666666666"><img alt="US Company"></a>
        <a class="font-bold" href="https://www.linkedin.com/jobs/view/6666666666">National Role</a>
        <p>US Company</p>
        <span>United States</span>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with Remote location fallback
 */
const EMAIL_LOCATION_FALLBACK_REMOTE = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/jobs/view/4444444444"><img alt="Remote Corp"></a>
        <a class="font-bold" href="https://www.linkedin.com/jobs/view/4444444444">Remote Engineer</a>
        <p>Remote Corp</p>
        <div>Work from anywhere - Remote</div>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with City, State location fallback
 */
const EMAIL_LOCATION_FALLBACK_CITY_STATE = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/jobs/view/3333333333"><img alt="Local Biz"></a>
        <a class="font-bold" href="https://www.linkedin.com/jobs/view/3333333333">Job</a>
        <span>Located in Chicago, IL area</span>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with malformed URL that can't be parsed
 */
const EMAIL_MALFORMED_URL = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="not-a-valid-url-at-all"><img alt="Company"></a>
        <a class="font-bold" href="not-a-valid-url-at-all">Some Job</a>
        <p>Company · Location</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with LinkedIn URL but no job ID in path
 */
const EMAIL_LINKEDIN_NO_JOB_ID = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/company/acme"><img alt="Acme"></a>
        <a class="font-bold" href="https://www.linkedin.com/company/acme">View Company</a>
        <p>Acme · Somewhere</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with valid URL structure but would fail Zod validation (invalid job data)
 * This is hard to trigger since most invalid data is filtered earlier
 */
const EMAIL_EMPTY_JOB_ID = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/jobs/view/"><img alt="Test"></a>
        <a class="font-bold" href="https://www.linkedin.com/jobs/view/">Empty ID Job</a>
        <p>Test Corp · Nowhere</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email where title link has only short text (should use fallback)
 */
const EMAIL_SHORT_LINK_TEXT = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/jobs/view/2222222222">
          AB
        </a>
        <h4>Actual Job Title Here</h4>
        <img alt="Some Corp">
        <p>Some Corp · Miami, FL</p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Email with link containing only an image (should use fallback)
 */
const EMAIL_LINK_WITH_IMAGE_ONLY = `
<!DOCTYPE html>
<html>
<body>
  <table>
    <tr>
      <td data-test-id="job-card">
        <a href="https://www.linkedin.com/jobs/view/1212121212">
          <img src="arrow.png">
        </a>
        <a href="https://www.linkedin.com/jobs/view/1212121212">
          Click here for more
        </a>
        <img alt="Image Corp">
        <p>Image Corp · Portland, OR</p>
      </td>
    </tr>
  </table>
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

    it('should skip job cards without href attribute', () => {
      const jobs = parser.parseEmail(EMAIL_NO_HREF);

      expect(jobs).toEqual([]);
    });

    it('should skip job cards with invalid LinkedIn URLs', () => {
      const jobs = parser.parseEmail(EMAIL_INVALID_URL);

      expect(jobs).toEqual([]);
    });

    it('should skip job cards with malformed URLs', () => {
      const jobs = parser.parseEmail(EMAIL_MALFORMED_URL);

      expect(jobs).toEqual([]);
    });

    it('should skip LinkedIn URLs without job ID in path', () => {
      const jobs = parser.parseEmail(EMAIL_LINKEDIN_NO_JOB_ID);

      expect(jobs).toEqual([]);
    });

    it('should skip URLs with empty job ID', () => {
      const jobs = parser.parseEmail(EMAIL_EMPTY_JOB_ID);

      expect(jobs).toEqual([]);
    });
  });

  describe('job data extraction', () => {
    it('should extract job title from font-bold link', () => {
      const jobs = parser.parseEmail(SAMPLE_EMAIL_HTML);

      expect(jobs[0].title).toBe('Software Engineer');
      expect(jobs[1].title).toBe('Senior Developer');
      expect(jobs[2].title).toBe('Backend Engineer');
    });

    it('should extract job title from regular link (Strategy 2)', () => {
      const jobs = parser.parseEmail(EMAIL_TITLE_IN_REGULAR_LINK);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].title).toBe('Data Scientist Position');
      expect(jobs[0].jobId).toBe('1234567890');
    });

    it('should extract job title from heading element (Strategy 3)', () => {
      const jobs = parser.parseEmail(EMAIL_TITLE_IN_HEADING);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].title).toBe('Product Manager');
      expect(jobs[0].company).toBe('Startup Inc');
    });

    it('should skip short link text and use heading fallback', () => {
      const jobs = parser.parseEmail(EMAIL_SHORT_LINK_TEXT);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].title).toBe('Actual Job Title Here');
    });

    it('should skip link with only image and use next link text', () => {
      const jobs = parser.parseEmail(EMAIL_LINK_WITH_IMAGE_ONLY);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].title).toBe('Click here for more');
      expect(jobs[0].company).toBe('Image Corp');
    });

    it('should extract company name from img alt attribute', () => {
      const jobs = parser.parseEmail(SAMPLE_EMAIL_HTML);

      expect(jobs[0].company).toBe('Acme Corp');
      expect(jobs[1].company).toBe('TechStart Inc');
      expect(jobs[2].company).toBe('BigData Co');
    });

    it('should filter out Premium badge as company name', () => {
      const jobs = parser.parseEmail(EMAIL_WITH_PREMIUM_BADGE);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].company).toBe('Real Company');
      expect(jobs[0].title).toBe('Premium Job Title');
    });

    it('should extract company name from paragraph when img alt is empty', () => {
      const jobs = parser.parseEmail(EMAIL_COMPANY_IN_PARAGRAPH);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].company).toBe('CloudTech Solutions');
      expect(jobs[0].location).toBe('Denver, CO (Remote)');
    });

    it('should extract location from paragraph text', () => {
      const jobs = parser.parseEmail(SAMPLE_EMAIL_HTML);

      expect(jobs[0].location).toBe('San Francisco, CA (On-site)');
      expect(jobs[1].location).toBe('United States (Remote)');
      expect(jobs[2].location).toBe('New York, NY (Hybrid)');
    });

    it('should use United States location fallback pattern', () => {
      const jobs = parser.parseEmail(EMAIL_LOCATION_FALLBACK_US);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].location).toBe('United States');
    });

    it('should use Remote location fallback pattern', () => {
      const jobs = parser.parseEmail(EMAIL_LOCATION_FALLBACK_REMOTE);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].location).toBe('Remote');
    });

    it('should use City, State location fallback pattern', () => {
      const jobs = parser.parseEmail(EMAIL_LOCATION_FALLBACK_CITY_STATE);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].location).toBe('Chicago, IL');
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
