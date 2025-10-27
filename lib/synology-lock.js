import os from 'os';
import { getBackupJobsCollection } from './db.js';

const STALE_JOB_HOURS = 24;

/**
 * Check if a backup job is already running
 * @param {string} backupName - Name of the backup
 * @returns {Promise<boolean>} True if job is already running
 */
export async function isBackupRunning(backupName) {
  const collection = await getBackupJobsCollection();

  // Find the most recent job for this backup (regardless of status)
  const lastJob = await collection
    .find({ backupName })
    .sort({ startedAt: -1 })
    .limit(1)
    .toArray();

  if (lastJob.length === 0) {
    // No previous jobs - safe to run
    return false;
  }

  const job = lastJob[0];
  const jobAge = Date.now() - job.startedAt.getTime();
  const maxAge = STALE_JOB_HOURS * 60 * 60 * 1000;

  // Check if last job is older than 24h (stale)
  if (jobAge > maxAge) {
    // Mark stale job as failed
    const ageHours = (jobAge / 3600000).toFixed(1);
    console.log(`Last backup for ${backupName} is ${ageHours}h old - marking as failed`);

    await collection.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'failed',
          completedAt: job.completedAt || new Date(),
          error: `No backup execution for ${ageHours}+ hours - marked as stale`,
        },
      }
    );

    // Allow new backup to run
    return false;
  }

  // If job is running and not stale, block new execution
  if (job.status === 'running') {
    return true;
  }

  // Job completed/failed and not stale - allow new backup
  return false;
}

/**
 * Get count of active jobs per IP
 * @param {string[]} ips - Array of IP addresses
 * @returns {Promise<Map<string, number>>} Map of IP to job count
 */
async function getJobCountsPerIp(ips) {
  const collection = await getBackupJobsCollection();

  const jobCounts = new Map();
  for (const ip of ips) {
    jobCounts.set(ip, 0);
  }

  // Count running jobs per IP
  const runningJobs = await collection
    .find({
      status: 'running',
      ip: { $in: ips },
    })
    .toArray();

  for (const job of runningJobs) {
    if (jobCounts.has(job.ip)) {
      jobCounts.set(job.ip, jobCounts.get(job.ip) + 1);
    }
  }

  return jobCounts;
}

/**
 * Select least busy IP address
 * @param {string[]} ips - Array of IP addresses
 * @returns {Promise<string>} Selected IP address
 */
async function selectLeastBusyIp(ips) {
  const jobCounts = await getJobCountsPerIp(ips);

  // Find IP with minimum job count
  let selectedIp = ips[0];
  let minCount = jobCounts.get(ips[0]) || 0;

  for (const ip of ips) {
    const count = jobCounts.get(ip) || 0;
    if (count < minCount) {
      minCount = count;
      selectedIp = ip;
    }
  }

  return selectedIp;
}

/**
 * Register a backup job on an IP (non-blocking)
 * @param {string} backupName - Name of the backup
 * @param {string[]} ips - Array of IP addresses to choose from
 * @returns {Promise<string|null>} Selected IP address, or null if backup already running
 */
export async function acquireLock(backupName, ips) {
  // Check if backup is already running
  if (await isBackupRunning(backupName)) {
    console.log(`${backupName}: Already running, skipping this execution`);
    return null;
  }

  // Select least busy IP
  const selectedIp = await selectLeastBusyIp(ips);

  const jobCounts = await getJobCountsPerIp(ips);
  const statusMsg = ips.map(ip => `${ip}: ${jobCounts.get(ip) || 0} jobs`).join(', ');
  console.log(`${backupName}: Selected ${selectedIp} (Status: [${statusMsg}])`);

  // Register job in database
  const collection = await getBackupJobsCollection();
  await collection.insertOne({
    backupName,
    ip: selectedIp,
    startedAt: new Date(),
    completedAt: null,
    status: 'running',
    pid: process.pid,
    hostname: os.hostname(),
    error: null,
  });

  return selectedIp;
}

/**
 * Unregister a backup job (mark as completed)
 * @param {string} ip - IP address (not used anymore, kept for compatibility)
 * @param {string} backupName - Name of the backup
 * @param {object} result - Optional backup result data
 * @returns {Promise<void>}
 */
export async function releaseLock(ip, backupName, result = null) {
  // If only IP provided (old API), ignore
  if (!backupName) {
    return;
  }

  const collection = await getBackupJobsCollection();

  // Find the running job and mark it as completed
  const updateResult = await collection.updateOne(
    {
      backupName,
      status: 'running',
    },
    {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        result,
      },
    }
  );

  if (updateResult.modifiedCount > 0) {
    console.log(`Job completed for ${backupName}`);
  }
}

/**
 * Mark a backup job as failed
 * @param {string} backupName - Name of the backup
 * @param {Error} error - Error object
 * @returns {Promise<void>}
 */
export async function markJobAsFailed(backupName, error) {
  const collection = await getBackupJobsCollection();

  await collection.updateOne(
    {
      backupName,
      status: 'running',
    },
    {
      $set: {
        status: 'failed',
        completedAt: new Date(),
        error: error.message,
      },
    }
  );

  console.log(`Job marked as failed for ${backupName}: ${error.message}`);
}

/**
 * Cleanup stale jobs (mark as failed)
 * @returns {Promise<void>}
 */
export async function cleanupStaleLocks() {
  const collection = await getBackupJobsCollection();

  const staleThreshold = new Date(Date.now() - STALE_JOB_HOURS * 60 * 60 * 1000);

  const result = await collection.updateMany(
    {
      status: 'running',
      startedAt: { $lt: staleThreshold },
    },
    {
      $set: {
        status: 'failed',
        completedAt: new Date(),
        error: `Job exceeded ${STALE_JOB_HOURS}h maximum runtime and was marked as stale`,
      },
    }
  );

  if (result.modifiedCount > 0) {
    console.log(`Cleanup complete: marked ${result.modifiedCount} stale job(s) as failed (>${STALE_JOB_HOURS}h)`);
  }
}

/**
 * Get backup job history
 * @param {string} backupName - Optional backup name to filter
 * @param {number} limit - Number of records to return
 * @returns {Promise<Array>} Array of backup job records
 */
export async function getBackupHistory(backupName = null, limit = 100) {
  const collection = await getBackupJobsCollection();

  const query = backupName ? { backupName } : {};

  return collection
    .find(query)
    .sort({ startedAt: -1 })
    .limit(limit)
    .toArray();
}
