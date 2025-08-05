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
async function logOvenTemperature(oven, processIds, sensorData) {
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
async function logOvenSensors() {
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
      try {
        const sensorData = await fetchSensorData(ip);
        const processIds = processes.map((proc) => proc._id);
        await logOvenTemperature(oven, processIds, sensorData);
        logInfo(
          `Logged sensor data for oven ${oven} (${ip}) to oven_temperature_logs with processIds: [${processIds.join(
            ', '
          )}]`
        );
      } catch (err) {
        logError(
          `Failed to fetch/log data for oven ${oven} (${ip}):`,
          err.message
        );
      }
    }
  } catch (err) {
    logError('Script error:', err);
    // Do not exit process when used as a cron job
  }
}

export { logOvenSensors };

// if (require.main === module) {
//   logInfo('Starting Oven Sensor Logging Script...');
//   setInterval(
//     () => {
//       logOvenSensors();
//     },
//     60 * 1000 // Run every 1 minute
//   ); // Run every 1 minutes
// }
