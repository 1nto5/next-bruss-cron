# next-bruss-cron

Cron jobs scheduler for the Next-Bruss manufacturing application, handling automated tasks for quality management, production oversight, HR operations, and industrial IoT data collection.

## Overview

This Node.js application orchestrates automated background tasks for a manufacturing company, including:
- Deviation approval reminders and status updates
- Production overtime notifications
- HR training evaluation notifications
- Data synchronization (LDAP users, R2platnik employees)
- Industrial IoT sensor logging
- Maintenance tasks (scan archiving)

## Architecture

### Core Components
- **Entry Point**: `index.js` - Orchestrates all cron jobs using node-cron
- **Database**: MongoDB for data persistence
- **Error Handling**: Automatic admin notifications for failed jobs
- **External Integrations**: LDAP, MS SQL Server (R2platnik), Arduino controllers

### Job Categories

#### Deviations Management
- `sendDeviationApprovalReminders()` - Sends reminders for pending deviation approvals (daily at 3 AM)
- `deviationsStatusUpdate()` - Updates deviation statuses based on time periods (every 2 hours)

#### Production Overtime
- `sendOvertimeApprovalReminders()` - Notifies managers about pending overtime requests (daily at 3 AM)
- `sendCompletedTaskAttendanceReminders()` - Reminds about attendance list updates (daily at 9 AM)

#### HR Training
- `sendHrTrainingEvaluationNotifications()` - Sends deadline notifications for training evaluations (daily at 3 AM)

#### Data Synchronization
- `syncLdapUsers()` - Synchronizes LDAP directory users (daily at 4 PM)
- `syncR2platnikEmployees()` - Synchronizes R2platnik employee data (daily at 4 PM)

#### IoT & Monitoring
- `logOvenTemperature()` - Logs industrial oven sensor data (every minute)

#### Maintenance
- `archiveScans()` - Archives old scan records (weekly on Sundays at 10 PM)

## Installation

```bash
# Install dependencies using Bun
bun install
```

## Configuration

### Required Environment Variables

Create a `.env` file with the following variables:

```env
# MongoDB Configuration
MONGO_URI=mongodb://localhost:27017/next-bruss

# LDAP Configuration
LDAP=ldap://your-ldap-server
LDAP_DN=cn=admin,dc=example,dc=com
LDAP_PASS=your-ldap-password
LDAP_BASE_DN=dc=example,dc=com

# MS SQL Server Configuration (R2platnik)
R2PLATNIK_SQL_HOST=your-sql-server
R2PLATNIK_SQL_DATABASE=your-database
R2PLATNIK_SQL_USERNAME=your-username
R2PLATNIK_SQL_PASSWORD=your-password

# Arduino Controller Configuration
CONTROLLINO_API_KEY=your-controllino-api-key

# Application URLs
API_URL=http://localhost:3000/api
APP_URL=http://localhost:3000

# HR Training Excel Configuration
HR_TRAINING_EXCEL_PATH=/path/to/hr/training/file.xlsx

# Email Configuration
ADMIN_EMAIL=admin@example.com  # Receives error notifications
HR_EMAIL=hr@example.com        # Receives HR-related notifications

# Health Check Configuration (Optional)
HEALTH_CHECK_ENABLED=true      # Enable health check server
HEALTH_CHECK_PORT=3001         # Port for health check endpoints
HEALTH_CHECK_AUTH_TOKEN=secret # Optional token for detailed endpoint
```

## Running the Application

```bash
# Start the cron scheduler
node index.js

# Test MongoDB connection
node -e "import('./lib/mongo.js').then(m => m.getDb().then(() => console.log('Connected')))"
```

## Health Monitoring

### Health Check Endpoints

The application provides health check endpoints for monitoring:

- `http://localhost:3001/health` - Basic health status (JSON)
- `http://localhost:3001/health/detailed` - Detailed status with all components (requires auth token)
- `http://localhost:3001/health/zabbix` - Zabbix-compatible numeric status (1=healthy, 0=unhealthy)
- `http://localhost:3001/health/zabbix/[component]` - Component-specific status (mongodb, ldap, r2platnik)

### Monitoring Setup

- **Zabbix Integration**: Ready-to-use template in `docs/zabbix-template.xml`
- **Setup Guide**: Detailed instructions in `docs/zabbix-setup.md`
- **Components Monitored**: MongoDB, LDAP, R2platnik SQL, Application uptime
- **Alerts**: Configurable triggers for different severity levels

## Error Handling

All cron jobs are wrapped with automatic error notification. When a job fails:
1. The error is logged to console
2. An email notification is sent to `ADMIN_EMAIL`
3. The notification includes:
   - Job name and timestamp
   - Error message and stack trace
   - Any relevant context

## Database Collections

The application interacts with the following MongoDB collections:
- `deviations`, `deviations_reminders` - Deviation management
- `production_overtime`, `production_tasks` - Overtime tracking
- `hr_training_trainings`, `hr_training_evaluations` - Training records
- `users`, `r2platnik_employees` - User management
- `oven_controllino_configs`, `oven_processes`, `oven_temperature_logs` - IoT data
- `scans`, `archive_scans` - Document scanning

## Key Features

### Polish Language Support
- Full Polish language support in notifications
- Character normalization for Polish special characters

### Batch Processing
- Efficient handling of large datasets (10,000+ records)
- Optimized for production environments

### Security
- Environment-based configuration
- Secure API key management
- Role-based access control integration

## Development Notes

### Important Considerations
1. **Production Critical**: Handles real-time industrial processes and employee data
2. **Timing Sensitive**: Jobs run at specific times for business reasons
3. **External Dependencies**: Relies on external APIs and databases
4. **No Test Suite**: Currently no automated testing framework

### File Structure
```
/
├── index.js                                    # Main scheduler
├── lib/
│   ├── mongo.js                               # MongoDB connection
│   ├── name-format.js                         # Name formatting utilities
│   └── error-notifier.js                      # Error notification system
├── deviations-send-reminders.js               # Deviation reminders
├── deviations-status-update.js                # Deviation status updates
├── production-overtime-send-reminders.js      # Overtime notifications
├── hr-training-evaluation-notifications.js    # HR training notifications
├── sync-ldap-users.js                        # LDAP synchronization
├── sync-r2platnik-employees.js               # R2platnik sync
├── log-oven-temperature.js                   # IoT sensor logging
└── archive-scans.js                          # Scan archiving
```

## Support

For issues or questions, check the logs or contact the system administrator configured in `ADMIN_EMAIL`.