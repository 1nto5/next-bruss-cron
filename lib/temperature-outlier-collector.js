import axios from 'axios';
import dotenv from 'dotenv';
import { parseEmailAddresses } from './email-helper.js';
import { SENSOR_KEYS, SENSOR_LABELS } from './temperature-constants.js';

dotenv.config();

class TemperatureOutlierCollector {
  constructor() {
    this.outliers = [];
    this.maxOutliers = 1000; // Prevent memory overflow
  }

  /**
   * Add outlier to collection
   * @param {string} oven - Oven name
   * @param {Object} sensorData - Sensor readings data
   * @param {Object} analysis - Analysis result with outlier info
   * @param {Array} processInfo - Active processes information
   * @param {Date} timestamp - Timestamp of the reading
   */
  addOutlier(oven, sensorData, analysis, processInfo, timestamp) {
    const outlierEntry = {
      oven,
      sensorData,
      analysis,
      processInfo,
      timestamp: timestamp.toISOString(),
      timestampFormatted: timestamp.toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
      }),
    };

    this.outliers.push(outlierEntry);

    // Prevent memory overflow
    if (this.outliers.length > this.maxOutliers) {
      this.outliers.shift(); // Remove oldest outlier
    }
  }

  /**
   * Get all collected outliers and clear the collection
   */
  getAndClearOutliers() {
    const outliers = [...this.outliers];
    this.outliers = [];
    return outliers;
  }

  /**
   * Get outliers count
   */
  getOutliersCount() {
    return this.outliers.length;
  }

  /**
   * Group outliers by oven name
   */
  groupOutliersByOven(outliers) {
    const grouped = {};

    outliers.forEach((outlier) => {
      if (!grouped[outlier.oven]) {
        grouped[outlier.oven] = [];
      }
      grouped[outlier.oven].push(outlier);
    });

    return grouped;
  }

  /**
   * Send batch notification with all collected outliers
   */
  async sendBatchNotification() {
    const outliers = this.getAndClearOutliers();

    if (outliers.length === 0) {
      // Silent when no outliers - no email, no console log
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

    const groupedOutliers = this.groupOutliersByOven(outliers);
    const ovenNames = Object.keys(groupedOutliers);
    const subject = `[CRON] Temperature Outlier Report - ${outliers.length} outliers in ${ovenNames.length} ovens - ${now}`;

    // Create summary statistics
    const summary = ovenNames.map((oven) => {
      const ovenOutliers = groupedOutliers[oven];
      return {
        oven,
        count: ovenOutliers.length,
        firstOccurrence: ovenOutliers[0].timestampFormatted,
        lastOccurrence: ovenOutliers[ovenOutliers.length - 1].timestampFormatted,
      };
    });

    // Build HTML email
    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px;">
        <h2 style="color: #ff9800;">⚠️ Temperature Outlier Report - Last Hour</h2>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0;">
          <p><strong>Total Outliers:</strong> ${outliers.length}</p>
          <p><strong>Ovens with Outliers:</strong> ${ovenNames.length}</p>
        </div>

        <h3>Summary</h3>
        <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
          <thead>
            <tr style="background-color: #e0e0e0;">
              <th style="padding: 8px; text-align: left; border: 1px solid #ccc;">Oven</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ccc;">Outlier Count</th>
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
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc;">${item.count}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc; font-size: 12px;">${item.firstOccurrence}</td>
              <td style="padding: 8px; text-align: center; border: 1px solid #ccc; font-size: 12px;">${item.lastOccurrence}</td>
            </tr>
      `;
    });

    html += `
          </tbody>
        </table>

        <h3>Outlier Details</h3>
    `;

    // Add detailed outliers grouped by oven
    ovenNames.forEach((oven) => {
      const ovenOutliers = groupedOutliers[oven];

      html += `
        <div style="margin: 20px 0; border: 1px solid #ccc; border-radius: 5px; padding: 10px;">
          <h4 style="color: #1976d2; margin-top: 0;">Oven ${oven.toUpperCase()} (${ovenOutliers.length} outliers)</h4>
      `;

      ovenOutliers.forEach((outlier) => {
        const { sensorData, analysis, processInfo, timestampFormatted } = outlier;

        // Create sensor readings table
        const sensorRows = Object.entries(sensorData)
          .filter(([key, value]) => SENSOR_KEYS.includes(key) && typeof value === 'number')
          .map(([key, value]) => {
            const isOutlier = analysis.outlierSensors.includes(key);
            const style = isOutlier ? 'background-color: #ffebee; color: #d32f2f; font-weight: bold;' : '';
            return `<tr style="${style}"><td>${SENSOR_LABELS[key] || key}</td><td>${value}°C</td><td>${isOutlier ? '⚠️ OUTLIER' : '✓ OK'}</td></tr>`;
          })
          .join('');

        const processRows = processInfo.map(proc =>
          `<tr><td>${proc.hydraBatch || 'N/A'}</td><td>${proc.article || 'N/A'}</td><td>${proc.status}</td></tr>`
        ).join('');

        html += `
          <div style="background-color: #fff3e0; padding: 15px; border-radius: 3px; margin: 10px 0; border-left: 4px solid #ff9800;">
            <p><strong>Time:</strong> ${timestampFormatted}</p>
            <p><strong>Median Temperature:</strong> ${analysis.medianTemp}°C</p>
            <p><strong>Filtered Average (excluding outliers):</strong> ${analysis.avgTemp}°C</p>
            <p><strong>Outliers detected in sensors:</strong> ${analysis.outlierSensors.map(s => SENSOR_LABELS[s] || s).join(', ')}</p>
            
            <details style="margin-top: 10px;">
              <summary style="cursor: pointer; color: #666;">Show sensor readings and processes</summary>
              
              <h4 style="margin-top: 15px;">Sensor Readings</h4>
              <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
                <tr style="background-color: #e0e0e0;">
                  <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Sensor</th>
                  <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Temperature</th>
                  <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Status</th>
                </tr>
                ${sensorRows}
              </table>

              <h4 style="margin-top: 15px;">Active Processes</h4>
              <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
                <tr style="background-color: #e0e0e0;">
                  <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Hydra Batch</th>
                  <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Article</th>
                  <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Status</th>
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
        <div style="background-color: #fff3e0; padding: 15px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #ff9800;">
          <p><em>Outlier = deviation > 17% from median of all sensors</em></p>
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
        `Batch temperature outlier notification sent: ${outliers.length} outliers from ${ovenNames.length} ovens to ${emailAddresses.length} recipient(s)`
      );
    } catch (sendError) {
      console.error(
        'Failed to send batch temperature outlier notification:',
        sendError.message
      );
      // Store outliers back if sending failed
      outliers.forEach((outlier) => {
        this.outliers.push(outlier);
      });
    }
  }
}

// Create singleton instance
export const temperatureOutlierCollector = new TemperatureOutlierCollector();

