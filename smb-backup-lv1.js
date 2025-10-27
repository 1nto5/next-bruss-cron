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
 * Backup LV1 MVC_Pictures from source to Synology
 */
export async function backupLv1() {
  const startTime = Date.now();
  let totalCopiedFiles = 0;
  let totalBytes = 0;
  let totalSkippedFiles = 0;
  let usedSynologyIp = null;
  let lockedIp = null;

  try {
    console.log('Starting LV1 MVC_Pictures backup...');

    // Get configuration from environment
    const synologyIpPrimary = process.env.SYNOLOGY_BACKUP_IP_PRIMARY;
    const synologyIpSecondary = process.env.SYNOLOGY_BACKUP_IP_SECONDARY;
    const synologyDomain = process.env.SYNOLOGY_BACKUP_DOMAIN;
    const synologyUser = process.env.SYNOLOGY_BACKUP_USER;
    const synologyPass = process.env.SYNOLOGY_BACKUP_PASS;

    const sourceIp = process.env.SMB_LV1_SOURCE_IP;
    const sourceShare = process.env.SMB_LV1_SOURCE_SHARE;
    const sourceUser = process.env.SMB_LV1_SOURCE_USER;
    const sourcePass = process.env.SMB_LV1_SOURCE_PASS;

    const targetShare = process.env.SMB_LV1_TARGET_SHARE;
    const targetPath = process.env.SMB_LV1_TARGET_PATH;

    // Validate configuration
    if (!synologyIpPrimary || !synologyUser || !synologyPass) {
      throw new Error('Missing Synology configuration in environment variables');
    }
    if (!sourceIp || !sourceShare || !sourceUser || !sourcePass) {
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
    lockedIp = await acquireLock('backupLv1', synologyIps);

    // If backup already running, skip this execution
    if (!lockedIp) {
      console.log('Backup already in progress, exiting.');
      return {
        backupName: 'LV1_MVC_Pictures',
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

    // Recursively copy directory structure from source root
    console.log(`Copying directory recursively: root -> ${targetPath || 'root'}`);
    const stats = await copyDirectoryRecursive(sourceClient, targetClient, '', targetPath || '');

    totalCopiedFiles = stats.copiedFiles;
    totalSkippedFiles = stats.skippedFiles;
    totalBytes = stats.totalBytes;

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    const result = {
      backupName: 'LV1_MVC_Pictures',
      copiedFiles: totalCopiedFiles,
      skippedFiles: totalSkippedFiles,
      totalFiles: totalCopiedFiles + totalSkippedFiles,
      totalBytes,
      formattedSize: formatBytes(totalBytes),
      duration: `${duration}s`,
      synologyIp: usedSynologyIp,
    };

    console.log(
      `\nbackupLv1 -> success at ${new Date().toLocaleString()} | ` +
      `Total Copied: ${totalCopiedFiles}, Total Skipped: ${totalSkippedFiles}, ` +
      `Size: ${formatBytes(totalBytes)}, Duration: ${duration}s, Synology: ${usedSynologyIp}`
    );

    // Report to status collector
    statusCollector.addSuccess('backupLv1', result);

    return result;

  } catch (error) {
    console.error('Error in backupLv1:', error);
    throw error;
  } finally {
    // Always release job registration
    if (lockedIp) {
      await releaseLock(lockedIp, 'backupLv1');
    }
  }
}
