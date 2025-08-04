# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js cron job scheduler for the next-bruss application, handling automated tasks for a manufacturing company including quality management, production oversight, HR operations, and industrial IoT data collection.

## Development Commands

```bash
# Install dependencies (using Bun)
bun install

# Run the application
node index.js

# Check MongoDB connection
node -e "import('./lib/mongo.js').then(m => m.getDb().then(() => console.log('Connected')))"
```

## Architecture

### Core Structure
- **Entry Point**: `index.js` - Orchestrates all cron jobs using node-cron
- **Database**: MongoDB via `lib/mongo.js` (handles dev/prod connection patterns)
- **External Systems**: LDAP, MS SQL Server (R2platnik), Arduino controllers

### Cron Job Categories
1. **Deviations**: Approval reminders and status updates
2. **Production**: Overtime and attendance notifications  
3. **HR Training**: Evaluation notifications from Excel files
4. **Data Sync**: LDAP users and R2platnik employees
5. **IoT**: Oven sensor logging (runs every minute)
6. **Maintenance**: Weekly scan archiving

### Key Patterns
- All jobs use try-catch with detailed error logging
- Notifications sent via external mailer API at `$API_URL/v1/mailer/send`
- Batch processing for large datasets (10,000 records)
- Polish language support with character normalization

### Environment Variables
Required in `.env`:
- `MONGO_URI` - MongoDB connection
- `LDAP`, `LDAP_DN`, `LDAP_PASS`, `LDAP_BASE_DN` - LDAP config
- `R2PLATNIK_SQL_*` - MS SQL Server details
- `CONTROLLINO_API_KEY` - Arduino authentication
- `API_URL`, `APP_URL` - Application endpoints
- HR training Excel file paths

### Database Collections
- `deviations`, `deviations_reminders`
- `production_overtime_requests`, `production_tasks`
- `hr_training_trainings`, `hr_training_evaluations`
- `users`, `r2platnik_employees`
- `production_ovens`, `production_oven_sensor_logs`
- `scans`, `archive_scans`

## Important Considerations

1. **No Test Suite**: Currently no testing framework configured
2. **Manual Execution**: No npm scripts defined - jobs run via direct node execution
3. **Production Critical**: Handles real-time industrial processes and employee data
4. **Timing Sensitive**: Many jobs run at specific times (3 AM, 4 PM) for business reasons
5. **External Dependencies**: Relies on external APIs and databases that may be unavailable