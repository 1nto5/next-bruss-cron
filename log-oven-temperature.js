import dotenv from 'dotenv';
import { dbc } from './lib/mongo.js';

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

// Append log entry to oven_temperature_logs collection
async function saveTemperatureLog(oven, processIds, sensorData) {
  const ovenTemperatureLogsCol = await dbc('oven_temperature_logs');
  const ovenProcessesCol = await dbc('oven_processes');
  const timestamp = new Date();

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

  await ovenTemperatureLogsCol.insertOne({
    oven,
    processIds,
    timestamp,
    sensorData,
  });
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
        await saveTemperatureLog(oven, processIds, sensorData);
        logInfo(
          `Logged sensor data for oven ${oven} (${ip}) to oven_temperature_logs with processIds: [${processIds.join(
            ', '
          )}]`
        );
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
