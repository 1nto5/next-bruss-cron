# Zabbix Configuration for Next-Bruss Cron

## Quick Setup

### 1. Add to `.env`
```env
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_PORT=3001
HEALTH_CHECK_AUTH_TOKEN=919e1d938f14da772bd8f4baae9b210256e01b121e1a67b4bba28145a7197176
```

### 2. Restart application
```bash
bun index.js
```

### 3. Test endpoints
```bash
# Overall status (1=healthy, 0=unhealthy)
curl http://localhost:3001/zabbix/status

# MongoDB status
curl http://localhost:3001/zabbix/mongodb

# LDAP status  
curl http://localhost:3001/zabbix/ldap

# MongoDB response time (ms)
curl http://localhost:3001/zabbix/mongodb/response

# LDAP response time (ms)
curl http://localhost:3001/zabbix/ldap/response

# Application uptime (seconds)
curl http://localhost:3001/zabbix/uptime
```

## Zabbix Configuration

### Step 1: Create Host

1. Go to **Configuration → Hosts**
2. Click **Create host**
3. Configure:
   - **Host name**: `next-bruss-cron`
   - **Groups**: `Applications`
   - **Agent interfaces**: Add with server IP

### Step 2: Create Items

Go to **Configuration → Hosts → next-bruss-cron → Items** and create:

#### Application Status
- **Name**: `Application Status`
- **Type**: `HTTP agent`
- **Key**: `app.status`
- **URL**: `http://localhost:3001/zabbix/status`
- **Type of information**: `Numeric (unsigned)`
- **Update interval**: `1m`

#### MongoDB Status
- **Name**: `MongoDB Status`
- **Type**: `HTTP agent`
- **Key**: `mongodb.status`
- **URL**: `http://localhost:3001/zabbix/mongodb`
- **Type of information**: `Numeric (unsigned)`
- **Update interval**: `1m`

#### LDAP Status
- **Name**: `LDAP Status`
- **Type**: `HTTP agent`
- **Key**: `ldap.status`
- **URL**: `http://localhost:3001/zabbix/ldap`
- **Type of information**: `Numeric (unsigned)`
- **Update interval**: `1m`

#### MongoDB Response Time
- **Name**: `MongoDB Response Time`
- **Type**: `HTTP agent`
- **Key**: `mongodb.response`
- **URL**: `http://localhost:3001/zabbix/mongodb/response`
- **Type of information**: `Numeric (unsigned)`
- **Units**: `ms`
- **Update interval**: `1m`

#### LDAP Response Time
- **Name**: `LDAP Response Time`
- **Type**: `HTTP agent`
- **Key**: `ldap.response`
- **URL**: `http://localhost:3001/zabbix/ldap/response`
- **Type of information**: `Numeric (unsigned)`
- **Units**: `ms`
- **Update interval**: `1m`

#### Application Uptime
- **Name**: `Application Uptime`
- **Type**: `HTTP agent`
- **Key**: `app.uptime`
- **URL**: `http://localhost:3001/zabbix/uptime`
- **Type of information**: `Numeric (unsigned)`
- **Units**: `s`
- **Update interval**: `5m`

### Step 3: Create Triggers

Go to **Configuration → Hosts → next-bruss-cron → Triggers**:

#### Critical: Application Down
- **Name**: `Next-Bruss Cron: Application is down`
- **Severity**: `Disaster`
- **Expression**: `last(/next-bruss-cron/app.status)=0`

#### High: MongoDB Down
- **Name**: `Next-Bruss Cron: MongoDB is down`
- **Severity**: `High`
- **Expression**: `last(/next-bruss-cron/mongodb.status)=0`

#### Warning: LDAP Down
- **Name**: `Next-Bruss Cron: LDAP is down`
- **Severity**: `Warning`
- **Expression**: `last(/next-bruss-cron/ldap.status)=0`

#### Warning: MongoDB Slow
- **Name**: `Next-Bruss Cron: MongoDB slow response`
- **Severity**: `Warning`
- **Expression**: `avg(/next-bruss-cron/mongodb.response,5m)>3000`

#### Warning: LDAP Slow
- **Name**: `Next-Bruss Cron: LDAP slow response`
- **Severity**: `Warning`
- **Expression**: `avg(/next-bruss-cron/ldap.response,5m)>3000`

#### Info: Recently Restarted
- **Name**: `Next-Bruss Cron: Recently restarted`
- **Severity**: `Info`
- **Expression**: `last(/next-bruss-cron/app.uptime)<300`

### Step 4: Create Graphs

Go to **Configuration → Hosts → next-bruss-cron → Graphs**:

#### Component Status Graph
- **Name**: `Component Status`
- **Items**:
  - MongoDB Status
  - LDAP Status

#### Response Times Graph
- **Name**: `Response Times`
- **Items**:
  - MongoDB Response Time
  - LDAP Response Time

### Step 5: Dashboard

Create dashboard with widgets:

1. **Item Value** - Application Status
2. **Graph** - Component Status
3. **Graph** - Response Times
4. **Plain Text** - Application Uptime
5. **Problems** - Filter by host

## Testing

### Simulate MongoDB failure
```bash
# Stop MongoDB
sudo systemctl stop mongod

# Wait 1 minute for Zabbix to detect
# Check Problems in Zabbix

# Start MongoDB
sudo systemctl start mongod
```

### Check from Zabbix server
```bash
# From Zabbix server
curl http://YOUR_SERVER_IP:3001/zabbix/status
```

## Troubleshooting

### No data in Zabbix
1. Check if port 3001 is accessible from Zabbix server
2. Check firewall: `sudo ufw allow 3001/tcp`
3. Test with curl from Zabbix server

### Always shows 0
1. Check MongoDB connection string in `.env`
2. Check application logs
3. Test endpoints manually with curl

### Permission denied
1. Check if application is running as correct user
2. Check MongoDB permissions
3. Check LDAP credentials