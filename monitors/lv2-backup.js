import dotenv from 'dotenv';
import { connectToSynologyWithFailover } from '../lib/smb-helpers.js';
import { statusCollector } from '../lib/status-collector.js';

dotenv.config();

/**
 * Monitor LV2 Zasoby backup executed by Synology rsync script
 * This function checks if the backup is running correctly by reading
 * the status JSON file created by the bash backup script
 */
export async function monitorLv2Backup() {
  const startTime = Date.now();

  try {
    // Get configuration from environment
    const synologyIp = process.env.SYNOLOGY_IP;
    const synologyUser = process.env.SYNOLOGY_BACKUP_USER;
    const synologyPass = process.env.SYNOLOGY_BACKUP_PASS;

    const monitorPath = process.env.SMB_LV2_MONITOR_PATH;
    const staleThresholdHours = parseInt(
      process.env.SMB_STALE_THRESHOLD_HOURS || '24'
    );

    // Validate configuration
    if (!synologyIp || !synologyUser || !synologyPass) {
      throw new Error(
        'Missing Synology configuration in environment variables'
      );
    }
    if (!monitorPath) {
      throw new Error(
        'Missing LV2 monitoring configuration in environment variables'
      );
    }

    // Parse share and path from monitorPath (format: "share/path")
    const [monitorShare, ...pathParts] = monitorPath.split('/');
    const monitorSubPath = pathParts.join('/');

    // Connect to Synology
    const { client: smbClient, connectedIp } =
      await connectToSynologyWithFailover(
        [synologyIp],
        monitorShare,
        synologyUser,
        synologyPass,
        undefined
      );

    // Read the status JSON file
    const statusFilePath = `${monitorSubPath}\\last_backup_status.json`;

    const statusJson = await new Promise((resolve, reject) => {
      smbClient.readFile(statusFilePath, (err, content) => {
        if (err) {
          reject(new Error(`Failed to read status file: ${err.message}`));
        } else {
          try {
            const jsonData = JSON.parse(content.toString('utf8'));
            resolve(jsonData);
          } catch (parseErr) {
            reject(
              new Error(`Failed to parse status JSON: ${parseErr.message}`)
            );
          }
        }
      });
    });

    // Check if backup is stale
    const lastBackupTime = new Date(
      statusJson.timestampIso || statusJson.timestamp
    );
    const nowTime = new Date();
    const hoursSinceBackup = (nowTime - lastBackupTime) / (1000 * 60 * 60);

    if (hoursSinceBackup > staleThresholdHours) {
      throw new Error(
        `Backup is stale! Last backup was ${hoursSinceBackup.toFixed(
          1
        )} hours ago ` +
          `(threshold: ${staleThresholdHours} hours). Last backup: ${statusJson.timestamp}`
      );
    }

    // Check if backup status indicates failure
    if (statusJson.exitCode !== 0) {
      const errorMsg =
        statusJson.errors && statusJson.errors.length > 0
          ? statusJson.errors.join('; ')
          : 'Unknown error';
      throw new Error(
        `Last backup failed with exit code: ${statusJson.exitCode}. Error: ${errorMsg}`
      );
    }

    // Build result object
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    const result = {
      backupName: 'LV2',
      lastBackupTime: statusJson.timestamp,
      lastBackupExitCode: statusJson.exitCode,
      lastBackupDuration: statusJson.duration,
      hoursSinceBackup: hoursSinceBackup.toFixed(1),
      monitorDuration: `${duration}s`,
      synologyIp: connectedIp,
      copiedFiles: statusJson.copiedFiles || 0,
      skippedFiles: statusJson.skippedFiles || 0,
      totalFiles: statusJson.totalFiles || 0,
      formattedSize: statusJson.totalSize || '0 B',
      totalBytes: 0, // Would need parsing from totalSize string
      successfulDirs: statusJson.successfulDirs || 0,
      failedDirs: statusJson.failedDirs || 0,
    };

    // Report to status collector
    statusCollector.addSuccess('monitorLv2Backup', result);

    return result;
  } catch (error) {
    console.error('Error in monitorLv2Backup:', error);
    throw error;
  }
}
