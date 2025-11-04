import axios from 'axios';
import dotenv from 'dotenv';
import { parseEmailAddresses } from './email-helper.js';

dotenv.config();

class TemperatureMissingSensorCollector {
  constructor() {
    this.missingSensors = [];
    this.maxEntries = 1000; // Prevent memory overflow
  }

  /**
   * Add missing sensor reading to collection
   * @param {string} oven - Oven name
   * @param {string} ip - IP address of the oven controller
   * @param {Array} processInfo - Active processes information
   * @param {Date} lastSuccessfulRead - Last successful sensor read timestamp
   * @param {Error} error - The error that occurred
   * @param {Date} timestamp - Timestamp of the failure
   */
  addMissingSensor(oven, ip, processInfo, lastSuccessfulRead, error, timestamp) {
    const entry = {
      oven,
      ip,
      processInfo,
      lastSuccessfulRead: lastSuccessfulRead ? lastSuccessfulRead.toISOString() : null,
      lastSuccessfulReadFormatted: lastSuccessfulRead ? lastSuccessfulRead.toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
      }) : 'Nigdy',
      errorMessage: error.message,
      errorType: error.name,
      errorCode: error.code,
      timestamp: timestamp.toISOString(),
      timestampFormatted: timestamp.toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
      }),
    };

    this.missingSensors.push(entry);

    // Prevent memory overflow
    if (this.missingSensors.length > this.maxEntries) {
      this.missingSensors.shift(); // Remove oldest entry
    }
  }

  /**
   * Get all collected missing sensor entries and clear the collection
   */
  getAndClearMissingSensors() {
    const entries = [...this.missingSensors];
    this.missingSensors = [];
    return entries;
  }

  /**
   * Get missing sensor count
   */
  getMissingSensorsCount() {
    return this.missingSensors.length;
  }

  /**
   * Group missing sensor entries by oven name
   */
  groupByOven(entries) {
    const grouped = {};

    entries.forEach((entry) => {
      if (!grouped[entry.oven]) {
        grouped[entry.oven] = [];
      }
      grouped[entry.oven].push(entry);
    });

    return grouped;
  }

  /**
   * Send batch notification with all collected missing sensor readings
   */
  async sendBatchNotification() {
    const entries = this.getAndClearMissingSensors();

    if (entries.length === 0) {
      // Silent when no missing sensors - no email, no console log
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

    const groupedEntries = this.groupByOven(entries);
    const ovenNames = Object.keys(groupedEntries);
    const subject = `[CRON] Missing Oven Sensor Readings - ${entries.length} failures in ${ovenNames.length} ovens - ${now}`;

    // Create summary statistics
    const summary = ovenNames.map((oven) => {
      const ovenEntries = groupedEntries[oven];
      return {
        oven,
        count: ovenEntries.length,
        firstOccurrence: ovenEntries[0].timestampFormatted,
        lastOccurrence: ovenEntries[ovenEntries.length - 1].timestampFormatted,
        ip: ovenEntries[0].ip,
      };
    });

    // Build HTML email
    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px;">
        <h2 style="color: #d32f2f;">🔴 Missing Oven Sensor Readings - Last Hour</h2>
        
        <div style="background-color: #ffebee; padding: 15px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #d32f2f;">
          <p><strong>Total Failed Readings:</strong> ${entries.length}</p>
          <p><strong>Ovens Affected:</strong> ${ovenNames.length}</p>
        </div>

        <h3>Summary</h3>
        <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
          <thead>
            <tr style="background-color: #e0e0e0;">
              <th style="padding: 8px; text-align: left; border: 1px solid #ccc;">Oven</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">IP Address</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Failure Count</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">First Occurrence</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Last Occurrence</th>
            </tr>
          </thead>
          <tbody>
    `;

    summary.forEach((item) => {
      html += `
            <tr>
              <td style="padding: 8px; border: 1px solid #ccc;">${item.oven.toUpperCase()}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc;">${item.ip}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc;">${item.count}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc; font-size: 12px;">${item.firstOccurrence}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc; font-size: 12px;">${item.lastOccurrence}</td>
            </tr>
      `;
    });

    html += `
          </tbody>
        </table>

        <h3>Failure Details</h3>
    `;

    // Add detailed entries grouped by oven
    ovenNames.forEach((oven) => {
      const ovenEntries = groupedEntries[oven];

      html += `
        <div style="margin: 20px 0; border: 1px solid #d32f2f; border-radius: 5px; padding: 10px; background-color: #ffebee;">
          <h4 style="color: #d32f2f; margin-top: 0;">Oven ${oven.toUpperCase()} (${ovenEntries.length} failures)</h4>
      `;

      ovenEntries.forEach((entry) => {
        const { ip, processInfo, lastSuccessfulReadFormatted, errorMessage, errorType, timestampFormatted } = entry;

        const processRows = processInfo.map(proc =>
          `<tr><td style="border: 1px solid #ccc; padding: 6px;">${proc.hydraBatch || 'N/A'}</td><td style="border: 1px solid #ccc; padding: 6px;">${proc.article || 'N/A'}</td><td style="border: 1px solid #ccc; padding: 6px;">${proc.status}</td><td style="border: 1px solid #ccc; padding: 6px; font-size: 11px;">${proc.startTime ? new Date(proc.startTime).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : 'N/A'}</td></tr>`
        ).join('');

        html += `
          <div style="background-color: #fff; padding: 15px; border-radius: 3px; margin: 10px 0; border-left: 4px solid #d32f2f;">
            <p><strong>Time:</strong> ${timestampFormatted}</p>
            <p><strong>IP Address:</strong> ${ip}</p>
            <p><strong>Last Successful Read:</strong> ${lastSuccessfulReadFormatted}</p>
            <p><strong>Error Type:</strong> ${errorType || 'Unknown'}</p>
            <p><strong>Error Message:</strong> ${errorMessage}</p>
            
            <details style="margin-top: 10px;">
              <summary style="cursor: pointer; color: #666;">Show active processes</summary>
              
              <h4 style="margin-top: 15px;">Active Processes</h4>
              <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
                <tr style="background-color: #e0e0e0;">
                  <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Hydra Batch</th>
                  <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Article</th>
                  <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Status</th>
                  <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Start Time</th>
                </tr>
                ${processRows}
              </table>
            </details>
          </div>
        `;
      });

      html += `
        </div>
      `;
    });

    html += `
        <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #1976d2;">
          <p><em>Note: Failed sensor readings indicate connection issues with oven controllers. Check network connectivity and controller status.</em></p>
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
      console.log(
        `Batch missing sensor notification sent: ${entries.length} failures from ${ovenNames.length} ovens to ${emailAddresses.length} recipient(s)`
      );
    } catch (sendError) {
      console.error(
        'Failed to send batch missing sensor notification:',
        sendError.message
      );
      // Store entries back if sending failed
      entries.forEach((entry) => {
        this.missingSensors.push(entry);
      });
    }
  }
}

// Create singleton instance
export const temperatureMissingSensorCollector = new TemperatureMissingSensorCollector();

