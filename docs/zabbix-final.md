# Zabbix Monitoring - Konfiguracja

## Jeden endpoint monitorujący wszystko

**URL**: `http://10.27.10.127:3001/zabbix/status`

**Zwraca**:
- `1` - Wszystko działa (Cron, MongoDB, Aplikacja na porcie 80)
- `0` - Coś nie działa

## Konfiguracja w Zabbix (tylko 1 item)

### 1. Utwórz Host

**Configuration → Hosts → Create host**
- **Host name**: `next-bruss-cron`
- **Groups**: `Applications`
- **Add**

### 2. Dodaj 1 Item

**Configuration → Hosts** → znajdź `next-bruss-cron` → kliknij **Items** → **Create item**

- **Name**: `System Status`
- **Type**: `HTTP agent`
- **Key**: `system.status`
- **URL**: `http://10.27.10.127:3001/zabbix/status`
- **Type of information**: `Numeric (unsigned)`
- **Update interval**: `1m`
- **Add**

### 3. Dodaj 1 Trigger

**Configuration → Hosts** → znajdź `next-bruss-cron` → kliknij **Triggers** → **Create trigger**

- **Name**: `Next-Bruss System: CRITICAL - Services Down`
- **Severity**: `Disaster`
- **Expression**: kliknij **Add**:
  - **Item**: wybierz `next-bruss-cron: System Status`
  - **Function**: `last()`
  - **Result**: `= 0`
- **Add**

### 4. Sprawdź

**Monitoring → Latest data**
- Wybierz host `next-bruss-cron`
- Powinieneś zobaczyć `System Status: 1`

## Co jest monitorowane?

Endpoint sprawdza równocześnie:
1. ✅ Aplikacja Cron (czy działa na porcie 3001)
2. ✅ MongoDB (czy odpowiada)
3. ✅ Aplikacja główna (czy działa na porcie 80)

Jeśli **KTÓRYKOLWIEK** z tych elementów nie działa → zwraca `0` → Zabbix wysyła alert

## Test

```bash
# Test endpointu
curl http://10.27.10.127:3001/zabbix/status

# Powinno zwrócić:
# 1 - jeśli wszystko działa
# 0 - jeśli coś nie działa
```

## Gotowe!

To wszystko. Jeden item, jeden trigger, pełne monitorowanie.