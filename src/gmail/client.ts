import { google, gmail_v1 } from 'googleapis';
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
 * Gmail query to find LinkedIn job alert emails from all sender addresses
 */
const LINKEDIN_JOB_ALERT_QUERY =
  '(from:jobalerts-noreply@linkedin.com OR from:jobs-noreply@linkedin.com OR from:jobs-listings@linkedin.com)';

/**
 * Allowed sender emails for validation (defense in depth)
 */
const LINKEDIN_SENDER_EMAILS = new Set([
  'jobalerts-noreply@linkedin.com',
  'jobs-noreply@linkedin.com',
  'jobs-listings@linkedin.com',
]);

/**
 * Label to apply to processed emails (nested label format)
 */
const PROCESSED_LABEL_NAME = 'Jobs/LinkedIn';

/**
 * OAuth scopes required for the application
 * Using gmail.modify to allow marking as read, adding labels, and archiving
 */
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

/**
 * Represents a fetched Gmail message with its HTML body
 */
export interface GmailMessage {
  id: string;
  htmlBody: string;
}

/**
 * Gmail client for fetching LinkedIn job alert emails
 */
export class GmailClient {
  private gmail: gmail_v1.Gmail | null = null;
  private readonly logger: Logger;
  private readonly secretManager: SecretManagerServiceClient;
  private readonly projectId: string;
  private processedLabelId: string | null = null;

  constructor(projectId: string, logger: Logger) {
    this.projectId = projectId;
    this.logger = logger;
    this.secretManager = new SecretManagerServiceClient();
  }

  /**
   * Initializes the Gmail API client with OAuth credentials
   */
  async initialize(): Promise<void> {
    const [clientId, clientSecret, refreshToken] = await Promise.all([
      this.getSecret(SECRET_NAMES.CLIENT_ID),
      this.getSecret(SECRET_NAMES.CLIENT_SECRET),
      this.getSecret(SECRET_NAMES.REFRESH_TOKEN),
    ]);

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    this.logger.info('Gmail client initialized');
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
   * Fetches unread LinkedIn job alert emails
   * @param afterTimestamp Optional Unix timestamp to fetch emails after
   */
  async fetchJobAlertEmails(afterTimestamp?: number): Promise<GmailMessage[]> {
    if (!this.gmail) {
      throw new Error('Gmail client not initialized. Call initialize() first.');
    }

    let query = `${LINKEDIN_JOB_ALERT_QUERY} is:unread`;
    if (afterTimestamp !== undefined) {
      query += ` after:${afterTimestamp}`;
    }

    this.logger.info('Fetching job alert emails', { query });

    const messages: GmailMessage[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        pageToken,
      });

      const messageList = response.data.messages ?? [];
      this.logger.info('Fetched message list page', { count: messageList.length });

      for (const message of messageList) {
        if (message.id) {
          const fullMessage = await this.fetchMessageBody(message.id);
          if (fullMessage) {
            messages.push(fullMessage);
          }
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    this.logger.info('Finished fetching emails', { totalCount: messages.length });
    return messages;
  }

  /**
   * Fetches the full message body for a given message ID
   */
  private async fetchMessageBody(messageId: string): Promise<GmailMessage | null> {
    if (!this.gmail) {
      throw new Error('Gmail client not initialized');
    }

    const response = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    // Validate sender (defense in depth)
    if (!this.isFromLinkedIn(response.data.payload)) {
      this.logger.warn('Message not from LinkedIn job alerts, skipping', { messageId });
      return null;
    }

    const htmlBody = this.extractHtmlBody(response.data.payload);
    if (!htmlBody) {
      this.logger.warn('No HTML body found for message', { messageId });
      return null;
    }

    return { id: messageId, htmlBody };
  }

  /**
   * Validates that the message is from LinkedIn job alerts
   */
  private isFromLinkedIn(payload: gmail_v1.Schema$MessagePart | undefined): boolean {
    if (!payload?.headers) {
      return false;
    }

    const fromHeader = payload.headers.find(
      (h) => h.name?.toLowerCase() === 'from'
    );

    if (!fromHeader?.value) {
      return false;
    }

    // Extract email from "Name <email@domain.com>" format
    const emailMatch = fromHeader.value.match(/<([^>]+)>/) ?? [null, fromHeader.value];
    const senderEmail = (emailMatch[1] ?? fromHeader.value).toLowerCase().trim();

    return LINKEDIN_SENDER_EMAILS.has(senderEmail);
  }

  /**
   * Extracts HTML body from a Gmail message payload
   */
  private extractHtmlBody(payload: gmail_v1.Schema$MessagePart | undefined): string | null {
    if (!payload) {
      return null;
    }

    // Check if this part is HTML
    if (payload.mimeType === 'text/html' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf8');
    }

    // Recursively search parts
    if (payload.parts) {
      for (const part of payload.parts) {
        const html = this.extractHtmlBody(part);
        if (html) {
          return html;
        }
      }
    }

    return null;
  }

  /**
   * Marks messages as processed: adds label, marks as read, and archives
   */
  async markAsProcessed(messageIds: string[]): Promise<void> {
    if (!this.gmail || messageIds.length === 0) {
      return;
    }

    // Ensure the label exists
    const labelId = await this.getOrCreateLabel();

    await this.gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: messageIds,
        addLabelIds: [labelId],
        removeLabelIds: ['UNREAD', 'INBOX'], // Mark read and archive
      },
    });

    this.logger.info('Marked messages as processed', {
      count: messageIds.length,
      label: PROCESSED_LABEL_NAME,
    });
  }

  /**
   * Gets or creates the "Jobs/LinkedIn" label
   */
  private async getOrCreateLabel(): Promise<string> {
    if (this.processedLabelId) {
      return this.processedLabelId;
    }

    if (!this.gmail) {
      throw new Error('Gmail client not initialized');
    }

    // List existing labels to find if it already exists
    const labelsResponse = await this.gmail.users.labels.list({
      userId: 'me',
    });

    const existingLabel = labelsResponse.data.labels?.find(
      (label) => label.name === PROCESSED_LABEL_NAME
    );

    if (existingLabel?.id) {
      this.processedLabelId = existingLabel.id;
      this.logger.info('Found existing label', { label: PROCESSED_LABEL_NAME });
      return existingLabel.id;
    }

    // Create the label if it doesn't exist
    const createResponse = await this.gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: PROCESSED_LABEL_NAME,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });

    if (!createResponse.data.id) {
      throw new Error(`Failed to create label: ${PROCESSED_LABEL_NAME}`);
    }

    this.processedLabelId = createResponse.data.id;
    this.logger.info('Created new label', { label: PROCESSED_LABEL_NAME });
    return createResponse.data.id;
  }
}
