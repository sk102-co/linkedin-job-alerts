/**
 * @module utils/secrets
 *
 * Shared utility for fetching secrets from Google Secret Manager.
 *
 * This module provides a singleton Secret Manager client and helper function
 * to fetch secrets, reducing code duplication across all API clients.
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

/**
 * Singleton Secret Manager client instance.
 * Reusing the client reduces connection overhead across multiple secret fetches.
 */
let secretManagerClient: SecretManagerServiceClient | null = null;

/**
 * Gets the singleton Secret Manager client instance.
 * Creates the client on first call, reuses it on subsequent calls.
 */
function getSecretManagerClient(): SecretManagerServiceClient {
  if (!secretManagerClient) {
    secretManagerClient = new SecretManagerServiceClient();
  }
  return secretManagerClient;
}

/**
 * Fetches a secret value from Google Secret Manager.
 *
 * @param projectId - The Google Cloud project ID
 * @param secretName - The name of the secret to fetch
 * @returns The secret value as a string
 * @throws Error if the secret has no payload
 *
 * @example
 * ```typescript
 * const apiKey = await getSecret('my-project', 'api-key-secret');
 * ```
 */
export async function getSecret(projectId: string, secretName: string): Promise<string> {
  const client = getSecretManagerClient();
  const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;

  const [version] = await client.accessSecretVersion({ name });
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
 * Common secret names used across the application.
 * Centralizing these prevents typos and makes refactoring easier.
 */
export const SECRET_NAMES = {
  CLIENT_ID: 'linkedin-job-alert-client-id',
  CLIENT_SECRET: 'linkedin-job-alert-client-secret',
  REFRESH_TOKEN: 'linkedin-job-alert-refresh-token',
  GEMINI_API_KEY: 'linkedin-job-alert-gemini-api-key',
  CLAUDE_API_KEY: 'linkedin-job-alert-claude-api-key',
} as const;
