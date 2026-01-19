import { google, sheets_v4 } from 'googleapis';
import { Logger } from '../utils/logger';
import { getSecret, SECRET_NAMES } from '../utils/secrets';
import {
  SHEET_NAMES,
  COLUMN_HEADERS,
  TOTAL_COLUMNS,
  JOB_STATUS_VALUES,
  STATUS_COLORS,
  JobStatus,
  IGNORED_COMPANIES_CONFIG,
} from './schema';
import { normalizeCompanyNames } from '../utils/company-filter';

/**
 * OAuth scopes required for Sheets API
 */
export const SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/**
 * Google Sheets client for the job tracking spreadsheet
 */
export class SheetsClient {
  private sheets: sheets_v4.Sheets | null = null;
  private readonly logger: Logger;
  private readonly projectId: string;
  private readonly spreadsheetId: string;

  constructor(projectId: string, spreadsheetId: string, logger: Logger) {
    this.projectId = projectId;
    this.spreadsheetId = spreadsheetId;
    this.logger = logger;
  }

  /**
   * Initializes the Sheets API client with OAuth credentials
   */
  async initialize(): Promise<void> {
    const [clientId, clientSecret, refreshToken] = await Promise.all([
      getSecret(this.projectId, SECRET_NAMES.CLIENT_ID),
      getSecret(this.projectId, SECRET_NAMES.CLIENT_SECRET),
      getSecret(this.projectId, SECRET_NAMES.REFRESH_TOKEN),
    ]);

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    this.sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    this.logger.info('Sheets client initialized');
  }

  /**
   * Gets the underlying Sheets API instance
   */
  getApi(): sheets_v4.Sheets {
    if (!this.sheets) {
      throw new Error('Sheets client not initialized. Call initialize() first.');
    }
    return this.sheets;
  }

  /**
   * Gets the spreadsheet ID
   */
  getSpreadsheetId(): string {
    return this.spreadsheetId;
  }

