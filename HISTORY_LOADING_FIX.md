# Historia nie ładuje się - Analiza i rozwiązanie

**Data:** 2025-10-15  
**Problem:** Po wejściu z przeglądarki do frontendu The Lounge i otwarciu kanału, nie ładuje się historia (ostatnie 100 linii) ze storage, ani nie działa przycisk "Show older messages" / scroll do ładowania historii.

## Analiza problemu

### 1. Stan encrypted storage ✅

Encrypted storage **działa poprawnie**:

- Baza danych istnieje: `~/.thelounge/logs/kfn.encrypted.sqlite3` (188 KB)
- Zawiera **558 wiadomości** z okresu 2025-10-14 do 2025-10-15
- Wiadomości są szyfrowane AES-256-GCM przed zapisem do SQLite
- User config ma `"log": true` - storage włączony

```bash
$ sqlite3 ~/.thelounge/logs/kfn.encrypted.sqlite3 "SELECT COUNT(*) FROM messages;"
558

$ sqlite3 ~/.thelounge/logs/kfn.encrypted.sqlite3 \
  "SELECT datetime(MIN(time)/1000, 'unixepoch'), datetime(MAX(time)/1000, 'unixepoch') FROM messages;"
2025-10-14 13:56:03|2025-10-15 22:03:57
```

### 2. Problem #1: `totalMessages` nie było wysyłane poprawnie ✅ NAPRAWIONE

**Opis:**
W metodzie `Chan.getFilteredClone()`, pole `totalMessages` było ustawione na `this.messages.length`, ale w irssi proxy mode kanały **nie trzymają wiadomości w pamięci** - są ładowane ze storage on-demand.

**Kod przed naprawą:**

```typescript
// server/models/chan.ts (linia 209)
return {
  messages: msgs,
  totalMessages: this.messages.length, // ❌ Zawsze 0 lub bardzo małe
  // ...
};
```

**Rozwiązanie:**
Dodano pole `totalMessagesInStorage` do klasy `Chan`, które jest ustawiane w `sendInitialState()` przed wywołaniem `getFilteredClone()`:

```typescript
// server/models/chan.ts
class Chan {
    totalMessagesInStorage?: number; // Total count from storage (irssi mode)

    getFilteredClone(...) {
        return {
            totalMessages: this.totalMessagesInStorage ?? this.messages.length,
            // ...
        };
    }
}

// server/irssiClient.ts - sendInitialState()
const totalCount = await this.messageStorage.getMessageCount(network.uuid, channel.name);
channel.totalMessagesInStorage = totalCount;
```

**Frontend reakcja:**

```typescript
// client/js/chan.ts
moreHistoryAvailable: shared.totalMessages > shared.messages.length;
```

Jeśli `totalMessages = 250` a `messages.length = 100`, to `moreHistoryAvailable = true` i przycisk "Show older messages" się pojawia.

### 3. Problem #2: UUID sieci są losowe przy każdym reconnect ❌ GŁÓWNY PROBLEM

**Opis:**
**To jest główna przyczyna dlaczego historia się nie ładuje!**

Każde połączenie do irssi tworzy **nowy losowy UUID** dla każdej sieci IRC:

```typescript
// server/feWebClient/feWebAdapter.ts (przed naprawą)
private generateUuid(): string {
    return `network-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
```

**Skutki:**

- **22 różne UUID** dla tej samej sieci w bazie danych!
- Historia jest zapisywana pod starym UUID, ale frontend szuka wiadomości dla nowego UUID
- Przy każdym reconnect/restart tracisz dostęp do całej historii

**Dowód z bazy danych:**

```bash
$ sqlite3 ~/.thelounge/logs/kfn.encrypted.sqlite3 \
  "SELECT network, channel, COUNT(*) FROM messages GROUP BY network, channel ORDER BY COUNT(*) DESC LIMIT 5;"

network-1760470472415-qhcsw9lzk|#polska|254    # ← różne UUID dla #polska
network-1760480550095-c54socvop|#polska|80     # ← różne UUID dla #polska
network-1760451093388-vq2344x38|#polska|42     # ← różne UUID dla #polska
network-1760482918568-pacfy7fhx|#polska|39     # ← różne UUID dla #polska
```

**Rozwiązanie:**
UUID musi być **persistentne** i oparte na server tag (nazwa serwera w irssi), nie losowo generowane.

#### Implementacja persistentnych UUID:

**1. Dodano pole do user.json:**

```typescript
// server/irssiClient.ts
export type IrssiUserConfig = {
  // ...
  networkUuidMap?: {
    [serverTag: string]: string; // server_tag -> persistent UUID
  };
};
```

**2. Zmodyfikowano FeWebAdapter:**

```typescript
export class FeWebAdapter {
  private networkUuidMap: Map<string, string>; // server_tag -> UUID (persistent)

  constructor(socket, callbacks, existingUuidMap?) {
    this.networkUuidMap = existingUuidMap || new Map();
  }

