# BRUSS-CRON

Scheduled task automation and monitoring service for BRUSS manufacturing operations. Provides automated reminders, data synchronization, monitoring, and backup services for the bruss-intra and bruss-floor applications.

## Installation

```bash
bun install
```

## Running

### With PM2 (Production - Windows Server)

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

### Manual Start

**Important:** Must use `--openssl-legacy-provider` flag for SMB backup functionality.

```bash
node --openssl-legacy-provider index.js
```

## Configuration

Copy `.env.example` to `.env` and configure environment variables.

## Features

- Deviation reminders and status updates
- Production overtime tracking
- Task attendance reminders
- LDAP and R2platnik employee synchronization
- Oven temperature monitoring
- Scan archiving
- **SMB backups:** LV1 MVC_Pictures and LV2 Zasoby to Synology NAS

## 🔗 Related Projects

- **bruss-intra** - Management and analytics web application
- **bruss-floor** - Shop floor operations web application
