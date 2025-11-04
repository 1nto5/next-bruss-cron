import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { parseEmailAddresses } from '../lib/email-helper.js';

dotenv.config();

// Track last known file sizes and last notified sizes per file
const fileState = new Map();

// Log directory and app names to monitor
const LOG_DIR = 'C:\\ProgramData\\pm2\\home\\logs';
const APP_NAMES = ['bruss-floor', 'bruss-intra', 'bruss-cron'];

/**
 * Find all error log files for an application
 * Matches files like: bruss-cron-error.log, bruss-cron-error-0.log, bruss-cron-error-6.log, etc.
 * @param {string} appName - Application name
 * @returns {Promise<string[]>} Array of file paths
 */
async function findErrorLogFiles(appName) {
  try {
    const files = await fs.readdir(LOG_DIR);
    // Match files like: {appName}-error.log or {appName}-error-{number}.log
    const pattern = new RegExp(`^${appName}-error(-\\d+)?\\.log$`);
    const matchingFiles = files
      .filter((file) => pattern.test(file))
      .map((file) => path.join(LOG_DIR, file))
      .sort(); // Sort to have consistent order (base name first, then numbered)

    return matchingFiles;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`Log directory not found: ${LOG_DIR}`);
      return [];
    }
    throw error;
  }
}

/**
 * Get all log files to monitor
 * @returns {Promise<Array<{path: string, appName: string}>>}
 */
async function getLogFiles() {
  const logFiles = [];

  for (const appName of APP_NAMES) {
    const files = await findErrorLogFiles(appName);
    for (const filePath of files) {
      logFiles.push({
        path: filePath,
        appName,
      });
    }
  }

  return logFiles;
}

/**
 * Read last N lines from a file
 * @param {string} filePath - Path to the file
 * @param {number} numLines - Number of lines to read from end
 * @returns {Promise<string[]>} Array of lines
 */
async function readLastLines(filePath, numLines = 100) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);
    return lines.slice(-numLines);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      return [];
    }
    throw error;
  }
}

/**
 * Send email notification about PM2 error log
 * @param {string} appName - Application name
 * @param {string} filePath - Path to error log file
 * @param {string[]} errorLines - Array of error lines
 * @param {number} sizeChange - Bytes that file grew
 */
async function sendErrorNotification(
  appName,
  filePath,
  errorLines,
  sizeChange
) {
  const adminEmail = process.env.ADMIN_EMAIL;
  const apiUrl = process.env.API_URL;

  if (!adminEmail) {
    console.error('ADMIN_EMAIL is not configured in environment variables');
    return;
  }

  if (!apiUrl) {
    console.error('API_URL is not configured in environment variables');
    return;
  }

  const timestamp = new Date().toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw',
  });

  const subject = `[CRON PM2 ERROR] ${appName} - ${timestamp}`;

  const errorContent =
    errorLines.length > 0 ? errorLines.join('\n') : 'No error lines available';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 800px;">
      <h2 style="color: #d32f2f;">PM2 Error Log Alert</h2>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0;">
        <p><strong>Aplikacja:</strong> ${appName}</p>
        <p><strong>Plik:</strong> ${filePath}</p>
        <p><strong>Czas:</strong> ${timestamp}</p>
        <p><strong>Zmiana rozmiaru:</strong> +${sizeChange} bytes</p>
      </div>

      <div style="background-color: #ffebee; padding: 15px; border-radius: 5px; margin: 10px 0;">
        <p><strong>Ostatnie linie błędów:</strong></p>
        <pre style="background-color: #fff; padding: 10px; border: 1px solid #ccc; border-radius: 3px; overflow-x: auto; font-size: 12px; max-height: 500px; overflow-y: auto;">
${errorContent}
        </pre>
      </div>
    </div>
  `;

  try {
    const emailAddresses = parseEmailAddresses(adminEmail);
    await axios.post(`${apiUrl}/mailer`, {
      to: emailAddresses.join(','),
      subject,
      html,
    });
    console.log(
      `PM2 error notification sent for ${appName} to ${emailAddresses.length} recipient(s)`
    );
  } catch (sendError) {
    console.error(
      `Failed to send PM2 error notification for ${appName}:`,
      sendError.message
    );
    throw sendError;
  }
}

/**
 * Monitor PM2 error log files and send notifications when errors are detected
 */
export async function monitorPm2ErrorLogs() {
  const results = [];
  const logFiles = await getLogFiles();

  for (const logFile of logFiles) {
    const { path: filePath, appName } = logFile;

    try {
      // Get current file stats
      let currentSize = 0;
      try {
        const stats = await fs.stat(filePath);
        currentSize = stats.size;
      } catch (statError) {
        if (statError.code === 'ENOENT') {
          // File doesn't exist yet, initialize state and continue
          if (!fileState.has(filePath)) {
            fileState.set(filePath, {
              lastSize: 0,
              lastNotifiedSize: 0,
            });
          }
          continue;
        }
        throw statError;
      }

      // Initialize state if not exists
      if (!fileState.has(filePath)) {
        fileState.set(filePath, {
          lastSize: currentSize,
          lastNotifiedSize: currentSize,
        });
        continue; // First run, just initialize
      }

      const state = fileState.get(filePath);
      const lastSize = state.lastSize;
      const lastNotifiedSize = state.lastNotifiedSize;

      // Check if file grew
      if (currentSize > lastSize) {
        const sizeChange = currentSize - lastSize;

        // Check if we already notified about this size (deduplication)
        if (currentSize > lastNotifiedSize) {
          // Read last 100 lines from file
          const errorLines = await readLastLines(filePath, 100);

          // Send notification
          await sendErrorNotification(
            appName,
            filePath,
            errorLines,
            sizeChange
          );

          // Update last notified size
          state.lastNotifiedSize = currentSize;
        }

        // Update last known size
        state.lastSize = currentSize;
        fileState.set(filePath, state);

        results.push({
          appName,
          filePath,
          sizeChange,
          notified: currentSize > lastNotifiedSize,
        });
      } else {
        // File didn't grow, just update last size
        state.lastSize = currentSize;
        fileState.set(filePath, state);
      }
    } catch (error) {
      console.error(`Error monitoring ${appName} log file:`, error);
      results.push({
        appName,
        filePath,
        error: error.message,
      });
    }
  }

  return {
    checked: logFiles.length,
    results,
    timestamp: new Date().toLocaleString('pl-PL', {
      timeZone: 'Europe/Warsaw',
    }),
  };
}
