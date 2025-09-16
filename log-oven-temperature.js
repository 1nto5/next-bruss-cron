import dotenv from 'dotenv';
import { dbc } from './lib/mongo.js';
import axios from 'axios';

dotenv.config();

// Ensure the API key is set in the environment
const API_KEY = process.env.CONTROLLINO_API_KEY;
if (!API_KEY) {
  throw new Error('CONTROLLINO_API_KEY environment variable is not set');
}

// Helper to get all oven configs (oven name to IP mapping)
async function getOvenConfigs() {
  const ovenConfigsCol = await dbc('oven_controllino_configs');
  const configs = await ovenConfigsCol.find({}).toArray();
  // Build a map: { ovenName: ip }
  const map = {};
  for (const cfg of configs) {
    if (cfg.oven && cfg.ip) {
      map[cfg.oven] = cfg.ip;
    }
  }
  return map;
}

// Helper to get all active oven processes (running or prepared)
async function getActiveOvenProcesses() {
  const ovenProcessesCol = await dbc('oven_processes');
  return ovenProcessesCol.find({ status: { $in: ['running', 'prepared'] } }).toArray();
}

// Helper to get the last successful temperature reading time for an oven
async function getLastSuccessfulReadTime(oven) {
  const ovenTemperatureLogsCol = await dbc('oven_temperature_logs');
  const lastLog = await ovenTemperatureLogsCol.findOne(
    { oven },
    { sort: { timestamp: -1 } }
  );
  return lastLog ? lastLog.timestamp : null;
}

// Helper to get the last time an outlier notification was sent for an oven
async function getLastOutlierNotificationTime(oven) {
  const ovenTemperatureLogsCol = await dbc('oven_temperature_logs');
  const lastOutlierLog = await ovenTemperatureLogsCol.findOne(
    { oven, hasOutliers: true, outlierNotificationSent: true },
    { sort: { timestamp: -1 } }
  );
  return lastOutlierLog ? lastOutlierLog.timestamp : null;
}

// Fetch sensor data from Arduino at given IP
async function fetchSensorData(ip) {
  const url = `http://${ip}/`;
  const res = await fetch(url, {
    headers: { 'X-API-KEY': API_KEY },
    timeout: 5000,
  });
  if (!res.ok) {
    throw new Error(`Request failed with status code ${res.status}`);
  }
  return await res.json();
}

// Helper function to detect outliers and calculate statistics
function analyzeTemperatureData(sensorData) {
  // Get the four main sensors: z0, z1, z2, z3
  const sensorKeys = ['z0', 'z1', 'z2', 'z3'];
  const sensorValues = [];
  const validSensors = [];

  // Extract valid sensor readings
  for (const key of sensorKeys) {
    if (typeof sensorData[key] === 'number' && !isNaN(sensorData[key])) {
      sensorValues.push(sensorData[key]);
      validSensors.push(key);
    }
  }

  if (sensorValues.length < 2) {
    // Need at least 2 sensors for outlier detection
    return {
      validValues: sensorValues,
      validSensors,
      outlierSensors: [],
      medianTemp: sensorValues.length > 0 ? sensorValues[0] : null,
      filteredAvgTemp: sensorValues.length > 0 ? sensorValues[0] : null,
      hasOutliers: false
    };
  }

  // Calculate median
  const sortedValues = [...sensorValues].sort((a, b) => a - b);
  const median = sensorValues.length % 2 === 0
    ? (sortedValues[Math.floor(sensorValues.length / 2) - 1] + sortedValues[Math.floor(sensorValues.length / 2)]) / 2
    : sortedValues[Math.floor(sensorValues.length / 2)];

  // Identify outliers (25% deviation from median)
  const outlierThreshold = 0.25;
  const outlierSensors = [];
  const nonOutlierValues = [];
  const nonOutlierSensors = [];

  for (let i = 0; i < sensorValues.length; i++) {
    const value = sensorValues[i];
    const sensor = validSensors[i];
    const deviation = Math.abs(value - median) / median;

    if (deviation > outlierThreshold) {
      outlierSensors.push(sensor);
    } else {
      nonOutlierValues.push(value);
      nonOutlierSensors.push(sensor);
    }
  }

  // Calculate filtered average (excluding outliers) - this becomes our main avgTemp
  const avgTemp = nonOutlierValues.length > 0
    ? Math.round((nonOutlierValues.reduce((acc, val) => acc + val, 0) / nonOutlierValues.length) * 10) / 10
    : Math.round(median * 10) / 10;

  const roundedMedian = Math.round(median * 10) / 10;

  return {
    validValues: sensorValues,
    validSensors,
    outlierSensors,
    nonOutlierSensors,
    medianTemp: roundedMedian,
    avgTemp,
    hasOutliers: outlierSensors.length > 0
  };
}

