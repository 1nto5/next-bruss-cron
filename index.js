import dotenv from 'dotenv';
import cron from 'node-cron';
import { archiveScans } from './archive-scans.js';
import { sendDeviationApprovalReminders } from './deviations/send-reminders.js';
import { deviationsStatusUpdate } from './deviations/status-update.js';
import { sendHrTrainingEvaluationNotifications } from './hr-training/evaluation-notifications.js';
import { errorCollector } from './lib/error-collector.js';
import { executeJobWithStatusTracking } from './lib/error-notifier.js';
import { statusCollector } from './lib/status-collector.js';
import { temperatureOutlierCollector } from './lib/temperature-outlier-collector.js';
import { temperatureMissingSensorCollector } from './lib/temperature-missing-sensor-collector.js';
import { logOvenTemperature } from './log-oven-temperature.js';
import { monitorEOL308Backup } from './monitors/eol308-backup.js';
import { monitorLv1Backup } from './monitors/lv1-backup.js';
import { monitorLv2Backup } from './monitors/lv2-backup.js';
import { monitorPm2ErrorLogs } from './monitors/pm2-error-logs.js';
import { monitorSqlLv1Backup } from './monitors/sql-lv1-backup.js';
import { monitorSqlLv2Backup } from './monitors/sql-lv2-backup.js';
import {
  sendCompletedTaskAttendanceReminders,
  sendOvertimeApprovalReminders,
} from './production-overtime/send-reminders.js';
import { syncLdapUsers } from './sync/ldap-users.js';
import { syncR2platnikEmployees } from './sync/r2platnik-employees.js';

dotenv.config();

// Deviations tasks
// -----------------------
// Schedule sending of pending deviation approval notifications every workday at 03:00
cron.schedule(
  '0 3 * * 1-5',
  async () => {
    await executeJobWithStatusTracking(
      'sendDeviationApprovalReminders',
      sendDeviationApprovalReminders
    );
  },
  {}
);
// Schedule deviations status update every 2 hours
cron.schedule(
  '0 */2 * * *',
  async () => {
    await executeJobWithStatusTracking(
      'deviationsStatusUpdate',
      deviationsStatusUpdate
    );
  },
  {}
);

// Production overtime tasks
// -------------------------------
// Schedule sending of pending production overtime email notifications every workday at 3:00
cron.schedule('0 3 * * 1-5', async () => {
  await executeJobWithStatusTracking(
    'sendOvertimeApprovalReminders',
    sendOvertimeApprovalReminders
  );
});
// Schedule sending of completed task attendance reminders every workday at 9:00
cron.schedule('0 9 * * 1-5', async () => {
  await executeJobWithStatusTracking(
    'sendCompletedTaskAttendanceReminders',
    sendCompletedTaskAttendanceReminders
  );
});

// HR Training Evaluation Notifications
// ------------------------------------
// Schedule HR training evaluation deadline notifications every workday at 3:00
cron.schedule('0 3 * * 1-5', async () => {
  await executeJobWithStatusTracking(
    'sendHrTrainingEvaluationNotifications',
    sendHrTrainingEvaluationNotifications
  );
});

// Data synchronization tasks
// --------------------------
// Schedule synchronization of r2platnik employees at 16:00 every workday
cron.schedule('0 16 * * 1-5', async () => {
  await executeJobWithStatusTracking(
    'syncR2platnikEmployees',
    syncR2platnikEmployees
  );
});
// Schedule synchronization of LDAP users every workday at 16:00
cron.schedule('0 16 * * 1-5', async () => {
  await executeJobWithStatusTracking('syncLdapUsers', syncLdapUsers);
});

// PM2 Error Log Monitoring
// ------------------------
// Monitor PM2 error logs every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  await executeJobWithStatusTracking('monitorPm2ErrorLogs', monitorPm2ErrorLogs);
});

// Backup Monitoring tasks
// -----------------------
// Monitor LV1 MVC_Pictures backup daily at 07:00 (before daily summary at 08:00)
cron.schedule('0 7 * * *', async () => {
  await executeJobWithStatusTracking('monitorLv1Backup', monitorLv1Backup);
});

// Monitor LV2 Zasoby backup daily at 07:00 (before daily summary at 08:00)
cron.schedule('0 7 * * *', async () => {
  await executeJobWithStatusTracking('monitorLv2Backup', monitorLv2Backup);
});

// Monitor LV1 SQL backup daily at 07:00 (before daily summary at 08:00)
cron.schedule('0 7 * * *', async () => {
  await executeJobWithStatusTracking('monitorSqlLv1Backup', monitorSqlLv1Backup);
});

// Monitor LV2 SQL backup daily at 07:00 (before daily summary at 08:00)
cron.schedule('0 7 * * *', async () => {
  await executeJobWithStatusTracking('monitorSqlLv2Backup', monitorSqlLv2Backup);
});

// Monitor EOL308 backup daily at 07:00 (before daily summary at 08:00)
cron.schedule('0 7 * * *', async () => {
  await executeJobWithStatusTracking(
    'monitorEOL308Backup',
    monitorEOL308Backup
  );
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

// Schedule batch temperature outlier notification every hour at minute 0
cron.schedule('0 * * * *', async () => {
  await temperatureOutlierCollector.sendBatchNotification();
});

// Schedule batch missing sensor notification every hour at minute 0
cron.schedule('0 * * * *', async () => {
  await temperatureMissingSensorCollector.sendBatchNotification();
});

// Status reporting tasks
// ----------------------
// Schedule daily status summary at 8:00 AM every day
// Includes all executions since the last summary was sent
cron.schedule('0 8 * * *', async () => {
  await statusCollector.sendStatusSummary();
});
