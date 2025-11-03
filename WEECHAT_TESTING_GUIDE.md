# WeeChat Relay - Przewodnik Testowania

## Jak włączyć WeeChat Relay dla użytkownika

### 1. Przez API (zalecane)

```bash
# Włącz WeeChat Relay dla użytkownika
curl -X POST http://localhost:9000/api/weechat-relay/enable \
  -H "Content-Type: application/json" \
  -d '{
    "username": "twoj_user",
    "password": "haslo_weechat_relay",
    "port": 9001
  }'
```

### 2. Ręcznie w pliku user.json

Edytuj `users/<username>/user.json`:

```json
{
  "weechatRelay": {
    "enabled": true,
    "port": 9001,
    "passwordEncrypted": "...",
    "compression": false
  }
}
```

**Uwaga**: `passwordEncrypted` musi być zaszyfrowane - użyj API zamiast ręcznej edycji!

### 3. Restart serwera

```bash
npm run build
npm start
```

## Jak połączyć się z Lith (iPhone)

### 1. Znajdź dane połączenia

- **Host**: IP serwera (np. `192.168.1.100` lub `your-server.com`)
- **Port**: Port z `user.json` → `weechatRelay.port` (np. `9001`)
- **Hasło**: Hasło ustawione przy włączaniu WeeChat Relay

### 2. Dodaj połączenie w Lith

1. Otwórz Lith na iPhone
2. Kliknij "+" aby dodać nowe połączenie
3. Wpisz dane:
   - **Name**: Dowolna nazwa (np. "NexusLounge")
   - **Hostname**: IP serwera
   - **Port**: Port z user.json
   - **Password**: Hasło WeeChat Relay
   - **SSL**: Wyłącz (używamy plain TCP)
4. Kliknij "Connect"

### 3. Co powinieneś zobaczyć

✅ **Jeśli działa**:

- Lista kanałów i serwerów
- Nicklist z grupami (ops, voices, users)
- Historia wiadomości
- Możliwość wysyłania wiadomości
- Live updates (nowe wiadomości pojawiają się automatycznie)
- Unread/highlight markers

❌ **Jeśli nie działa**:

- Sprawdź logi serwera: `tail -f logs/server.log`
- Sprawdź czy port jest otwarty: `netstat -an | grep 9001`
- Sprawdź czy firewall nie blokuje portu

## Debugowanie

### Logi serwera

```bash
# Wszystkie logi WeeChat Relay
tail -f logs/server.log | grep "WeeChat"

# Tylko eventy
tail -f logs/server.log | grep "Node->WeeChat\|WeeChat->Node"

# Tylko błędy
tail -f logs/server.log | grep "ERROR\|error"
```

### Sprawdź czy WeeChat Relay działa

```bash
# Sprawdź czy port nasłuchuje
netstat -an | grep 9001

# Lub
lsof -i :9001
```

### Test połączenia z telnet

```bash
telnet localhost 9001
```

Powinieneś zobaczyć odpowiedź od serwera.

### Sprawdź konfigurację użytkownika

```bash
cat users/<username>/user.json | grep -A 5 weechatRelay
```

## Typowe problemy

### 1. "Connection refused"

- Sprawdź czy serwer działa: `ps aux | grep node`
- Sprawdź czy port jest poprawny w Lith
- Sprawdź czy WeeChat Relay jest włączony dla użytkownika

### 2. "Authentication failed"

- Sprawdź czy hasło jest poprawne
- Sprawdź logi: `tail -f logs/server.log | grep "authenticated"`

### 3. "No channels visible"

- Sprawdź czy użytkownik ma połączenie z erssi
- Sprawdź czy erssi ma jakieś kanały: `tail -f logs/server.log | grep "networks"`

### 4. "Nicklist is empty"

- Sprawdź czy kanał ma użytkowników
- Sprawdź logi: `tail -f logs/server.log | grep "nicklist"`

### 5. "Messages not appearing"

- Sprawdź czy sync jest włączony: `tail -f logs/server.log | grep "Syncing"`
- Sprawdź czy eventy są przekazywane: `tail -f logs/server.log | grep "buffer_line_added"`

## Porównanie z Vue frontend

| Funkcja              | Vue | Lith (WeeChat Relay) | Status             |
| -------------------- | --- | -------------------- | ------------------ |
| Lista kanałów        | ✅  | ✅                   | Działa             |
| Historia wiadomości  | ✅  | ✅                   | Działa             |
| Wysyłanie wiadomości | ✅  | ✅                   | Działa             |
| Nicklist             | ✅  | ✅                   | Działa (z grupami) |
| Live updates         | ✅  | ✅                   | Działa             |
| Unread markers       | ✅  | ✅                   | Działa (hotlist)   |
| Highlight markers    | ✅  | ✅                   | Działa (hotlist)   |
| Mark as read         | ✅  | ⚠️                   | Częściowo (TODO)   |
| Zmiana topicu        | ✅  | ✅                   | Działa             |
| Join/Part events     | ✅  | ⚠️                   | Częściowo          |
| Nick changes         | ✅  | ⚠️                   | TODO               |
| Network status       | ✅  | ⚠️                   | TODO               |

## Następne kroki

1. **Przetestuj podstawowe funkcje**:

   - Połączenie
   - Lista kanałów
   - Wysyłanie wiadomości
   - Nicklist

2. **Przetestuj live updates**:

   - Wyślij wiadomość z Vue
   - Sprawdź czy pojawia się w Lith
   - Wyślij wiadomość z Lith
   - Sprawdź czy pojawia się w Vue

3. **Przetestuj hotlist**:

   - Zamknij kanał w Lith
   - Wyślij wiadomość do tego kanału z Vue
   - Sprawdź czy Lith pokazuje unread marker

4. **Zgłoś bugi**:
   - Jeśli coś nie działa, sprawdź logi
   - Skopiuj błędy z logów
   - Opisz co robiłeś gdy wystąpił błąd
