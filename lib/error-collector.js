import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class ErrorCollector {
  constructor() {
    this.errors = [];
    this.maxErrors = 1000; // Prevent memory overflow
  }

  /**
   * Add error to collection
   * @param {string} jobName - Name of the cron job that failed
   * @param {Error} error - The error object
   * @param {Object} context - Additional context about the error
   */
  addError(jobName, error, context = {}) {
    const errorEntry = {
      jobName,
      message: error.message || 'Unknown error',
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
      timestampFormatted: new Date().toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
      }),
    };

    this.errors.push(errorEntry);

    // Prevent memory overflow
    if (this.errors.length > this.maxErrors) {
      this.errors.shift(); // Remove oldest error
    }
  }

  /**
   * Get all collected errors and clear the collection
   */
  getAndClearErrors() {
    const errors = [...this.errors];
    this.errors = [];
    return errors;
  }

  /**
   * Get errors count
   */
  getErrorsCount() {
    return this.errors.length;
  }

  /**
   * Group errors by job name
   */
  groupErrorsByJob(errors) {
    const grouped = {};
    
    errors.forEach(error => {
      if (!grouped[error.jobName]) {
        grouped[error.jobName] = [];
      }
      grouped[error.jobName].push(error);
    });

    return grouped;
  }

  /**
   * Send batch notification with all collected errors
   */
  async sendBatchNotification() {
    const errors = this.getAndClearErrors();
    
    if (errors.length === 0) {
      // Silent when no errors - no email, no console log
      return;
    }

    const adminEmail = process.env.ADMIN_EMAIL;

    if (!adminEmail) {
      console.error('ADMIN_EMAIL is not configured in environment variables');
      return;
    }

    const now = new Date().toLocaleString('pl-PL', {
      timeZone: 'Europe/Warsaw',
    });

    const groupedErrors = this.groupErrorsByJob(errors);
    const jobNames = Object.keys(groupedErrors);
    const subject = `[CRON] Error Report - ${errors.length} errors in ${jobNames.length} jobs - ${now}`;

    // Create summary statistics
    const summary = jobNames.map(jobName => {
      const jobErrors = groupedErrors[jobName];
      const uniqueMessages = [...new Set(jobErrors.map(e => e.message))];
      return {
        jobName,
        count: jobErrors.length,
        uniqueErrorTypes: uniqueMessages.length,
        firstOccurrence: jobErrors[0].timestampFormatted,
        lastOccurrence: jobErrors[jobErrors.length - 1].timestampFormatted,
      };
    });

    // Build HTML email
    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px;">
        <h2 style="color: #d32f2f;">Error Report - Last Hour</h2>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0;">
          <p><strong>Report Period:</strong> Last hour until ${now}</p>
          <p><strong>Total Errors:</strong> ${errors.length}</p>
          <p><strong>Jobs with Errors:</strong> ${jobNames.length}</p>
        </div>

        <h3>Summary</h3>
        <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
          <thead>
            <tr style="background-color: #e0e0e0;">
              <th style="padding: 8px; text-align: left; border: 1px solid #ccc;">Job Name</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Error Count</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Unique Types</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">First Occurrence</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Last Occurrence</th>
            </tr>
          </thead>
          <tbody>
    `;

    summary.forEach(item => {
      html += `
            <tr>
              <td style="padding: 8px; border: 1px solid #ccc;">${item.jobName}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc;">${item.count}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc;">${item.uniqueErrorTypes}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc; font-size: 12px;">${item.firstOccurrence}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc; font-size: 12px;">${item.lastOccurrence}</td>
            </tr>
      `;
    });

    html += `
          </tbody>
        </table>

        <h3>Error Details</h3>
    `;

    // Add detailed errors grouped by job
    jobNames.forEach(jobName => {
      const jobErrors = groupedErrors[jobName];
      const uniqueMessages = {};
      
      // Group by error message to avoid repetition
      jobErrors.forEach(error => {
        const key = error.message;
        if (!uniqueMessages[key]) {
          uniqueMessages[key] = {
            message: error.message,
            stack: error.stack,
            occurrences: [],
          };
        }
        uniqueMessages[key].occurrences.push({
          timestamp: error.timestampFormatted,
          context: error.context,
        });
      });

      html += `
        <div style="margin: 20px 0; border: 1px solid #ccc; border-radius: 5px; padding: 10px;">
          <h4 style="color: #1976d2; margin-top: 0;">${jobName} (${jobErrors.length} errors)</h4>
      `;

      Object.values(uniqueMessages).forEach(errorType => {
        html += `
          <div style="background-color: #ffebee; padding: 10px; border-radius: 3px; margin: 10px 0;">
            <p><strong>Error (${errorType.occurrences.length} occurrences):</strong></p>
            <pre style="background-color: #fff; padding: 8px; border: 1px solid #ccc; border-radius: 3px; overflow-x: auto; font-size: 12px;">
${errorType.message}
            </pre>
            
            <details style="margin-top: 10px;">
              <summary style="cursor: pointer; color: #666;">Show details</summary>
              
              ${errorType.stack ? `
              <p style="margin-top: 10px;"><strong>Stack trace:</strong></p>
              <pre style="background-color: #fff; padding: 8px; border: 1px solid #ccc; border-radius: 3px; overflow-x: auto; font-size: 11px;">
${errorType.stack}
              </pre>
              ` : ''}
              
              <p style="margin-top: 10px;"><strong>Occurrences:</strong></p>
              <ul style="font-size: 12px;">
                ${errorType.occurrences.map(occ => `
                  <li>${occ.timestamp}${Object.keys(occ.context).length > 0 ? ` - Context: ${JSON.stringify(occ.context)}` : ''}</li>
                `).join('')}
              </ul>
            </details>
          </div>
        `;
      });

      html += `
        </div>
      `;
    });

    html += `
      </div>
    `;

    try {
      await axios.post(`${process.env.API_URL}/mailer`, {
        to: adminEmail,
        subject,
        html,
      });
      console.log(`Batch error notification sent: ${errors.length} errors from ${jobNames.length} jobs`);
    } catch (sendError) {
      console.error('Failed to send batch error notification:', sendError.message);
      // Store errors back if sending failed
      errors.forEach(error => {
        this.errors.push(error);
      });
    }
  }
}

// Create singleton instance
export const errorCollector = new ErrorCollector();