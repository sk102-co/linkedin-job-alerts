/**
 * One-time OAuth setup script
 *
 * This script guides you through the OAuth flow to obtain a refresh token
 * for accessing Gmail and Google Sheets APIs.
 *
 * Prerequisites:
 * 1. Create a project in Google Cloud Console
 * 2. Enable Gmail and Sheets APIs
 * 3. Create OAuth 2.0 credentials (Desktop app)
 * 4. Download credentials.json to the project root
 *
 * Usage:
 *   npm run setup-oauth
 */

import * as fs from 'fs';
import * as http from 'http';
import * as url from 'url';
import * as readline from 'readline';
import { google } from 'googleapis';

/**
 * File paths
 */
const CREDENTIALS_PATH = 'credentials.json';
const TOKEN_OUTPUT_PATH = 'token.json';

/**
 * OAuth scopes required by the application
 * Using gmail.modify to allow marking as read, adding labels, and archiving
 */
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/spreadsheets',
];

/**
 * Local server port for OAuth callback
 */
const CALLBACK_PORT = 3000;

/**
 * Credentials file structure
 */
interface CredentialsFile {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

/**
 * Loads OAuth credentials from file
 */
function loadCredentials(): { clientId: string; clientSecret: string } {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`Error: ${CREDENTIALS_PATH} not found.`);
    console.log('\nTo set up OAuth:');
    console.log('1. Go to https://console.cloud.google.com/apis/credentials');
    console.log('2. Create OAuth 2.0 credentials (Desktop app type)');
    console.log('3. Download and save as credentials.json in project root');
    process.exit(1);
  }

  const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  const credentials: CredentialsFile = JSON.parse(content);

  const creds = credentials.installed ?? credentials.web;
  if (!creds) {
    console.error('Error: Invalid credentials file format');
    process.exit(1);
  }

  return {
    clientId: creds.client_id,
    clientSecret: creds.client_secret,
  };
}

/**
 * Starts a local server to receive the OAuth callback
 */
function startCallbackServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end('Bad Request');
        return;
      }

      const parsedUrl = url.parse(req.url, true);
      const code = parsedUrl.query.code as string | undefined;
      const error = parsedUrl.query.error as string | undefined;

      if (error) {
        res.writeHead(400);
        res.end(`OAuth Error: ${error}`);
        server.close();
        reject(new Error(`OAuth Error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1>✓ Authorization Successful</h1>
              <p>You can close this window and return to the terminal.</p>
            </body>
          </html>
        `);
        server.close();
        resolve(code);
      } else {
        res.writeHead(400);
        res.end('Missing authorization code');
      }
    });

    server.listen(CALLBACK_PORT, () => {
      console.log(`\nCallback server listening on port ${CALLBACK_PORT}`);
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Prompts user to enter authorization code manually
 */
function promptForCode(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('\nEnter the authorization code: ', (code) => {
      rl.close();
      resolve(code.trim());
    });
  });
}

/**
 * Main OAuth setup flow
 */
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('LinkedIn Job Alert - OAuth Setup');
  console.log('='.repeat(60));

  const { clientId, clientSecret } = loadCredentials();

  const redirectUri = `http://localhost:${CALLBACK_PORT}`;
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Generate the authorization URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to get refresh token
  });

  console.log('\n1. Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n2. Sign in with your Google account and grant permissions\n');

  let code: string;

  try {
    // Try automatic callback
    code = await startCallbackServer();
    console.log('\nReceived authorization code via callback');
  } catch (error) {
    // Fall back to manual input
    console.log('\nAutomatic callback failed. Please enter the code manually.');
    code = await promptForCode();
  }

  // Exchange code for tokens
  console.log('\nExchanging code for tokens...');
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error('\nError: No refresh token received.');
    console.log('This can happen if you have already authorized this app.');
    console.log('Try revoking access at https://myaccount.google.com/permissions');
    console.log('Then run this script again.');
    process.exit(1);
  }

  // Save tokens to file
  fs.writeFileSync(TOKEN_OUTPUT_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\nTokens saved to ${TOKEN_OUTPUT_PATH}`);

  // Print secrets to store in Secret Manager
  console.log('\n' + '='.repeat(60));
  console.log('Store these values in Google Secret Manager:');
  console.log('='.repeat(60));
  console.log(`\n1. linkedin-job-alert-client-id:`);
  console.log(`   ${clientId}`);
  console.log(`\n2. linkedin-job-alert-client-secret:`);
  console.log(`   ${clientSecret}`);
  console.log(`\n3. linkedin-job-alert-refresh-token:`);
  console.log(`   ${tokens.refresh_token}`);

  console.log('\n' + '='.repeat(60));
  console.log('Commands to create secrets:');
  console.log('='.repeat(60));
  console.log(`
echo -n "${clientId}" | gcloud secrets create linkedin-job-alert-client-id --data-file=-

echo -n "${clientSecret}" | gcloud secrets create linkedin-job-alert-client-secret --data-file=-

echo -n "${tokens.refresh_token}" | gcloud secrets create linkedin-job-alert-refresh-token --data-file=-
  `);

  console.log('\nSetup complete! Delete credentials.json and token.json after storing secrets.\n');
}

main().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
