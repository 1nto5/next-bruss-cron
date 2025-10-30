import axios from 'axios';
import dotenv from 'dotenv';
import { parseEmailAddresses } from './email-helper.js';

dotenv.config();

class StatusCollector {
  constructor() {
    this.jobExecutions = [];
    this.maxExecutions = 2000; // Keep more history for status reporting
    this.lastSummarySentAt = null; // Track when last summary was sent (for time-based filtering)
  }

  /**
   * Add successful job execution to collection
   * @param {string} jobName - Name of the cron job that succeeded
   * @param {Object} result - Optional result data from the job
   */
  addSuccess(jobName, result = {}) {
    const execution = {
      jobName,
      status: 'success',
      result,
      timestamp: new Date().toISOString(),
      timestampFormatted: new Date().toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
      }),
      isBackup: result.backupName ? true : false, // Mark backup jobs
    };

    this.jobExecutions.push(execution);

    // Prevent memory overflow
    if (this.jobExecutions.length > this.maxExecutions) {
      this.jobExecutions.shift(); // Remove oldest execution
    }
  }

  /**
   * Add failed job execution to collection
   * @param {string} jobName - Name of the cron job that failed
   * @param {Error} error - The error object
   * @param {Object} context - Additional context about the error
   */
  addFailure(jobName, error, context = {}) {
    const execution = {
      jobName,
      status: 'failure',
      error: {
        message: error.message || 'Unknown error',
        stack: error.stack,
      },
      context,
      timestamp: new Date().toISOString(),
      timestampFormatted: new Date().toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
      }),
    };

    this.jobExecutions.push(execution);

    // Prevent memory overflow
    if (this.jobExecutions.length > this.maxExecutions) {
      this.jobExecutions.shift(); // Remove oldest execution
    }
  }

  /**
   * Get executions from the last specified hours
   * @param {number} hours - Number of hours to look back
   */
  getRecentExecutions(hours = 24) {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.jobExecutions.filter(exec => new Date(exec.timestamp) > cutoff);
  }

  /**
   * Get executions since the specified timestamp
   * @param {string|null} timestamp - ISO timestamp to filter from (null returns all)
   * @returns {Array} Filtered executions
   */
  getExecutionsSince(timestamp) {
    if (!timestamp) {
      // First run - return all executions
      return [...this.jobExecutions];
    }

    const cutoffDate = new Date(timestamp);
    
    // Handle edge case: if timestamp is older than oldest execution, return all available
    if (this.jobExecutions.length > 0) {
      const oldestExecution = this.jobExecutions[0];
      if (cutoffDate < new Date(oldestExecution.timestamp)) {
        return [...this.jobExecutions];
      }
    }

    return this.jobExecutions.filter(exec => new Date(exec.timestamp) > cutoffDate);
  }

  /**
   * Format period duration in human-readable format
   * @param {number} milliseconds - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  formatPeriodDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      const remainingHours = hours % 24;
      return remainingHours > 0 ? `${days} day${days > 1 ? 's' : ''} ${remainingHours} hour${remainingHours > 1 ? 's' : ''}` : `${days} day${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return remainingMinutes > 0 ? `${hours} hour${hours > 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}` : `${hours} hour${hours > 1 ? 's' : ''}`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      return `${seconds} second${seconds > 1 ? 's' : ''}`;
    }
  }

  /**
   * Generate summary statistics for executions
   * @param {Array} executions - Array of execution objects to analyze
   */
  generateSummary(executions) {
    const jobStats = {};

    // Calculate period info
    let periodStart = null;
    let periodEnd = null;

    if (executions.length > 0) {
      const timestamps = executions.map(e => new Date(e.timestamp));
      periodStart = new Date(Math.min(...timestamps));
      periodEnd = new Date(Math.max(...timestamps));
    }

    // Group executions by job name
    executions.forEach(exec => {
      if (!jobStats[exec.jobName]) {
        jobStats[exec.jobName] = {
          jobName: exec.jobName,
          totalExecutions: 0,
          successCount: 0,
          failureCount: 0,
          lastExecution: null,
          lastSuccess: null,
          lastFailure: null,
        };
      }

      const stats = jobStats[exec.jobName];
      stats.totalExecutions++;

      if (exec.status === 'success') {
        stats.successCount++;
        if (!stats.lastSuccess || new Date(exec.timestamp) > new Date(stats.lastSuccess)) {
          stats.lastSuccess = exec.timestampFormatted;
        }
      } else {
        stats.failureCount++;
        if (!stats.lastFailure || new Date(exec.timestamp) > new Date(stats.lastFailure)) {
          stats.lastFailure = exec.timestampFormatted;
        }
      }

      if (!stats.lastExecution || new Date(exec.timestamp) > new Date(stats.lastExecution)) {
        stats.lastExecution = exec.timestampFormatted;
      }
    });

    const generatedAt = new Date().toLocaleString('pl-PL', {
      timeZone: 'Europe/Warsaw',
    });

    const periodDuration = periodStart && periodEnd ? this.formatPeriodDuration(periodEnd - periodStart) : null;
    const periodStartFormatted = periodStart ? periodStart.toLocaleString('pl-PL', {
      timeZone: 'Europe/Warsaw',
    }) : null;

    return {
      periodStart: periodStart ? periodStart.toISOString() : null,
      periodEnd: periodEnd ? periodEnd.toISOString() : null,
      periodStartFormatted,
      periodDuration,
      totalExecutions: executions.length,
      successfulExecutions: executions.filter(e => e.status === 'success').length,
      failedExecutions: executions.filter(e => e.status === 'failure').length,
      uniqueJobs: Object.keys(jobStats).length,
      jobStats: Object.values(jobStats),
      generatedAt,
    };
  }

  /**
   * Send regular status summary email
   * Includes all executions since the last summary was sent
   */
  async sendStatusSummary() {
    // Get executions since last summary was sent
    const filteredExecutions = this.getExecutionsSince(this.lastSummarySentAt);
    const summary = this.generateSummary(filteredExecutions);

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      console.error('ADMIN_EMAIL is not configured in environment variables');
      return;
    }

    // Build subject line with period info
    let subject = `[CRON] Status Summary - ${summary.totalExecutions} executions since last report`;
    if (summary.periodStartFormatted) {
      subject += ` (since ${summary.periodStartFormatted})`;
    }
    subject += ` - ${summary.generatedAt}`;

    // Calculate overall health score
    const healthScore = summary.totalExecutions > 0
      ? ((summary.successfulExecutions / summary.totalExecutions) * 100).toFixed(1)
      : 100;

    const statusColor = summary.failedExecutions === 0 ? '#4caf50' :
                       healthScore >= 90 ? '#ff9800' : '#f44336';

    // Build period description
    let periodDescription = 'All executions since system start';
    if (summary.periodStartFormatted) {
      if (summary.periodDuration) {
        periodDescription = `Since ${summary.periodStartFormatted} (${summary.periodDuration}) until ${summary.generatedAt}`;
      } else {
        periodDescription = `Since ${summary.periodStartFormatted} until ${summary.generatedAt}`;
      }
    } else {
      periodDescription = `All executions until ${summary.generatedAt}`;
    }

    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px;">
        <h2 style="color: ${statusColor};">Status Summary - Since Last Report</h2>

        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0;">
          <p><strong>Report Period:</strong> ${periodDescription}</p>
          <p><strong>Overall Health:</strong> <span style="color: ${statusColor}; font-weight: bold;">${healthScore}%</span></p>
          <p><strong>Total Executions:</strong> ${summary.totalExecutions}</p>
          <p><strong>Successful:</strong> <span style="color: #4caf50;">${summary.successfulExecutions}</span></p>
          <p><strong>Failed:</strong> <span style="color: #f44336;">${summary.failedExecutions}</span></p>
          <p><strong>Active Jobs:</strong> ${summary.uniqueJobs}</p>
        </div>
    `;

    if (summary.totalExecutions === 0) {
      html += `
        <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #ffc107;">
          <p><strong>Note:</strong> No job executions recorded since last report.</p>
          <p>This could indicate:</p>
          <ul>
            <li>All jobs are scheduled outside this time window</li>
            <li>The system was recently started</li>
            <li>Jobs may not be running as expected</li>
          </ul>
        </div>
      `;
    } else {
      // Add backup summary section
      const backupExecutions = filteredExecutions.filter(exec => exec.isBackup && exec.status === 'success');
      if (backupExecutions.length > 0) {
        html += `
          <h3>Backup Summary</h3>
          <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
            <thead>
              <tr style="background-color: #e3f2fd;">
                <th style="padding: 8px; text-align: left; border: 1px solid #ccc;">Backup Name</th>
                <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Files Copied</th>
                <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Files Skipped</th>
                <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Total Size</th>
                <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Synology IP</th>
                <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Last Run</th>
              </tr>
            </thead>
            <tbody>
        `;

        // Group backups by name and get latest execution for each
        const backupsByName = {};
        backupExecutions.forEach(exec => {
          const backupName = exec.result.backupName;
          if (!backupsByName[backupName] || new Date(exec.timestamp) > new Date(backupsByName[backupName].timestamp)) {
            backupsByName[backupName] = exec;
          }
        });

        Object.values(backupsByName).forEach(backup => {
          const result = backup.result;
          html += `
            <tr>
              <td style="padding: 8px; border: 1px solid #ccc; font-weight: bold;">${result.backupName}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc; color: #2196f3;">${result.copiedFiles}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc; color: #757575;">${result.skippedFiles}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc;">${result.formattedSize}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc; font-size: 12px;">${result.synologyIp}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc; font-size: 12px;">${backup.timestampFormatted}</td>
            </tr>
          `;
        });

        html += `
            </tbody>
          </table>
        `;
      }

      html += `
        <h3>Job Summary</h3>
        <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
          <thead>
            <tr style="background-color: #e0e0e0;">
              <th style="padding: 8px; text-align: left; border: 1px solid #ccc;">Job Name</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Executions</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Success</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Failed</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Success Rate</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Last Execution</th>
            </tr>
          </thead>
          <tbody>
      `;

      // Sort jobs by name for consistent reporting
      summary.jobStats.sort((a, b) => a.jobName.localeCompare(b.jobName));

      summary.jobStats.forEach(job => {
        const successRate = job.totalExecutions > 0
          ? ((job.successCount / job.totalExecutions) * 100).toFixed(0)
          : '0';

        const rateColor = job.failureCount === 0 ? '#4caf50' :
                         successRate >= 90 ? '#ff9800' : '#f44336';

        html += `
          <tr>
            <td style="padding: 8px; border: 1px solid #ccc;">${job.jobName}</td>
            <td style="padding: 8px; text-align: center; border: 1px solid #ccc;">${job.totalExecutions}</td>
            <td style="padding: 8px; text-align: center; border: 1px solid #ccc; color: #4caf50;">${job.successCount}</td>
            <td style="padding: 8px; text-align: center; border: 1px solid #ccc; color: #f44336;">${job.failureCount}</td>
            <td style="padding: 8px; text-align: center; border: 1px solid #ccc; color: ${rateColor}; font-weight: bold;">${successRate}%</td>
            <td style="padding: 8px; text-align: center; border: 1px solid #ccc; font-size: 12px;">${job.lastExecution}</td>
          </tr>
        `;
      });

      html += `
          </tbody>
        </table>
      `;

      // Add details for failed jobs
      const failedJobs = summary.jobStats.filter(job => job.failureCount > 0);
      if (failedJobs.length > 0) {
        html += `
          <h3 style="color: #f44336;">Jobs with Failures</h3>
        `;

        failedJobs.forEach(job => {
          html += `
            <div style="background-color: #ffebee; padding: 10px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #f44336;">
              <p><strong>${job.jobName}</strong></p>
              <p>Failures: ${job.failureCount}/${job.totalExecutions} executions</p>
              <p>Last failure: ${job.lastFailure || 'N/A'}</p>
              <p>Last success: ${job.lastSuccess || 'No recent successes'}</p>
            </div>
          `;
        });
      }

      // Add note about healthy jobs if all are successful
      if (summary.failedExecutions === 0) {
        html += `
          <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #4caf50;">
            <p><strong>✅ All systems operational</strong></p>
            <p>All ${summary.totalExecutions} job executions completed successfully since last report.</p>
          </div>
        `;
      }
    }

    html += `
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ccc; font-size: 12px; color: #666;">
          <p>This is an automated status report from the Next-Bruss CRON system.</p>
          <p>Report generated: ${summary.generatedAt}</p>
        </div>
      </div>
    `;

    try {
      const emailAddresses = parseEmailAddresses(adminEmail);
      await axios.post(`${process.env.API_URL}/mailer`, {
        to: emailAddresses.join(','),
        subject,
        html,
      });
      
      // Update last summary sent timestamp after successful send
      this.lastSummarySentAt = new Date().toISOString();
      
      console.log(`Status summary sent to ${emailAddresses.length} recipient(s): ${summary.totalExecutions} executions, ${summary.successfulExecutions} successful, ${summary.failedExecutions} failed`);
    } catch (sendError) {
      console.error('Failed to send status summary:', sendError.message);
    }
  }
}

// Create singleton instance
export const statusCollector = new StatusCollector();