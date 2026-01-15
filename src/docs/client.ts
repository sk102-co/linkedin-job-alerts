import { google, docs_v1 } from 'googleapis';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { Logger } from '../utils/logger';

/**
 * Secret names in Google Secret Manager
 */
const SECRET_NAMES = {
  CLIENT_ID: 'linkedin-job-alert-client-id',
  CLIENT_SECRET: 'linkedin-job-alert-client-secret',
  REFRESH_TOKEN: 'linkedin-job-alert-refresh-token',
} as const;

/**
 * OAuth scopes required for Google Docs read access
 */
export const DOCS_SCOPES = ['https://www.googleapis.com/auth/documents.readonly'];

/**
 * Google Docs client for fetching resume content
 */
export class DocsClient {
  private docs: docs_v1.Docs | null = null;
  private readonly logger: Logger;
  private readonly secretManager: SecretManagerServiceClient;
  private readonly projectId: string;

  constructor(projectId: string, logger: Logger) {
    this.projectId = projectId;
    this.logger = logger;
    this.secretManager = new SecretManagerServiceClient();
  }

  /**
   * Initializes the Google Docs API client with OAuth credentials
   */
  async initialize(): Promise<void> {
    const [clientId, clientSecret, refreshToken] = await Promise.all([
      this.getSecret(SECRET_NAMES.CLIENT_ID),
      this.getSecret(SECRET_NAMES.CLIENT_SECRET),
      this.getSecret(SECRET_NAMES.REFRESH_TOKEN),
    ]);

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    this.docs = google.docs({ version: 'v1', auth: oauth2Client });
    this.logger.info('Docs client initialized');
  }

  /**
   * Fetches a secret from Google Secret Manager
   */
  private async getSecret(secretName: string): Promise<string> {
    const name = `projects/${this.projectId}/secrets/${secretName}/versions/latest`;

    const [version] = await this.secretManager.accessSecretVersion({ name });
    const payload = version.payload?.data;

    if (!payload) {
      throw new Error(`Secret ${secretName} has no payload`);
    }

    if (typeof payload === 'string') {
      return payload;
    }
    return Buffer.from(payload).toString('utf8');
  }

  /**
   * Fetches the plain text content from a Google Docs document
   * @param documentId The Google Docs document ID
   * @returns The plain text content of the document
   */
  async getDocumentText(documentId: string): Promise<string> {
    if (!this.docs) {
      throw new Error('Docs client not initialized. Call initialize() first.');
    }

    this.logger.info('Fetching document', { documentId: this.maskDocumentId(documentId) });

    const response = await this.docs.documents.get({
      documentId,
    });

    const document = response.data;
    if (!document.body?.content) {
      throw new Error('Document has no content');
    }

    const text = this.extractTextFromContent(document.body.content);
    this.logger.info('Document fetched successfully', {
      documentId: this.maskDocumentId(documentId),
      characterCount: text.length,
    });

    return text;
  }

  /**
   * Extracts plain text from Google Docs content structure
   */
  private extractTextFromContent(content: docs_v1.Schema$StructuralElement[]): string {
    const textParts: string[] = [];

    for (const element of content) {
      if (element.paragraph) {
        const paragraphText = this.extractTextFromParagraph(element.paragraph);
        if (paragraphText) {
          textParts.push(paragraphText);
        }
      } else if (element.table) {
        const tableText = this.extractTextFromTable(element.table);
        if (tableText) {
          textParts.push(tableText);
        }
      } else if (element.sectionBreak) {
        textParts.push('\n');
      }
    }

    return textParts.join('').trim();
  }

  /**
   * Extracts text from a paragraph element
   */
  private extractTextFromParagraph(paragraph: docs_v1.Schema$Paragraph): string {
    if (!paragraph.elements) {
      return '';
    }

    const parts: string[] = [];
    for (const element of paragraph.elements) {
      if (element.textRun?.content) {
        parts.push(element.textRun.content);
      }
    }

    return parts.join('');
  }

  /**
   * Extracts text from a table element
   */
  private extractTextFromTable(table: docs_v1.Schema$Table): string {
    if (!table.tableRows) {
      return '';
    }

    const rows: string[] = [];
    for (const row of table.tableRows) {
      if (!row.tableCells) {
        continue;
      }

      const cells: string[] = [];
      for (const cell of row.tableCells) {
        if (cell.content) {
          const cellText = this.extractTextFromContent(cell.content);
          cells.push(cellText.trim());
        }
      }
      rows.push(cells.join(' | '));
    }

    return rows.join('\n');
  }

  /**
   * Masks document ID for logging (PII protection)
   */
  private maskDocumentId(documentId: string): string {
    if (documentId.length <= 8) {
      return '****';
    }
    return `${documentId.slice(0, 4)}...${documentId.slice(-4)}`;
  }
}
