import axios from 'axios';
import dotenv from 'dotenv';
import { errorCollector } from './error-collector.js';

dotenv.config();

/**
 * Send error notification to administrator
 * @param {string} jobName - Name of the cron job that failed
 * @param {Error} error - The error object
 * @param {Object} context - Additional context about the error
 */
export async function notifyAdminAboutError(jobName, error, context = {}) {
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!adminEmail) {
    console.error('ADMIN_EMAIL is not configured in environment variables');
    return;
  }

  const timestamp = new Date().toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw',
  });

  const subject = `[CRON ERROR] ${jobName} - ${timestamp}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #d32f2f;">Błąd w zadaniu cron</h2>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0;">
        <p><strong>Zadanie:</strong> ${jobName}</p>
        <p><strong>Czas:</strong> ${timestamp}</p>
      </div>

      <div style="background-color: #ffebee; padding: 15px; border-radius: 5px; margin: 10px 0;">
        <p><strong>Błąd:</strong></p>
        <pre style="background-color: #fff; padding: 10px; border: 1px solid #ccc; border-radius: 3px; overflow-x: auto;">
${error.message || 'Unknown error'}
        </pre>
        
        ${
          error.stack
            ? `
        <p><strong>Stack trace:</strong></p>
        <pre style="background-color: #fff; padding: 10px; border: 1px solid #ccc; border-radius: 3px; overflow-x: auto; font-size: 12px;">
${error.stack}
        </pre>
        `
            : ''
        }
      </div>

      ${
        Object.keys(context).length > 0
          ? `
      <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 10px 0;">
        <p><strong>Kontekst:</strong></p>
        <pre style="background-color: #fff; padding: 10px; border: 1px solid #ccc; border-radius: 3px; overflow-x: auto;">
${JSON.stringify(context, null, 2)}
        </pre>
      </div>
      `
          : ''
      }
    </div>
  `;

  try {
    await axios.post(`${process.env.API_URL}/mailer`, {
      to: adminEmail,
      subject,
      html,
    });
    console.log(`Admin notification sent for error in ${jobName}`);
  } catch (sendError) {
    console.error(
      `Failed to send admin notification for ${jobName}:`,
      sendError.message
    );
  }
}

/**
 * Wrapper function to execute cron job with error handling and admin notification
 * @param {string} jobName - Name of the cron job
 * @param {Function} jobFunction - The actual job function to execute
 */
export async function executeWithErrorNotification(jobName, jobFunction) {
  try {
    await jobFunction();
  } catch (error) {
    console.error(`Error in ${jobName}:`, error);
    // Pass error context if available
    const context = error.context || {};
    
    // Add error to collector for batch notification
    errorCollector.addError(jobName, error, context);
    
    // Re-throw to maintain original error behavior
    throw error;
  }
}