// Append log entry to oven_temperature_logs collection
async function saveTemperatureLog(oven, processIds, sensorData, timestamp = new Date()) {
  const ovenTemperatureLogsCol = await dbc('oven_temperature_logs');
  const ovenProcessesCol = await dbc('oven_processes');

  // Analyze temperature data for outliers
  const analysis = analyzeTemperatureData(sensorData);

  // Check each process to see if this is its first temperature log
  for (const processId of processIds) {
    // Check if this process already has any temperature logs
    const existingLog = await ovenTemperatureLogsCol.findOne({
      processIds: processId,
    });

    if (!existingLog) {
      // This is the first temperature log for this process, update its startTime and status
      const updateResult = await ovenProcessesCol.updateOne(
        { _id: processId },
        { $set: { startTime: timestamp, status: 'running' } }
      );
      if (updateResult.modifiedCount > 0) {
        logInfo(
          `Updated process ${processId}: set startTime to ${timestamp.toISOString()} and status to 'running'`
        );
      }
    }
    // If this is not the first temperature reading, we assume the process is already running
  }

  // Save temperature log with outlier analysis
  await ovenTemperatureLogsCol.insertOne({
    oven,
    processIds,
    timestamp,
    sensorData,
    outlierSensors: analysis.outlierSensors,
    medianTemp: analysis.medianTemp,
    avgTemp: analysis.avgTemp, // This is now the filtered average (excluding outliers)
    hasOutliers: analysis.hasOutliers,
    outlierNotificationSent: false
  });

  // Return analysis for potential notification
  return analysis;
}

