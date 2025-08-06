# Zabbix Setup Guide for Next-Bruss Cron Monitoring

This guide will help you set up monitoring for the Next-Bruss Cron application in Zabbix.

## Prerequisites

- Zabbix Server 6.0+ installed and running
- Zabbix Agent installed on the server running Next-Bruss Cron
- Next-Bruss Cron application with health check enabled

## Step 1: Configure Environment Variables

Add these variables to your `.env` file:

```env
# Health Check Configuration
HEALTH_CHECK_PORT=3001
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_AUTH_TOKEN=your-secret-token  # Optional, for /health/detailed endpoint
```

## Step 2: Verify Health Check Endpoint

Test that the health check is working:

```bash
# Basic health check
curl http://localhost:3001/health

# Zabbix-specific endpoint
curl http://localhost:3001/health/zabbix

# Component-specific checks
curl http://localhost:3001/health/zabbix/mongodb
curl http://localhost:3001/health/zabbix/ldap
curl http://localhost:3001/health/zabbix/r2platnik

# Detailed health (if auth token is configured)
curl -H "Authorization: Bearer your-secret-token" http://localhost:3001/health/detailed
```

## Step 3: Import Zabbix Template

1. Log in to Zabbix web interface
2. Navigate to **Configuration** → **Templates**
3. Click **Import** button
4. Select the file `docs/zabbix-template.xml`
5. Click **Import**

## Step 4: Create Host in Zabbix

1. Navigate to **Configuration** → **Hosts**
2. Click **Create host**
3. Fill in the following:
   - **Host name**: `next-bruss-cron`
   - **Visible name**: `Next-Bruss Cron Application`
   - **Groups**: Select or create `Applications` group
   - **Interfaces**: Add Agent interface with the server's IP address
4. Go to **Templates** tab
5. Link the template `Next-Bruss Cron Monitor`
6. Go to **Macros** tab and override if needed:
   - `{$HEALTH_CHECK_URL}` - Default: `http://localhost:3001`
   - `{$HEALTH_CHECK_HOST}` - Default: `localhost`
   - `{$HEALTH_CHECK_PORT}` - Default: `3001`
7. Click **Add**

## Step 5: Configure Web Scenario (Additional Monitoring)

For more detailed HTTP monitoring:

1. Navigate to **Configuration** → **Hosts**
2. Click on your `next-bruss-cron` host
3. Go to **Web scenarios** tab
4. Click **Create web scenario**
5. Configure:

### General Tab:
- **Name**: `Health Check Monitoring`
- **Update interval**: `1m`
- **Attempts**: `3`
- **Agent**: `Zabbix`

### Steps Tab:
Add step:
- **Name**: `Check Health`
- **URL**: `http://localhost:3001/health`
- **Required string**: `"status":"healthy"`
- **Required status codes**: `200`

### Click **Add**

## Step 6: Set Up Notifications

### Email Notifications

1. Navigate to **Administration** → **Media types**
2. Configure Email media type with your SMTP settings
3. Navigate to **Configuration** → **Actions** → **Trigger actions**
4. Click **Create action**
5. Configure:

#### Action Tab:
- **Name**: `Next-Bruss Cron Alerts`
- **Conditions**: 
  - Trigger name contains `Next-Bruss Cron`
  - Trigger severity is greater than or equal to Warning

#### Operations Tab:
- **Send to users**: Select users/groups
- **Send only to**: Email
- **Subject**: `{TRIGGER.STATUS}: {TRIGGER.NAME}`
- **Message**:
```
Problem: {TRIGGER.NAME}
Host: {HOST.NAME}
Severity: {TRIGGER.SEVERITY}
Time: {EVENT.DATE} {EVENT.TIME}

Original problem ID: {EVENT.ID}
{TRIGGER.URL}
```

## Step 7: Dashboard Setup

1. Navigate to **Monitoring** → **Dashboards**
2. Click **Create dashboard**
3. Name it `Next-Bruss Cron Monitoring`
4. Add widgets:

### Widget 1: Overall Status
- **Type**: Item value
- **Item**: `next.bruss.health.status`
- **Show**: As is

### Widget 2: Components Status
- **Type**: Graph
- Add items:
  - `next.bruss.mongodb.status`
  - `next.bruss.ldap.status`
  - `next.bruss.r2platnik.status`

### Widget 3: Response Times
- **Type**: Graph
- Add items:
  - `next.bruss.mongodb.response_time`
  - `net.tcp.service.perf`

### Widget 4: Problems
- **Type**: Problems
- **Problem tags**: `Service:Next-Bruss`

### Widget 5: System Info
- **Type**: Plain text
- Items:
  - `next.bruss.uptime`
  - `next.bruss.health.status`

## Step 8: Testing Alerts

Test that alerts are working:

1. Stop MongoDB temporarily to trigger an alert:
```bash
# On Linux/Mac
sudo systemctl stop mongod
# or
brew services stop mongodb-community

# Wait 60 seconds for Zabbix to detect
# Then start it again
sudo systemctl start mongod
```

2. Check Zabbix:
   - **Monitoring** → **Problems** should show the issue
   - You should receive an email notification

## Monitoring Items Explained

### Status Items
- **Application Health Status**: Overall health (healthy/degraded/unhealthy)
- **MongoDB/LDAP/R2platnik Status**: Individual component status (1=up, 0=down)

### Performance Items
- **Response Times**: How long each component takes to respond
- **Application Uptime**: How long the app has been running

### Triggers (Alerts)

| Priority | Trigger | Description |
|----------|---------|-------------|
| **Disaster** | Application unhealthy | Main application is down |
| **High** | MongoDB connection failed | Cannot connect to database |
| **Warning** | LDAP connection failed | Cannot sync users |
| **Warning** | R2platnik connection failed | Cannot sync employee data |
| **Warning** | Slow response | Response time > 3s |
| **Info** | Recently restarted | Uptime < 5 minutes |

## Troubleshooting

### Health check not responding
1. Check if the application is running: `ps aux | grep node`
2. Check if port 3001 is listening: `netstat -an | grep 3001`
3. Check application logs for errors

### Zabbix not collecting data
1. Check Zabbix agent status: `systemctl status zabbix-agent`
2. Test connection: `zabbix_get -s localhost -k agent.ping`
3. Check host configuration in Zabbix

### False positives
- Adjust trigger thresholds in template
- Increase check intervals for non-critical items
- Add dependencies between triggers

## Advanced Configuration

### Custom Metrics

You can add custom metrics by modifying the health check:

```javascript
// In health-check.js
app.get('/health/metrics/custom', (req, res) => {
  res.json({
    pendingDeviations: getPendingCount(),
    lastCronRun: getLastRun()
  });
});
```

Then add corresponding items in Zabbix.

### Security

For production environments:

1. Use HTTPS for health checks:
```env
HEALTH_CHECK_URL=https://your-domain.com:3001
```

2. Configure firewall to limit access:
```bash
# Only allow Zabbix server
iptables -A INPUT -p tcp --dport 3001 -s ZABBIX_SERVER_IP -j ACCEPT
iptables -A INPUT -p tcp --dport 3001 -j DROP
```

3. Use authentication token for detailed endpoints

## Support

For issues with:
- **Application**: Check application logs and health endpoint
- **Zabbix**: Check Zabbix server logs at `/var/log/zabbix/`
- **Network**: Use `tcpdump` to verify traffic