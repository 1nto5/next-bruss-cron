# Zabbix Monitoring - Prosta Konfiguracja

## Endpointy (tylko 2)

- `http://10.27.10.127:3001/zabbix/status` - Status aplikacji (1=działa, 0=nie działa)
- `http://10.27.10.127:3001/zabbix/mongodb` - Status MongoDB (1=działa, 0=nie działa)

## Konfiguracja w Zabbix

### 1. Utwórz Host

**Configuration → Hosts → Create host**
- **Host name**: `next-bruss-cron`
- **Groups**: `Applications`
- **Add**

### 2. Dodaj 2 Items

**Configuration → Hosts** → znajdź `next-bruss-cron` → kliknij **Items** → **Create item**

#### Item 1: Application Status
- **Name**: `Application Status`
- **Type**: `HTTP agent`
- **Key**: `app.status`
- **URL**: `http://10.27.10.127:3001/zabbix/status`
- **Type of information**: `Numeric (unsigned)`
- **Update interval**: `1m`
- **Add**

#### Item 2: MongoDB Status
- **Name**: `MongoDB Status`
- **Type**: `HTTP agent`
- **Key**: `mongodb.status`
- **URL**: `http://10.27.10.127:3001/zabbix/mongodb`
- **Type of information**: `Numeric (unsigned)`
- **Update interval**: `1m`
- **Add**

### 3. Dodaj 2 Triggery (Alerty)

**Configuration → Hosts** → znajdź `next-bruss-cron` → kliknij **Triggers** → **Create trigger**

#### Trigger 1: Aplikacja nie działa
- **Name**: `Next-Bruss Cron: Application is DOWN`
- **Severity**: `Disaster`
- **Expression**: kliknij **Add**:
  - **Item**: wybierz `next-bruss-cron: Application Status`
  - **Function**: `last()`
  - **Result**: `= 0`
- **Add**

#### Trigger 2: MongoDB nie działa
- **Name**: `Next-Bruss Cron: MongoDB is DOWN`
- **Severity**: `High`
- **Expression**: kliknij **Add**:
  - **Item**: wybierz `next-bruss-cron: MongoDB Status`
  - **Function**: `last()`
  - **Result**: `= 0`
- **Add**

### 4. Sprawdź

**Monitoring → Latest data**
- Host groups: `Applications`
- Hosts: `next-bruss-cron`
- **Apply**

Powinieneś zobaczyć:
- Application Status: 1
- MongoDB Status: 1

## Test

```bash
# Test z terminala
curl http://10.27.10.127:3001/zabbix/status
curl http://10.27.10.127:3001/zabbix/mongodb

# Symulacja awarii MongoDB
brew services stop mongodb-community
sleep 5
curl http://10.27.10.127:3001/zabbix/mongodb  # powinno zwrócić 0
brew services start mongodb-community
```

## Gotowe!

To wszystko. Masz monitoring który sprawdza:
1. Czy aplikacja działa
2. Czy MongoDB działa

Gdy któryś zwróci 0, dostaniesz alert.