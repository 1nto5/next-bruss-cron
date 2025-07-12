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
  const ovenConfigsCol = await dbc('oven_configs');
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

// Helper to get all running oven processes
async function getRunningOvenProcesses() {
  const ovenProcessesCol = await dbc('oven_processes');
  return ovenProcessesCol.find({ status: 'running' }).toArray();
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

// Append log entry to oven_processes document
async function appendLogToProcess(_id, logEntry) {
  const ovenProcessesCol = await dbc('oven_processes');
  await ovenProcessesCol.updateOne(
    { _id },
    {
      $push: { temperatureLogs: logEntry },
      $set: { updatedAt: new Date() },
    }
  );
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
    const runningProcesses = await getRunningOvenProcesses();
    if (runningProcesses.length === 0) {
      logInfo('No running oven processes found.');
      return;
    }
    // Group processes by oven name
    const ovenToProcesses = {};
    for (const proc of runningProcesses) {
      if (!ovenToProcesses[proc.oven]) {
        ovenToProcesses[proc.oven] = [];
      }
      ovenToProcesses[proc.oven].push(proc);
    }
    // For each oven, fetch sensor data once and append to all processes
    for (const [oven, processes] of Object.entries(ovenToProcesses)) {
      const ip = ovenMap[oven];
      if (!ip) {
        logWarn(`No IP configured for oven: ${oven}`);
        continue;
      }
      try {
        const sensorData = await fetchSensorData(ip);
        const logEntry = {
          timestamp: new Date(),
          sensorData,
        };
        for (const proc of processes) {
          await appendLogToProcess(proc._id, logEntry);
        }
        logInfo(
          `Logged sensor data for oven ${oven} (${ip}) to ${processes.length} process(es)`
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

if (require.main === module) {
  logInfo('Starting Oven Sensor Logging Script...');
  logOvenSensors();
}
