import {
  isCompanyIgnored,
  filterJobsByCompany,
  normalizeCompanyNames,
} from '../../src/utils/company-filter';
import { Job } from '../../src/types/job';
import { Logger } from '../../src/utils/logger';

// Mock the Logger to avoid console output during tests
jest.mock('../../src/utils/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('isCompanyIgnored', () => {
  it('should return true for exact case-insensitive match', () => {
    const ignoredCompanies = new Set(['google', 'meta', 'amazon']);

    expect(isCompanyIgnored('Google', ignoredCompanies)).toBe(true);
    expect(isCompanyIgnored('GOOGLE', ignoredCompanies)).toBe(true);
    expect(isCompanyIgnored('google', ignoredCompanies)).toBe(true);
    expect(isCompanyIgnored('Meta', ignoredCompanies)).toBe(true);
    expect(isCompanyIgnored('Amazon', ignoredCompanies)).toBe(true);
  });

  it('should return false for partial matches', () => {
    const ignoredCompanies = new Set(['google']);

    expect(isCompanyIgnored('Google LLC', ignoredCompanies)).toBe(false);
    expect(isCompanyIgnored('Google Inc', ignoredCompanies)).toBe(false);
    expect(isCompanyIgnored('Alphabet/Google', ignoredCompanies)).toBe(false);
  });

  it('should return false for companies not in the ignore list', () => {
    const ignoredCompanies = new Set(['google', 'meta']);

    expect(isCompanyIgnored('Microsoft', ignoredCompanies)).toBe(false);
    expect(isCompanyIgnored('Apple', ignoredCompanies)).toBe(false);
    expect(isCompanyIgnored('Netflix', ignoredCompanies)).toBe(false);
  });

  it('should handle whitespace in company names', () => {
    const ignoredCompanies = new Set(['google']);

    expect(isCompanyIgnored('  Google  ', ignoredCompanies)).toBe(true);
    expect(isCompanyIgnored('\tGoogle\t', ignoredCompanies)).toBe(true);
    expect(isCompanyIgnored('Google ', ignoredCompanies)).toBe(true);
  });

  it('should return false when ignore list is empty', () => {
    const ignoredCompanies = new Set<string>();

    expect(isCompanyIgnored('Google', ignoredCompanies)).toBe(false);
    expect(isCompanyIgnored('Any Company', ignoredCompanies)).toBe(false);
  });

  it('should handle empty company name', () => {
    const ignoredCompanies = new Set(['google']);

    expect(isCompanyIgnored('', ignoredCompanies)).toBe(false);
    expect(isCompanyIgnored('   ', ignoredCompanies)).toBe(false);
  });
});

describe('normalizeCompanyNames', () => {
  it('should convert names to lowercase', () => {
    const names = ['Google', 'AMAZON', 'Meta'];
    const result = normalizeCompanyNames(names);

    expect(result.has('google')).toBe(true);
    expect(result.has('amazon')).toBe(true);
    expect(result.has('meta')).toBe(true);
  });

  it('should trim whitespace', () => {
    const names = ['  Google  ', '\tAmazon\t', 'Meta '];
    const result = normalizeCompanyNames(names);

    expect(result.has('google')).toBe(true);
    expect(result.has('amazon')).toBe(true);
    expect(result.has('meta')).toBe(true);
  });

  it('should skip empty strings', () => {
    const names = ['Google', '', '   ', 'Amazon'];
    const result = normalizeCompanyNames(names);

    expect(result.size).toBe(2);
    expect(result.has('google')).toBe(true);
    expect(result.has('amazon')).toBe(true);
  });

  it('should return empty set for empty input', () => {
    const result = normalizeCompanyNames([]);

    expect(result.size).toBe(0);
  });

  it('should deduplicate names', () => {
    const names = ['Google', 'google', 'GOOGLE'];
    const result = normalizeCompanyNames(names);

    expect(result.size).toBe(1);
    expect(result.has('google')).toBe(true);
  });
});

describe('filterJobsByCompany', () => {
  const createJob = (jobId: string, company: string): Job => ({
    jobId,
    title: 'Software Engineer',
    company,
    location: 'San Francisco, CA',
    url: `https://www.linkedin.com/jobs/view/${jobId}`,
  });

  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = new Logger();
  });

  it('should filter out jobs from ignored companies', () => {
    const jobs = [
      createJob('1', 'Google'),
      createJob('2', 'Microsoft'),
      createJob('3', 'Amazon'),
      createJob('4', 'Apple'),
    ];
    const ignoredCompanies = new Set(['google', 'amazon']);

    const result = filterJobsByCompany(jobs, ignoredCompanies, mockLogger);

    expect(result.filtered).toHaveLength(2);
    expect(result.ignoredCount).toBe(2);
    expect(result.filtered.map((j) => j.company)).toEqual(['Microsoft', 'Apple']);
  });

  it('should return all jobs when ignore list is empty', () => {
    const jobs = [
      createJob('1', 'Google'),
      createJob('2', 'Microsoft'),
    ];
    const ignoredCompanies = new Set<string>();

    const result = filterJobsByCompany(jobs, ignoredCompanies, mockLogger);

    expect(result.filtered).toHaveLength(2);
    expect(result.ignoredCount).toBe(0);
    expect(result.filtered).toEqual(jobs);
  });

  it('should return empty array when all jobs are ignored', () => {
    const jobs = [
      createJob('1', 'Google'),
      createJob('2', 'Google'),
    ];
    const ignoredCompanies = new Set(['google']);

    const result = filterJobsByCompany(jobs, ignoredCompanies, mockLogger);

    expect(result.filtered).toHaveLength(0);
    expect(result.ignoredCount).toBe(2);
  });

  it('should handle empty jobs array', () => {
    const ignoredCompanies = new Set(['google']);

    const result = filterJobsByCompany([], ignoredCompanies, mockLogger);

    expect(result.filtered).toHaveLength(0);
    expect(result.ignoredCount).toBe(0);
  });

  it('should match company names case-insensitively', () => {
    const jobs = [
      createJob('1', 'GOOGLE'),
      createJob('2', 'Google'),
      createJob('3', 'google'),
      createJob('4', 'Microsoft'),
    ];
    const ignoredCompanies = new Set(['google']);

    const result = filterJobsByCompany(jobs, ignoredCompanies, mockLogger);

    expect(result.filtered).toHaveLength(1);
    expect(result.ignoredCount).toBe(3);
    expect(result.filtered[0].company).toBe('Microsoft');
  });

  it('should log ignored jobs', () => {
    const jobs = [
      createJob('123', 'Google'),
    ];
    const ignoredCompanies = new Set(['google']);

    filterJobsByCompany(jobs, ignoredCompanies, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Job ignored - company in ignore list',
      expect.objectContaining({
        jobId: '123',
        company: 'Google',
      })
    );
  });

  it('should preserve job order for non-ignored jobs', () => {
    const jobs = [
      createJob('1', 'Apple'),
      createJob('2', 'Google'),
      createJob('3', 'Microsoft'),
      createJob('4', 'Amazon'),
      createJob('5', 'Netflix'),
    ];
    const ignoredCompanies = new Set(['google', 'amazon']);

    const result = filterJobsByCompany(jobs, ignoredCompanies, mockLogger);

    expect(result.filtered.map((j) => j.jobId)).toEqual(['1', '3', '5']);
  });
});
