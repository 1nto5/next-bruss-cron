# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Node.js cron job scheduler for a Polish manufacturing company (Next-Bruss), orchestrating automated tasks for quality management, production oversight, HR operations, and industrial IoT data collection.

## Development Commands

```bash
# Install dependencies (using Bun)
bun install

# Run the application
node index.js

# Check MongoDB connection
node -e "import('./lib/mongo.js').then(m => m.getDb().then(() => console.log('Connected')))"

# Run health check server (for monitoring)
node lib/health-check.js
```

## Architecture

### Core Structure
- **Entry Point**: `index.js` - Orchestrates all cron jobs using node-cron
- **Database**: MongoDB via `lib/mongo.js` (handles dev/prod connection patterns with global client caching)
- **Error Handling**: Dual system with immediate notifications (`lib/error-notifier.js`) and hourly batch reporting (`lib/error-collector.js`)
- **Health Monitoring**: Express server on port 3001 with Zabbix-compatible endpoints

### Cron Job Schedule
- **Daily 3 AM (Mon-Fri)**: Deviation reminders, overtime reminders, HR training notifications
- **Every 2 hours**: Deviation status updates
- **Daily 9 AM (Mon-Fri)**: Task attendance reminders
- **Daily 4 PM (Mon-Fri)**: LDAP and R2platnik employee synchronization
- **Every minute**: Oven temperature logging from Arduino controllers
- **Weekly Sunday 10 PM**: Archive old scans
- **Hourly**: Batch error notification reports

### External Integrations
- **LDAP**: User synchronization with Polish users filter `(&(mail=*)(c=PL))`
- **MS SQL Server**: R2platnik employee data via `mssql` library
- **Arduino Controllers**: Industrial oven monitoring via HTTP API
- **Mailer API**: External service at `$API_URL/mailer` for notifications

### Key Patterns

#### Job Structure Template
```javascript
async function jobName() {
  try {
    let processedItems = 0;
    let actionsTaken = 0;
    
    // Business logic here
    
    console.log(`jobName -> success at ${new Date().toLocaleString()} | Processed: ${processedItems}, Actions: ${actionsTaken}`);
  } catch (error) {
    console.error('Error in jobName:', error);
    throw error; // Re-throw for executeWithErrorNotification wrapper
  }
}
```

#### Error Handling
- Always use `executeWithErrorNotification('jobName', jobFunction)` wrapper for new jobs
- Errors are collected for batch reporting and sent individually for critical failures
- Maximum 1000 errors stored in memory before automatic flush

#### Batch Processing
- Process large datasets in 10,000 record batches
- Use cursor iteration for memory efficiency
- Handle duplicate key errors gracefully in archive operations

### Database Collections
- **Quality**: `deviations`, `deviations_reminders`
- **Production**: `production_overtime`, `production_tasks`, `oven_processes`, `oven_temperature_logs`
- **HR**: `hr_training_trainings`, `hr_training_evaluations`
- **Users**: `users`, `r2platnik_employees`
- **IoT**: `oven_controllino_configs`, `production_ovens`, `production_oven_sensor_logs`
- **Archiving**: `scans`, `scans_archive`

### Environment Variables
Required in `.env`:
- `MONGO_URI` - MongoDB connection string
- `LDAP`, `LDAP_DN`, `LDAP_PASS`, `LDAP_BASE_DN` - LDAP configuration
- `R2PLATNIK_SQL_*` - MS SQL Server connection details
- `CONTROLLINO_API_KEY` - Arduino authentication
- `API_URL`, `APP_URL` - Application endpoints
- `ADMIN_EMAIL`, `HR_EMAIL` - Notification recipients
- `HR_TRAINING_EXCEL_PATH` - Path to HR training Excel files

## Important Considerations

1. **Polish Language**: All user-facing messages must be in Polish with proper character encoding
2. **Timezone**: Use `Europe/Warsaw` for all date/time operations
3. **Production Critical**: Handles real-time industrial processes and employee data
4. **Timing Sensitive**: Business-critical schedules (3 AM, 4 PM) must not be changed without approval
5. **No Test Suite**: Manual testing only - verify changes thoroughly before deployment
6. **Role-Based Notifications**: Complex approval workflows with vacancy handling and fallback to plant managers
7. **External Dependencies**: LDAP, SQL Server, and Arduino controllers may be unavailable - handle gracefully