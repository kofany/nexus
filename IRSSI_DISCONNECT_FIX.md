# Fix: Obsługa disconnect irssi websocket + zmiana hasła The Lounge

## Problem 1: Brak informacji o utracie połączenia z irssi

Gdy połączenie z irssi websocket zostało utracone:

- ❌ Brak informacji w UI o disconnect
- ❌ Sieci/kanały pozostawały na liście
- ❌ Przy reconnect kanały się duplikowały
- ❌ User nie widział że nie ma połączenia z irssi

## Problem 2: Brak możliwości zmiany hasła The Lounge

Handler `change-password` był tylko w `initializeClient`, ale nie w `initializeIrssiClient`:

- ❌ Nie można było zmienić hasła do logowania do The Lounge
- ❌ IrssiClient nie miał metody `setPassword()`

## Rozwiązanie

### 1. Czyszczenie sieci przy disconnect

**server/irssiClient.ts - disconnected handler:**

```typescript
(this.irssiConnection as any).on("disconnected", () => {
  log.warn(`User ${this.name}: irssi WebSocket disconnected`);

  // CLEAR networks on disconnect
  const clearedCount = this.networks.length;
  this.networks = [];
  this.lastActiveChannel = -1;

  // Broadcast disconnect status to all browsers
  this.broadcastToAllBrowsers("irssi:status", {
    connected: false,
    error: "Lost connection to irssi WebSocket",
  });

  // Send empty init to clear UI networks
  this.broadcastToAllBrowsers("init", {
    networks: [],
    active: -1,
  });

  log.info(`Cleared ${clearedCount} networks after irssi disconnect`);
});
```

### 2. Czyszczenie UI po disconnect

**client/js/socket-events/irssi_status.ts:**

```typescript
socket.on("irssi:status", function (data) {
  if (data.connected) {
    // Reconnected - show success message
    store.commit("currentUserVisibleError", "✓ Connected to irssi WebSocket");
    setTimeout(() => {
      store.commit("currentUserVisibleError", null);
    }, 3000);
  } else {
    // Disconnected - CLEAR networks from UI
    console.log("[IRSSI_STATUS] Disconnected - clearing networks from UI");

    store.commit("networks", []); // CLEAR all networks

    store.commit(
      "currentUserVisibleError",
      (data.error || "Lost connection to irssi WebSocket") + " - Reconnecting..."
    );
  }
});
```

### 3. Dodanie setPassword do IrssiClient

**server/irssiClient.ts:**

```typescript
/**
 * Set The Lounge password (login password, NOT irssi password!)
 */
setPassword(hash: string, callback: (success: boolean) => void): void {
    const oldHash = this.config.password;
    this.config.password = hash;

    this.manager.saveUser(this as any, (err) => {
        if (err) {
            this.config.password = oldHash;
            return callback(false);
        }
        return callback(true);
    });
}
```

### 4. Handler change-password w initializeIrssiClient

**server/server.ts - initializeIrssiClient():**

```typescript
// Handle password change (The Lounge login password, NOT irssi password!)
if (!Config.values.public && !Config.values.ldap.enable) {
  socket.on("change-password", (data) => {
    if (_.isPlainObject(data)) {
      const old = data.old_password;
      const p1 = data.new_password;
      const p2 = data.verify_password;

      if (typeof p1 === "undefined" || p1 === "" || p1 !== p2) {
        socket.emit("change-password", {error: "", success: false});
        return;
      }

      Helper.password
        .compare(old || "", client.config.password)
        .then((matching) => {
          if (!matching) {
            socket.emit("change-password", {
              error: "password_incorrect",
              success: false,
            });
            return;
          }

          const hash = Helper.password.hash(p1);

          client.setPassword(hash, (success: boolean) => {
            socket.emit("change-password", {
              success: success,
              error: success ? undefined : "update_failed",
            });
          });
        })
        .catch((error: Error) => {
          log.error(`Error checking password: ${error.message}`);
        });
    }
  });
}
```

## Przepływ przy disconnect/reconnect

### Disconnect:

1. irssi websocket się rozłącza
2. `disconnected` event w irssiClient.ts
3. **Czyści networks + lastActiveChannel**
4. Wysyła do wszystkich przeglądarek:
   - `irssi:status` → {connected: false, error: "..."}
   - `init` → {networks: [], active: -1}
5. Frontend (irssi_status.ts):
   - **Czyści store.commit("networks", [])**
   - Pokazuje error: "Lost connection... Reconnecting..."

### Reconnect:

1. irssi websocket reconnect
2. Wysyła `state_dump` z aktualnymi sieciami
3. `handleInit()` w irssiClient.ts przetwarza state_dump
4. Tworzy sieci od nowa (brak duplikatów!)
5. Wysyła `irssi:status` → {connected: true}
6. Frontend pokazuje: "✓ Connected to irssi WebSocket"

## Kluczowe zasady

1. **Disconnect czyści WSZYSTKO** - networks, lastActiveChannel
2. **Frontend również czyści** - store.commit("networks", [])
3. **Brak duplikacji** - przy reconnect sieci są tworzone od nowa
4. **Informacja dla usera** - widzi status połączenia + error message
5. **Zmiana hasła działa** - setPassword dla IrssiClient + handler w initializeIrssiClient

## Test

### Test 1: Disconnect irssi

```bash
# Terminal 1: uruchom The Lounge
npm start

# Terminal 2: zatrzymaj irssi websocket
# (lub symuluj disconnect)

# W przeglądarce:
# - Lista sieci/kanałów ZNIKA
# - Pojawia się error: "Lost connection to irssi WebSocket - Reconnecting..."
```

### Test 2: Reconnect irssi

```bash
# Terminal 2: uruchom irssi websocket ponownie

# W przeglądarce:
# - Pojawia się: "✓ Connected to irssi WebSocket"
# - Lista sieci/kanałów wraca (bez duplikatów!)
# - Po 3s success message znika
```

### Test 3: Zmiana hasła The Lounge

```bash
# W przeglądarce:
# 1. Settings → Account
# 2. Change password:
#    - Old password: <aktualne hasło>
#    - New password: <nowe hasło>
#    - Verify password: <nowe hasło>
# 3. Submit
# 4. Powinno pokazać: "Password changed successfully"
# 5. Wyloguj się i zaloguj nowym hasłem
```

## Pliki zmienione

1. `server/irssiClient.ts`:

   - Rozszerzony `disconnected` handler - czyści networks i broadcastuje status
   - Dodana metoda `setPassword()`

2. `client/js/socket-events/irssi_status.ts`:

   - Czyści networks z store przy disconnect
   - Uproszczona logika error message

3. `server/server.ts`:
   - Dodany handler `change-password` w `initializeIrssiClient()`

## Bezpieczeństwo

**WAŻNE:** Handler `change-password` zmienia hasło **The Lounge** (do logowania do web UI), **NIE** hasło irssi websocket!

- Hasło The Lounge: `client.config.password` (bcrypt hash)
- Hasło irssi: `client.config.irssiConnection.passwordEncrypted` (encrypted)

To są dwie **całkowicie oddzielne** rzeczy!

## Wnioski

✅ User widzi status połączenia z irssi
✅ Przy disconnect sieci są czyszczone (serwer + frontend)
✅ Przy reconnect brak duplikatów
✅ Zmiana hasła The Lounge działa
✅ Separacja: hasło TL ≠ hasło irssi
