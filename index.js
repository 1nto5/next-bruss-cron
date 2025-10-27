import dotenv from 'dotenv';
import cron from 'node-cron';
import { archiveScans } from './archive-scans.js';
import { sendDeviationApprovalReminders } from './deviations-send-reminders.js';
import { deviationsStatusUpdate } from './deviations-status-update.js';
import { sendHrTrainingEvaluationNotifications } from './hr-training-evaluation-notifications.js';
import { logOvenTemperature } from './log-oven-temperature.js';
import {
  sendCompletedTaskAttendanceReminders,
  sendOvertimeApprovalReminders,
} from './production-overtime-send-reminders.js';
import { syncLdapUsers } from './sync-ldap-users.js';
import { syncR2platnikEmployees } from './sync-r2platnik-employees.js';
import { backupLv1 } from './smb-backup-lv1.js';
import { backupLv2 } from './smb-backup-lv2.js';
import { executeJobWithStatusTracking } from './lib/error-notifier.js';
import { setupHealthCheck } from './lib/health-check.js';
import { errorCollector } from './lib/error-collector.js';
import { statusCollector } from './lib/status-collector.js';
import { cleanupStaleLocks } from './lib/synology-lock.js';

dotenv.config();

// Setup health check server
setupHealthCheck();

// Deviations tasks
// -----------------------
// Schedule sending of pending deviation approval notifications every workday at 03:00
cron.schedule('0 3 * * 1-5', async () => {
  await executeJobWithStatusTracking('sendDeviationApprovalReminders', sendDeviationApprovalReminders);
}, {});
// Schedule deviations status update every 2 hours
cron.schedule('0 */2 * * *', async () => {
  await executeJobWithStatusTracking('deviationsStatusUpdate', deviationsStatusUpdate);
}, {});

// Production overtime tasks
// -------------------------------
// Schedule sending of pending production overtime email notifications every workday at 3:00
cron.schedule('0 3 * * 1-5', async () => {
  await executeJobWithStatusTracking('sendOvertimeApprovalReminders', sendOvertimeApprovalReminders);
});
// Schedule sending of completed task attendance reminders every workday at 9:00
cron.schedule('0 9 * * 1-5', async () => {
  await executeJobWithStatusTracking('sendCompletedTaskAttendanceReminders', sendCompletedTaskAttendanceReminders);
});

// HR Training Evaluation Notifications
// ------------------------------------
// Schedule HR training evaluation deadline notifications every workday at 3:00
cron.schedule('0 3 * * 1-5', async () => {
  await executeJobWithStatusTracking('sendHrTrainingEvaluationNotifications', sendHrTrainingEvaluationNotifications);
});

// Data synchronization tasks
// --------------------------
// Schedule synchronization of r2platnik employees at 16:00 every workday
cron.schedule('0 16 * * 1-5', async () => {
  await executeJobWithStatusTracking('syncR2platnikEmployees', syncR2platnikEmployees);
});
// Schedule synchronization of LDAP users every workday at 16:00
cron.schedule('0 16 * * 1-5', async () => {
  await executeJobWithStatusTracking('syncLdapUsers', syncLdapUsers);
});

// Backup tasks
// ------------
// Schedule LV1 MVC_Pictures backup every hour at minute 0
cron.schedule('0 * * * *', async () => {
  await executeJobWithStatusTracking('backupLv1', backupLv1);
});

// Schedule LV2 Zasoby backup every hour at minute 30 (staggered 30 minutes after LV1)
cron.schedule('30 * * * *', async () => {
  await executeJobWithStatusTracking('backupLv2', backupLv2);
});

// Schedule cleanup of stale Synology locks every hour at minute 45
cron.schedule('45 * * * *', async () => {
  await cleanupStaleLocks();
});

// Maintenance tasks
// ----------------
// Schedule archiving of scans every Sunday at 22:00
cron.schedule('0 22 * * 0', async () => {
  await executeJobWithStatusTracking('archiveScans', archiveScans);
});

// Schedule logging of oven sensors every 1 minute
cron.schedule('* * * * *', async () => {
  await executeJobWithStatusTracking('logOvenTemperature', logOvenTemperature);
});

// Error reporting tasks
// ---------------------
// Schedule batch error notification every hour at minute 0
cron.schedule('0 * * * *', async () => {
  await errorCollector.sendBatchNotification();
});

// Status reporting tasks
// ----------------------
// Schedule daily status summary at 8:00 AM every day
cron.schedule('0 8 * * *', async () => {
  await statusCollector.sendStatusSummary(24, true); // 24 hours, force even if empty
});
