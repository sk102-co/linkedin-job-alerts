/**
 * Status values for job tracking
 */
export enum JobStatus {
  NEW = 'NEW',
  READ = 'READ',
  INTERESTED = 'INTERESTED',
  NOT_INTERESTED = 'NOT INTERESTED',
  APPLIED = 'APPLIED',
  INTERVIEW_SCHEDULED = 'INTERVIEW SCHEDULED',
  DECLINED = 'DECLINED',
  ACCEPTED = 'ACCEPTED',
}

/**
 * All valid status values as an array
 */
export const JOB_STATUS_VALUES = Object.values(JobStatus);

/**
 * Column indices (0-based) for the job sheet
 */
export const COLUMN_INDEX = {
  JOB_ID: 0,
  STATUS: 1,
  DATE_ADDED: 2,
  DATE_MODIFIED: 3,
  JOB_TITLE: 4,
  COMPANY: 5,
  OFFICE_LOCATION: 6,
  WORK_TYPE: 7,
  URL: 8,
  NOTES: 9,
} as const;

/**
 * Column headers for the job sheet
 */
export const COLUMN_HEADERS = [
  'job_id',
  'status',
  'date_added',
  'date_modified',
  'job_title',
  'company',
  'office_location',
  'work_type',
  'url',
  'notes',
] as const;

/**
 * Total number of columns in the sheet
 */
export const TOTAL_COLUMNS = COLUMN_HEADERS.length;

/**
 * Sheet names
 */
export const SHEET_NAMES = {
  JOBS: 'Jobs',
  CONFIG: '_Config',
} as const;

/**
 * Characters that could trigger formula injection
 */
const FORMULA_INJECTION_CHARS = ['=', '+', '-', '@'];

/**
 * Sanitizes a cell value to prevent formula injection
 * Prefixes dangerous characters with a single quote
 */
export function sanitizeCellValue(value: string): string {
  if (value.length === 0) {
    return value;
  }

  const firstChar = value.charAt(0);
  if (FORMULA_INJECTION_CHARS.includes(firstChar)) {
    return `'${value}`;
  }

  return value;
}

/**
 * Conditional formatting colors for each status
 */
export const STATUS_COLORS: Record<JobStatus, { background: string; text: string }> = {
  [JobStatus.NEW]: { background: '#E3F2FD', text: '#1565C0' },
  [JobStatus.READ]: { background: '#F5F5F5', text: '#616161' },
  [JobStatus.INTERESTED]: { background: '#E8F5E9', text: '#2E7D32' },
  [JobStatus.NOT_INTERESTED]: { background: '#FFEBEE', text: '#C62828' },
  [JobStatus.APPLIED]: { background: '#FFF3E0', text: '#E65100' },
  [JobStatus.INTERVIEW_SCHEDULED]: { background: '#F3E5F5', text: '#7B1FA2' },
  [JobStatus.DECLINED]: { background: '#ECEFF1', text: '#455A64' },
  [JobStatus.ACCEPTED]: { background: '#C8E6C9', text: '#1B5E20' },
};
