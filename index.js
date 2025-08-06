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
import { executeWithErrorNotification } from './lib/error-notifier.js';
import { setupHealthCheck, updateCronExecution } from './lib/health-check.js';

dotenv.config();

// Setup health check server
setupHealthCheck();

// Deviations tasks
// -----------------------
// Schedule sending of pending deviation approval notifications every workday at 03:00
cron.schedule('0 3 * * 1-5', async () => {
  await executeWithErrorNotification('sendDeviationApprovalReminders', sendDeviationApprovalReminders);
  updateCronExecution('sendDeviationApprovalReminders');
}, {});
// Schedule deviations status update every 2 hours
cron.schedule('0 */2 * * *', async () => {
  await executeWithErrorNotification('deviationsStatusUpdate', deviationsStatusUpdate);
  updateCronExecution('deviationsStatusUpdate');
}, {});

// Production overtime tasks
// -------------------------------
// Schedule sending of pending production overtime email notifications every workday at 3:00
cron.schedule('0 3 * * 1-5', async () => {
  await executeWithErrorNotification('sendOvertimeApprovalReminders', sendOvertimeApprovalReminders);
  updateCronExecution('sendOvertimeApprovalReminders');
});
// Schedule sending of completed task attendance reminders every workday at 9:00
cron.schedule('0 9 * * 1-5', async () => {
  await executeWithErrorNotification('sendCompletedTaskAttendanceReminders', sendCompletedTaskAttendanceReminders);
  updateCronExecution('sendCompletedTaskAttendanceReminders');
});

// HR Training Evaluation Notifications
// ------------------------------------
// Schedule HR training evaluation deadline notifications every workday at 3:00
cron.schedule('0 3 * * 1-5', async () => {
  await executeWithErrorNotification('sendHrTrainingEvaluationNotifications', sendHrTrainingEvaluationNotifications);
  updateCronExecution('sendHrTrainingEvaluationNotifications');
});

// Data synchronization tasks
// --------------------------
// Schedule synchronization of r2platnik employees at 16:00 every workday
cron.schedule('0 16 * * 1-5', async () => {
  await executeWithErrorNotification('syncR2platnikEmployees', syncR2platnikEmployees);
  updateCronExecution('syncR2platnikEmployees');
});
// Schedule synchronization of LDAP users every workday at 16:00
cron.schedule('0 16 * * 1-5', async () => {
  await executeWithErrorNotification('syncLdapUsers', syncLdapUsers);
  updateCronExecution('syncLdapUsers');
});

// Maintenance tasks
// ----------------
// Schedule archiving of scans every Sunday at 22:00
cron.schedule('0 22 * * 0', async () => {
  await executeWithErrorNotification('archiveScans', archiveScans);
  updateCronExecution('archiveScans');
});

// Schedule logging of oven sensors every 1 minute
cron.schedule('* * * * *', async () => {
  await executeWithErrorNotification('logOvenTemperature', logOvenTemperature);
  updateCronExecution('logOvenTemperature');
});