  /**
   * Ensures the required sheets exist with proper formatting
   * Creates them if they don't exist (idempotent)
   */
  async ensureSheetSetup(): Promise<void> {
    if (!this.sheets) {
      throw new Error('Sheets client not initialized');
    }

    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });

    const existingSheets = spreadsheet.data.sheets ?? [];
    const sheetNames = new Set(existingSheets.map((s) => s.properties?.title));

    // Create Jobs sheet if it doesn't exist
    if (!sheetNames.has(SHEET_NAMES.JOBS)) {
      await this.createJobsSheet();
      this.logger.info('Created Jobs sheet');
    } else {
      // Ensure headers exist even if sheet already exists (idempotent)
      await this.ensureJobsSheetHeaders();
    }

    // Create Config sheet if it doesn't exist, or update it with new status values
    if (!sheetNames.has(SHEET_NAMES.CONFIG)) {
      await this.createConfigSheet();
      this.logger.info('Created _Config sheet');
    } else {
      // Update status values (in case new statuses were added like LOW_MATCH)
      await this.updateConfigSheetValues();
    }

    // Apply formatting to Jobs sheet (idempotent)
    await this.applyJobsSheetFormatting();
    this.logger.info('Sheet setup complete');
  }

  /**
   * Creates the Jobs sheet with headers
   */
  private async createJobsSheet(): Promise<void> {
    if (!this.sheets) return;

    // Add the sheet
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: SHEET_NAMES.JOBS,
              },
            },
          },
        ],
      },
    });

    // Add headers - use dynamic column letter based on actual column count
    const lastColumnLetter = this.getColumnLetter(TOTAL_COLUMNS - 1);
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_NAMES.JOBS}!A1:${lastColumnLetter}1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[...COLUMN_HEADERS]],
      },
    });
  }

  /**
   * Ensures headers exist in an existing Jobs sheet (idempotent)
   * Uses update which overwrites the header row if it exists
   */
  private async ensureJobsSheetHeaders(): Promise<void> {
    if (!this.sheets) return;

    const lastColumnLetter = this.getColumnLetter(TOTAL_COLUMNS - 1);
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_NAMES.JOBS}!A1:${lastColumnLetter}1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[...COLUMN_HEADERS]],
      },
    });
    this.logger.info('Ensured Jobs sheet headers exist');
  }

  /**
   * Converts a 0-based column index to a column letter (A, B, ..., Z, AA, AB, ...)
   */
  private getColumnLetter(index: number): string {
    let letter = '';
    let remaining = index;

    while (remaining >= 0) {
      letter = String.fromCharCode((remaining % 26) + 65) + letter;
      remaining = Math.floor(remaining / 26) - 1;
    }

    return letter;
  }

  /**
   * Creates the Config sheet with status values
   */
  private async createConfigSheet(): Promise<void> {
    if (!this.sheets) return;

    // Add the sheet
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: SHEET_NAMES.CONFIG,
              },
            },
          },
        ],
      },
    });

    // Add status values
    await this.updateConfigSheetValues();
  }

  /**
   * Updates the Config sheet with current status values (idempotent)
   * Also ensures the "Ignored Companies" header exists in column C
   */
  private async updateConfigSheetValues(): Promise<void> {
    if (!this.sheets) return;

    const statusValues = JOB_STATUS_VALUES.map((status) => [status]);

    // Update status values in column A
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_NAMES.CONFIG}!A1:A${JOB_STATUS_VALUES.length}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: statusValues,
      },
    });

    // Check if "Ignored Companies" header exists in column C
    const headerResponse = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_NAMES.CONFIG}!${IGNORED_COMPANIES_CONFIG.COLUMN}1`,
    });

    const currentHeader = headerResponse.data.values?.[0]?.[0];
    if (currentHeader !== IGNORED_COMPANIES_CONFIG.HEADER) {
      // Add the header
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEET_NAMES.CONFIG}!${IGNORED_COMPANIES_CONFIG.COLUMN}1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[IGNORED_COMPANIES_CONFIG.HEADER]],
        },
      });
      this.logger.info('Added Ignored Companies header to _Config sheet');
    }
  }

  /**
   * Retrieves the set of ignored company names from the _Config sheet
   * @returns Set of company names (normalized to lowercase)
   */
  async getIgnoredCompanies(): Promise<Set<string>> {
    if (!this.sheets) {
      throw new Error('Sheets client not initialized');
    }

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_NAMES.CONFIG}!${IGNORED_COMPANIES_CONFIG.COLUMN}:${IGNORED_COMPANIES_CONFIG.COLUMN}`,
    });

    const values = response.data.values ?? [];

    // Skip header row (first row) and extract company names
    const companyNames: string[] = [];
    for (let i = 1; i < values.length; i++) {
      const name = values[i]?.[0];
      if (typeof name === 'string' && name.trim().length > 0) {
        companyNames.push(name);
      }
    }

    const normalizedSet = normalizeCompanyNames(companyNames);
    this.logger.info('Loaded ignored companies', { count: normalizedSet.size });

    return normalizedSet;
  }

  /**
   * Applies formatting to the Jobs sheet
   */
  private async applyJobsSheetFormatting(): Promise<void> {
    if (!this.sheets) return;

    // Get the Jobs sheet with existing conditional format rules
    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      includeGridData: false,
    });

    const jobsSheet = spreadsheet.data.sheets?.find(
      (s) => s.properties?.title === SHEET_NAMES.JOBS
    );

    if (!jobsSheet?.properties?.sheetId) {
      this.logger.warn('Could not find Jobs sheet for formatting');
      return;
    }

    const sheetId = jobsSheet.properties.sheetId;
    const requests: sheets_v4.Schema$Request[] = [];

    // Clear existing conditional format rules first (to make this idempotent)
    const existingRules = jobsSheet.conditionalFormats ?? [];
    for (let i = existingRules.length - 1; i >= 0; i--) {
      requests.push({
        deleteConditionalFormatRule: {
          sheetId,
          index: i,
        },
      });
    }

    // Freeze the header row
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    });

    // Bold the header row
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: TOTAL_COLUMNS,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              bold: true,
            },
            backgroundColor: {
              red: 0.9,
              green: 0.9,
              blue: 0.9,
            },
          },
        },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    });

    // Add data validation for status column
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 1,
          endColumnIndex: 2,
        },
        rule: {
          condition: {
            type: 'ONE_OF_RANGE',
            values: [
              {
                userEnteredValue: `='${SHEET_NAMES.CONFIG}'!$A$1:$A$${JOB_STATUS_VALUES.length}`,
              },
            ],
          },
          showCustomUi: true,
          strict: true,
        },
      },
    });

    // Add conditional formatting for each status
    for (const status of Object.values(JobStatus)) {
      const colors = STATUS_COLORS[status];
      requests.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [
              {
                sheetId,
                startRowIndex: 1,
                startColumnIndex: 1,
                endColumnIndex: 2,
              },
            ],
            booleanRule: {
              condition: {
                type: 'TEXT_EQ',
                values: [{ userEnteredValue: status }],
              },
              format: {
                backgroundColor: this.hexToRgb(colors.background),
                textFormat: {
                  foregroundColor: this.hexToRgb(colors.text),
                },
              },
            },
          },
          index: 0,
        },
      });
    }

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests },
    });
  }

  /**
   * Converts hex color to RGB object for Sheets API
   */
  private hexToRgb(hex: string): sheets_v4.Schema$Color {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
      return { red: 0, green: 0, blue: 0 };
    }

    return {
      red: parseInt(result[1], 16) / 255,
      green: parseInt(result[2], 16) / 255,
      blue: parseInt(result[3], 16) / 255,
    };
  }
}
