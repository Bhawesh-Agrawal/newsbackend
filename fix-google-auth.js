/**
 * Fix Google API Authentication Scopes
 *
 * Re-authenticates ADC with correct scopes for GA4, GSC, and Cloud Monitoring.
 * Usage: node fix-google-auth.js
 */

import { google } from 'googleapis';
import http from 'node:http';
import url from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { exec } from 'node:child_process';

const CLIENT_ID = '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com';
const CLIENT_SECRET = 'd-FL95Q19q7MQmFpd7hHD0Ty';
const REDIRECT_URI = 'http://localhost:3048';
const QUOTA_PROJECT = 'mango-people-news-504608';

const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/monitoring.readonly',
  'https://www.googleapis.com/auth/cloud-platform',
];

const adcDir = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'gcloud')
  : path.join(os.homedir(), '.config', 'gcloud');
const TOKEN_PATH = path.join(adcDir, 'application_default_credentials.json');

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

console.log('\n=== Google API Authentication Fix ===');
console.log('\nOpening browser for authentication...\n');
console.log('If the browser does not open, visit this URL:\n');
console.log(authUrl);
console.log('\nWaiting for callback on http://localhost:3048 ...\n');

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.query.code) {
    try {
      const { tokens } = await oauth2Client.getToken(parsed.query.code);

      if (!fs.existsSync(adcDir)) {
        fs.mkdirSync(adcDir, { recursive: true });
      }

      const adcData = {
        account: '',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        quota_project_id: QUOTA_PROJECT,
        refresh_token: tokens.refresh_token,
        type: 'authorized_user',
        universe_domain: 'googleapis.com',
      };

      fs.writeFileSync(TOKEN_PATH, JSON.stringify(adcData, null, 2));

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Authentication successful!</h1><p>You can close this window.</p>');

      console.log('✓ Authentication successful!');
      console.log(`✓ ADC saved to: ${TOKEN_PATH}`);
      console.log('\nScopes authorized:');
      SCOPES.forEach(s => console.log(`  ✓ ${s}`));
      console.log('\n⚠ Restart your backend server for changes to take effect.');

      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h1>Failed</h1><p>${err.message}</p>`);
      console.error('✗ Authentication failed:', err.message);
      server.close();
      process.exit(1);
    }
  }
});

server.listen(3048, () => {
  const platform = process.platform;
  const cmd = platform === 'win32' ? 'start ""' : platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${cmd} "${authUrl}"`);
});
