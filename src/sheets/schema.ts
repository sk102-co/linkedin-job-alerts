/**
 * Status values for job tracking
 */
export enum JobStatus {
  NEW = 'NEW',
  LOW_MATCH = 'LOW MATCH',
  NOT_AVAILABLE = 'NOT AVAILABLE',
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
  PROBABILITY: 4,
  GEMINI_SCORE: 5,
  GEMINI_ARGUMENT: 6,
  CLAUDE_SCORE: 7,
  CLAUDE_ARGUMENT: 8,
  JOB_TITLE: 9,
  COMPANY: 10,
  LOCATION: 11,
  URL: 12,
  NOTES: 13,
  REQUIREMENTS_MET: 14,
  REQUIREMENTS_GAPS: 15,
} as const;

/**
 * Column headers for the job sheet
 */
export const COLUMN_HEADERS = [
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
  'requirements_met',
  'requirements_gaps',
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
 * Styling configuration for each job status
 * - background: Light pastel background color (hex)
 * - text: Text color (hex)
 * - bold: Whether to use bold font weight
 *
 * Color philosophy:
 * - Positive/hopeful statuses: Blue and green pastel tones
 * - Negative/closed statuses: Grey tones
 * - Warning statuses: Amber tones
 */
export const STATUS_COLORS: Record<JobStatus, { background: string; text: string; bold: boolean }> = {
  // Positive statuses - very light blue/green pastel tones
  [JobStatus.NEW]: { background: '#F0F7FF', text: '#1565C0', bold: false },
  [JobStatus.INTERESTED]: { background: '#F1F8F2', text: '#2E7D32', bold: false },
  [JobStatus.APPLIED]: { background: '#E8F6F8', text: '#00796B', bold: true },
  [JobStatus.INTERVIEW_SCHEDULED]: { background: '#F0F1FA', text: '#3949AB', bold: true },
  [JobStatus.ACCEPTED]: { background: '#E8F5E9', text: '#1B5E20', bold: true },

  // Warning/neutral statuses - very light amber/grey tones
  [JobStatus.LOW_MATCH]: { background: '#FFFBF0', text: '#E65100', bold: false },
  [JobStatus.READ]: { background: '#FAFAFA', text: '#616161', bold: false },

  // Negative/closed statuses - muted grey tones (low contrast is acceptable)
  [JobStatus.NOT_AVAILABLE]: { background: '#F5F5F5', text: '#9E9E9E', bold: false },
  [JobStatus.NOT_INTERESTED]: { background: '#F5F5F5', text: '#BDBDBD', bold: false },
  [JobStatus.DECLINED]: { background: '#F5F5F5', text: '#9E9E9E', bold: false },
};

/**
 * Threshold for low match probability (jobs below this get LOW_MATCH status)
 */
export const LOW_MATCH_THRESHOLD = 70;

/**
 * Configuration for the ignored companies section in _Config sheet
 */
export const IGNORED_COMPANIES_CONFIG = {
  HEADER: 'Ignored Companies',
  COLUMN: 'C',
} as const;