// Send notification when temperature outliers are detected
async function notifyTemperatureOutliers(oven, processInfo, sensorData, analysis) {
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!adminEmail) {
    logWarn('ADMIN_EMAIL is not configured - cannot send outlier notifications');
    return;
  }

  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'Europe/Warsaw',
  });

  const subject = `[CRON] Sensor outliers detected - Oven ${oven.toUpperCase()}`;

  // Create sensor readings table
  const sensorLabels = { z0: 'Top Left', z1: 'Top Right', z2: 'Bottom Left', z3: 'Bottom Right' };
  const sensorRows = Object.entries(sensorData)
    .filter(([key, value]) => ['z0', 'z1', 'z2', 'z3'].includes(key) && typeof value === 'number')
    .map(([key, value]) => {
      const isOutlier = analysis.outlierSensors.includes(key);
      const style = isOutlier ? 'background-color: #ffebee; color: #d32f2f; font-weight: bold;' : '';
      return `<tr style="${style}"><td>${sensorLabels[key] || key}</td><td>${value}°C</td><td>${isOutlier ? '⚠️ OUTLIER' : '✓ OK'}</td></tr>`;
    })
    .join('');

  const processRows = processInfo.map(proc =>
    `<tr><td>${proc.hydraBatch || 'N/A'}</td><td>${proc.article || 'N/A'}</td><td>${proc.status}</td></tr>`
  ).join('');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 800px;">
      <h2 style="color: #ff9800;">⚠️ Temperature Sensor Outliers Detected</h2>

      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0;">
        <p><strong>Oven:</strong> ${oven.toUpperCase()}</p>
        <p><strong>Time:</strong> ${timestamp}</p>
        <p><strong>Median Temperature:</strong> ${analysis.medianTemp}°C</p>
        <p><strong>Filtered Average (excluding outliers):</strong> ${analysis.avgTemp}°C</p>
      </div>

      <h3>📊 Sensor Readings</h3>
      <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
        <tr style="background-color: #e0e0e0;">
          <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Sensor</th>
          <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Temperature</th>
          <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Status</th>
        </tr>
        ${sensorRows}
      </table>

      <h3>🏭 Active Processes</h3>
      <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
        <tr style="background-color: #e0e0e0;">
          <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Hydra Batch</th>
          <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Article</th>
          <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Status</th>
        </tr>
        ${processRows}
      </table>

      <div style="background-color: #fff3e0; padding: 15px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #ff9800;">
        <p><strong>Outliers detected in sensors:</strong> ${analysis.outlierSensors.map(s => sensorLabels[s] || s).join(', ')}</p>
        <p><em>Outlier = deviation > 25% from median of all sensors</em></p>
      </div>
    </div>
  `;

  try {
    await axios.post(`${process.env.API_URL}/mailer`, {
      to: adminEmail,
      subject,
      html,
    });
    logInfo(`Outlier notification sent for oven ${oven}`);
  } catch (sendError) {
    logError(`Failed to send outlier notification for ${oven}:`, sendError.message);
  }
}

// Logging helpers to control output by environment
function logInfo(...args) {
  if (process.env.NODE_ENV === 'development') {
    console.log(...args);
  }
}
function logWarn(...args) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(...args);
  }
}
function logError(...args) {
  console.error(...args);
}

// Main function
async function logOvenTemperature() {
  try {
    const ovenMap = await getOvenConfigs();
    const activeProcesses = await getActiveOvenProcesses();
    if (activeProcesses.length === 0) {
      logInfo('No active oven processes found.');
      return;
    }
    // Group processes by oven name
    const ovenToProcesses = {};
    for (const proc of activeProcesses) {
      if (!ovenToProcesses[proc.oven]) {
        ovenToProcesses[proc.oven] = [];
      }
      ovenToProcesses[proc.oven].push(proc);
    }
    // For each oven, fetch sensor data once and log to oven_temperature_logs
    for (const [oven, processes] of Object.entries(ovenToProcesses)) {
      const ip = ovenMap[oven];
      if (!ip) {
        logWarn(`No IP configured for oven: ${oven}`);
        continue;
      }
      
      // Check if all processes for this oven are in 'prepared' status
      const hasOnlyPreparedProcesses = processes.every(proc => proc.status === 'prepared');
      
      // Check if any process has been running for less than 1 hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const hasRecentRunningProcess = processes.some(proc => {
        // Process is considered recent if:
        // 1. It's in 'running' status AND
        // 2. Either has no startTime OR startTime is within last hour
        return proc.status === 'running' && (!proc.startTime || new Date(proc.startTime) > oneHourAgo);
      });
      
      try {
        const sensorData = await fetchSensorData(ip);
        const processIds = processes.map((proc) => proc._id);
        const currentTimestamp = new Date();
        const analysis = await saveTemperatureLog(oven, processIds, sensorData, currentTimestamp);

        logInfo(
          `Logged sensor data for oven ${oven} (${ip}) to oven_temperature_logs with processIds: [${processIds.join(
            ', '
          )}]`
        );

        // Send notification if outliers detected (with 8-hour throttling)
        if (analysis.hasOutliers) {
          const lastOutlierNotificationTime = await getLastOutlierNotificationTime(oven);
          const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
          const shouldNotify = !lastOutlierNotificationTime || lastOutlierNotificationTime < eightHoursAgo;

          if (shouldNotify) {
            await notifyTemperatureOutliers(oven, processes, sensorData, analysis);

            // Mark this log as having sent a notification
            const ovenTemperatureLogsCol = await dbc('oven_temperature_logs');
            await ovenTemperatureLogsCol.updateOne(
              { oven, timestamp: currentTimestamp },
              { $set: { outlierNotificationSent: true } }
            );

            logInfo(`Outliers detected and notification sent for oven ${oven}: ${analysis.outlierSensors.join(', ')}`);
          } else {
            logInfo(`Outliers detected for oven ${oven} but notification suppressed (last sent: ${lastOutlierNotificationTime.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })})`);
          }
        }
      } catch (err) {
        // Only log error if:
        // 1. Not all processes are in 'prepared' status AND
        // 2. At least one process has been running for less than 1 hour AND
        // 3. At least 2 hours have passed since the last successful reading
        if (!hasOnlyPreparedProcesses && hasRecentRunningProcess) {
          const lastReadTime = await getLastSuccessfulReadTime(oven);
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
          const shouldNotify = !lastReadTime || lastReadTime < twoHoursAgo;
          
          if (shouldNotify) {
            const errorContext = {
              oven,
              ip,
              processIds: processes.map(p => p._id),
              processStatuses: processes.map(p => ({ 
                id: p._id, 
                status: p.status, 
                hydraBatch: p.hydraBatch,
                startTime: p.startTime 
              })),
              lastSuccessfulRead: lastReadTime,
              errorType: err.name,
              errorCode: err.code
            };
            logError(
              `Failed to fetch/log data for oven ${oven} (${ip}):`,
              err.message,
              '\nContext:', JSON.stringify(errorContext, null, 2)
            );
            // Add context to error for better notification
            err.context = errorContext;
            throw err;
          }
        }
        // Silently continue if all running processes are older than 1 hour or last read was within 2 hours
      }
    }
  } catch (err) {
    logError('Script error:', err);
    // Pass error with context to notification system
    if (!err.context) {
      err.context = { message: 'General script error in logOvenTemperature' };
    }
    throw err; // Re-throw to allow executeWithErrorNotification to handle it
  }
}

export { logOvenTemperature };

// if (require.main === module) {
//   logInfo('Starting Oven Sensor Logging Script...');
//   setInterval(
//     () => {
//       logOvenTemperature();
//     },
//     60 * 1000 // Run every 1 minute
//   ); // Run every 1 minutes
// }