  private getOrCreateNetworkUuid(serverTag: string): string {
    let uuid = this.networkUuidMap.get(serverTag);
    if (!uuid) {
      uuid = `network-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.networkUuidMap.set(serverTag, uuid);
      log.info(`Created new persistent UUID for server ${serverTag}: ${uuid}`);
    } else {
      log.info(`Using existing UUID for server ${serverTag}: ${uuid}`);
    }
    return uuid;
  }
}
```

**3. IrssiClient ładuje i zapisuje mapowanie:**

```typescript
// Load from config
const existingUuidMap = new Map<string, string>();
if (this.config.networkUuidMap) {
    for (const [serverTag, uuid] of Object.entries(this.config.networkUuidMap)) {
        existingUuidMap.set(serverTag, uuid);
    }
}
this.feWebAdapter = new FeWebAdapter(this.irssiConnection, adapterCallbacks, existingUuidMap);

// Save to config after init
private async handleInit(networks: NetworkData[]) {
    // ... load messages ...

    // Save UUID map
    const uuidMap = this.feWebAdapter.getNetworkUuidMap();
    this.config.networkUuidMap = Object.fromEntries(uuidMap);
    this.manager.saveUser(this as any);
}
```

**Efekt:**
Po pierwszym połączeniu do irssi dla serwera "IRCal", zostanie utworzony UUID np. `network-1760562000000-abc123def`. Ten sam UUID będzie używany przy każdym reconnect, więc historia będzie dostępna.

Plik `~/.thelounge/users/kfn.json` będzie zawierał:

```json
{
  "networkUuidMap": {
    "IRCal": "network-1760562000000-abc123def",
    "ircnet": "network-1760562100000-xyz789ghi"
  }
}
```

## Podsumowanie zmian

### Pliki zmodyfikowane:

1. **server/models/chan.ts**

   - Dodano pole `totalMessagesInStorage?: number`
   - Zmodyfikowano `getFilteredClone()` aby używało `totalMessagesInStorage ?? messages.length`

2. **server/irssiClient.ts**

   - Dodano `networkUuidMap` do typu `IrssiUserConfig`
   - W `sendInitialState()` dodano pobieranie `totalMessagesInStorage` przed `getFilteredClone()`
   - W `connectToIrssiInternal()` dodano ładowanie UUID map z config
   - W `handleInit()` dodano zapisywanie UUID map do config

3. **server/feWebClient/feWebAdapter.ts**
   - Dodano pole `networkUuidMap: Map<string, string>`
   - Dodano parametr `existingUuidMap` do konstruktora
   - Dodano metodę `getOrCreateNetworkUuid()` dla persistentnych UUID
   - Dodano metodę `getNetworkUuidMap()` do eksportu mapy
   - Zmieniono tworzenie sieci aby używało `getOrCreateNetworkUuid()` zamiast `generateUuid()`

## Testowanie

### Przed uruchomieniem:

```bash
# Build server
cd /Users/kfn/irssilounge
npm run build:server

# Check current state
sqlite3 ~/.thelounge/logs/kfn.encrypted.sqlite3 \
  "SELECT DISTINCT network FROM messages;" | wc -l
# Powinno pokazać 22 (stare losowe UUID)
```

### Po uruchomieniu:

1. Restart serwera The Lounge
2. Zaloguj się w przeglądarce
3. Sprawdź czy w konsoli jest log:
   ```
   [FeWebAdapter] Using existing UUID for server IRCal: network-...
   ```
4. Otwórz kanał - powinny załadować się ostatnie 100 wiadomości
5. Scroll w górę - powinien pojawić się przycisk "Show older messages"
6. Sprawdź `~/.thelounge/users/kfn.json` - powinno być pole `networkUuidMap`

### Jeśli historia nadal się nie ładuje:

**Potencjalny problem:** Wszystkie stare wiadomości są pod starymi losowymi UUID.

**Rozwiązanie tymczasowe** - migracja historii:

```sql
-- Najpierw znajdź najnowszy UUID dla każdego kanału
SELECT network, channel, MAX(time) as last_time
FROM messages
GROUP BY channel
ORDER BY last_time DESC;

-- Następnie dla każdego kanału, zaktualizuj wszystkie wiadomości do najnowszego UUID
UPDATE messages
SET network = 'network-1760562000000-abc123def'  -- nowy persistentny UUID
WHERE channel = '#polska';
```

**Rozwiązanie długoterminowe:**
Po restarcie z nowymi persistentnymi UUID, nowe wiadomości będą już zapisywane pod właściwymi UUID i historia będzie się kumulować poprawnie.

## Status

- ✅ Problem #1 (totalMessages) - **NAPRAWIONY**
- ✅ Problem #2 (UUID persistence) - **NAPRAWIONY**
- ⏳ Wymaga testu w runtime

## Następne kroki

1. Zbudować client (jeśli były zmiany): `npm run build:client`
2. Restart serwera: `pkill -f "node.*thelounge" && node index.js start`
3. Test w przeglądarce
4. (Opcjonalnie) Migracja starych wiadomości do nowych UUID
