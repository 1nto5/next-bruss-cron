import dotenv from 'dotenv';
import { statusCollector } from './lib/status-collector.js';
import { acquireLock, releaseLock } from './lib/synology-lock.js';
import {
  connectToSourceSmb,
  connectToSynologyWithFailover,
  copyDirectoryRecursive,
  formatBytes,
} from './lib/smb-helpers.js';

dotenv.config();

/**
 * Backup LV2 Zasoby files (DB_Backup, ST61, ST151) from source to Synology
 */
export async function backupLv2() {
  const startTime = Date.now();
  let totalCopiedFiles = 0;
  let totalBytes = 0;
  let totalSkippedFiles = 0;
  const directoryStats = {};
  let usedSynologyIp = null;
  let lockedIp = null;

  try {
    console.log('Starting LV2 Zasoby backup...');

    // Get configuration from environment
    const synologyIpPrimary = process.env.SYNOLOGY_BACKUP_IP_PRIMARY;
    const synologyIpSecondary = process.env.SYNOLOGY_BACKUP_IP_SECONDARY;
    const synologyDomain = process.env.SYNOLOGY_BACKUP_DOMAIN;
    const synologyUser = process.env.SYNOLOGY_BACKUP_USER;
    const synologyPass = process.env.SYNOLOGY_BACKUP_PASS;

    const sourceIp = process.env.SMB_LV2_SOURCE_IP;
    const sourceShare = process.env.SMB_LV2_SOURCE_SHARE;
    const sourcePath = process.env.SMB_LV2_SOURCE_PATH;
    const sourceUser = process.env.SMB_LV2_SOURCE_USER;
    const sourcePass = process.env.SMB_LV2_SOURCE_PASS;

    const targetShare = process.env.SMB_LV2_TARGET_SHARE;
    const targetPath = process.env.SMB_LV2_TARGET_PATH;

    // Validate configuration
    if (!synologyIpPrimary || !synologyUser || !synologyPass) {
      throw new Error('Missing Synology configuration in environment variables');
    }
    if (!sourceIp || !sourceShare || !sourcePath || !sourceUser || !sourcePass) {
      throw new Error('Missing source configuration in environment variables');
    }
    if (!targetShare || targetPath === undefined) {
      throw new Error('Missing target configuration in environment variables');
    }

    // Build list of Synology IPs
    const synologyIps = [synologyIpPrimary];
    if (synologyIpSecondary) {
      synologyIps.push(synologyIpSecondary);
    }

    // Select least busy Synology IP (non-blocking)
    console.log(`Selecting Synology IP (available: ${synologyIps.join(', ')})...`);
    lockedIp = await acquireLock('backupLv2', synologyIps);

    // If backup already running, skip this execution
    if (!lockedIp) {
      console.log('Backup already in progress, exiting.');
      return {
        backupName: 'LV2_Zasoby',
        skipped: true,
        reason: 'Already running',
      };
    }

    console.log(`Selected IP: ${lockedIp}`);

    // Connect to source SMB (standard SMB with WORKGROUP)
    console.log(`Connecting to source: ${sourceIp}\\${sourceShare}`);
    const sourceClient = await connectToSourceSmb(
      sourceIp,
      sourceShare,
      sourceUser,
      sourcePass
    );

    // Connect to target SMB (Synology) using selected IP with failover
    console.log(`Connecting to target Synology: ${synologyIps.join(', ')} (domain: ${synologyDomain || 'WORKGROUP'})`);
    const { client: targetClient, connectedIp } = await connectToSynologyWithFailover(
      synologyIps,
      targetShare,
      synologyUser,
      synologyPass,
      synologyDomain
    );
    usedSynologyIp = connectedIp;

    // Directories to backup
    const directories = ['DB_Backup', 'ST61', 'ST151'];

    // Process each directory
    for (const dir of directories) {
      console.log(`\nProcessing directory: ${dir}`);

      const sourceDir = `${sourcePath}\\${dir}`;
      const targetDir = targetPath ? `${targetPath}\\${dir}` : dir;

      let dirCopiedFiles = 0;
      let dirSkippedFiles = 0;
      let dirBytes = 0;

      try {
        // Recursively copy directory structure
        console.log(`Copying directory recursively: ${sourceDir} -> ${targetDir}`);
        const stats = await copyDirectoryRecursive(sourceClient, targetClient, sourceDir, targetDir);

        dirCopiedFiles = stats.copiedFiles;
        dirSkippedFiles = stats.skippedFiles;
        dirBytes = stats.totalBytes;

        directoryStats[dir] = {
          copiedFiles: dirCopiedFiles,
          skippedFiles: dirSkippedFiles,
          totalFiles: dirCopiedFiles + dirSkippedFiles,
          bytes: dirBytes,
          formattedSize: formatBytes(dirBytes),
        };

        totalCopiedFiles += dirCopiedFiles;
        totalSkippedFiles += dirSkippedFiles;
        totalBytes += dirBytes;

        console.log(`${dir} -> Copied: ${dirCopiedFiles}, Skipped: ${dirSkippedFiles}, Size: ${formatBytes(dirBytes)}`);

      } catch (dirError) {
        console.error(`Error processing directory ${dir}:`, dirError.message);
        directoryStats[dir] = {
          copiedFiles: 0,
          skippedFiles: 0,
          totalFiles: 0,
          bytes: 0,
          formattedSize: '0 B',
          error: dirError.message,
        };
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    const result = {
      backupName: 'LV2_Zasoby',
      copiedFiles: totalCopiedFiles,
      skippedFiles: totalSkippedFiles,
      totalFiles: totalCopiedFiles + totalSkippedFiles,
      totalBytes,
      formattedSize: formatBytes(totalBytes),
      duration: `${duration}s`,
      synologyIp: usedSynologyIp,
      directoryStats,
    };

    console.log(
      `\nbackupLv2 -> success at ${new Date().toLocaleString()} | ` +
      `Total Copied: ${totalCopiedFiles}, Total Skipped: ${totalSkippedFiles}, ` +
      `Size: ${formatBytes(totalBytes)}, Duration: ${duration}s, Synology: ${usedSynologyIp}`
    );

    // Report to status collector
    statusCollector.addSuccess('backupLv2', result);

    return result;

  } catch (error) {
    console.error('Error in backupLv2:', error);
    throw error;
  } finally {
    // Always release job registration
    if (lockedIp) {
      await releaseLock(lockedIp, 'backupLv2');
    }
  }
}
