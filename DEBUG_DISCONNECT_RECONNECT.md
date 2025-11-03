# Debug: Disconnect/Reconnect - Krok po kroku

## Dodane logi diagnostyczne

### Backend (server/irssiClient.ts):

**Disconnect handler:**

```
[DISCONNECT] BEFORE clear: X networks
[DISCONNECT] AFTER clear: 0 networks
[DISCONNECT] Broadcasting irssi:status to X browsers
[DISCONNECT] Broadcasting EMPTY init to X browsers
```

**handleInit() (przy reconnect):**

```
[HANDLEINIT] ========================================
[HANDLEINIT] Init with X networks
[HANDLEINIT] BEFORE assignment: this.networks.length = Y
[HANDLEINIT] AFTER assignment: this.networks.length = X
[HANDLEINIT] attachedBrowsers.size = Z
[HANDLEINIT] Broadcasting init to Z browsers with X networks
```

### Frontend (client/js/socket-events/init.ts):

**Init handler:**

```
[INIT] Received init event
[INIT] networks count: X
[INIT] current store.state.networks count: Y
[INIT] After merge, networks count: Z
```

**mergeNetworkData():**

```
[MERGE] ===============================================
[MERGE] mergeNetworkData called
[MERGE] newNetworks.length: X
[MERGE] store.state.networks.length: Y

CASE 1 - Store pusty:
[MERGE] ⚠️ Store is empty, creating FRESH networks (NO MERGE)
[MERGE] Creating fresh network: IRCnet (uuid: xxx)
[MERGE]   - 3 channels created
[MERGE] ✅ Returning FRESH networks, count: 2

CASE 2 - Store ma sieci (normal merge):
[MERGE] Using NORMAL merge logic
[MERGE] Network IRCnet NOT FOUND in store - creating NEW
[MERGE]   - Created with 3 channels
[MERGE] ✅ Returning merged networks, count: 2
```

**mergeChannelData():**

```
[MERGE-CHAN] mergeChannelData: old=3, new=3
[MERGE-CHAN]   Channel #polska (id=4) - NEW, creating
[MERGE-CHAN]   Channel #test (id=5) - EXISTS, merging
[MERGE-CHAN] ✅ Result: 3 channels
```

## Scenariusz testowy

### 1. Uruchom The Lounge:

```bash
npm start
```

### 2. Zaloguj się w przeglądarce (http://localhost:9000)

### 3. Upewnij się że irssi działa i sieci są widoczne

### 4. Zatrzymaj irssi websocket

**Oczekiwane logi BACKEND:**

```
[FeWebSocket] WebSocket closed (code: 1006, reason: )
User kfn: irssi WebSocket disconnected (code: 1006)
[DISCONNECT] BEFORE clear: 2 networks
[DISCONNECT] AFTER clear: 0 networks
[DISCONNECT] Broadcasting irssi:status to 1 browsers
[DISCONNECT] Broadcasting EMPTY init to 1 browsers
```

**Oczekiwane logi FRONTEND (konsola przeglądarki):**

```
[IRSSI_STATUS] Disconnected - clearing networks from UI

[INIT] Received init event
[INIT] networks count: 0
[INIT] current store.state.networks count: 2  ← Jeszcze stare
[MERGE] ===============================================
[MERGE] mergeNetworkData called
[MERGE] newNetworks.length: 0
[MERGE] store.state.networks.length: 2

... (merge zwróci pusty result bo newNetworks.length = 0)

[INIT] After merge, networks count: 0
```

**W UI:**

- Lista sieci ZNIKA
- Error: "Lost connection to irssi WebSocket (code: 1006) - Reconnecting..."

### 5. Uruchom irssi websocket ponownie

**Oczekiwane logi BACKEND:**

```
[FeWebSocket] WebSocket connected, waiting for auth_ok...
User kfn: irssi authentication successful
[FeWebAdapter] State dump started for server: IRCnet

[HANDLEINIT] ========================================
[HANDLEINIT] Init with 2 networks
[HANDLEINIT] BEFORE assignment: this.networks.length = 0  ← Puste po disconnect!
[HANDLEINIT] AFTER assignment: this.networks.length = 2
[HANDLEINIT] attachedBrowsers.size = 1
[HANDLEINIT] Broadcasting init to 1 browsers with 2 networks
```

**Oczekiwane logi FRONTEND (KLUCZOWE!):**

```
[INIT] Received init event
[INIT] networks count: 2
[INIT] current store.state.networks count: 0  ← Puste po disconnect!

[MERGE] ===============================================
[MERGE] mergeNetworkData called
[MERGE] newNetworks.length: 2
[MERGE] store.state.networks.length: 0  ← POWINNO BYĆ 0!

[MERGE] ⚠️ Store is empty, creating FRESH networks (NO MERGE)
[MERGE] Creating fresh network: IRCnet (uuid: xxx)
[MERGE]   - 3 channels created
[MERGE] Creating fresh network: IRCal (uuid: yyy)
[MERGE]   - 4 channels created
[MERGE] ✅ Returning FRESH networks, count: 2

[INIT] After merge, networks count: 2
```

**W UI:**

- Sieci wracają (IRCnet, IRCal)
- **BEZ DUPLIKACJI** - każda sieć tylko raz
- Error znika (lub "✓ Connected to irssi WebSocket")

## Co sprawdzić jeśli jest duplikacja:

### A. Sprawdź frontend logi:

**Jeśli widzisz:**

```
[MERGE] store.state.networks.length: 2  ← NIE POWINNO!
[MERGE] Using NORMAL merge logic        ← BŁĄD!
[MERGE] Network IRCnet NOT FOUND in store - creating NEW
```

**Oznacza to:** Store NIE został wyczyszczony przez `irssi:status` event!

**Przyczyna:** Event `irssi:status` przychodzi **PO** `init`, albo wcale nie przychodzi.

**Fix:** Upewnij się że `irssi:status` jest broadcast **PRZED** `init` w disconnect handler.

### B. Sprawdź backend logi:

**Jeśli widzisz:**

```
[HANDLEINIT] BEFORE assignment: this.networks.length = 2  ← NIE POWINNO!
```

**Oznacza to:** Backend `this.networks` NIE został wyczyszczony w disconnect handler!

**Przyczyna:** Disconnect handler się nie wywołał, lub wywołał się po `handleInit`.

**Fix:** Sprawdź czy `this.emit("disconnected")` działa w feWebSocket.ts.

### C. Sprawdź kolejność eventów:

**Backend powinien wysłać w tej kolejności:**

1. `irssi:status` {connected: false}
2. `init` {networks: []}

**Frontend powinien otrzymać:**

1. `irssi:status` → czyści store
2. `init` → merguje z pustym store (zwraca [])

Jeśli kolejność jest odwrotna → duplikacja!

## Debugowanie w konsoli przeglądarki:

```javascript
// Sprawdź aktualny stan:
store.state.networks.length;
store.state.networks.map((n) => n.name);

// Sprawdź czy są duplikaty:
store.state.networks.map((n) => n.uuid);
// Jeśli ten sam UUID występuje 2x → duplikacja!

// Wymuś czyszczenie:
store.commit("networks", []);
```

## Oczekiwany rezultat:

✅ Disconnect → sieci znikają (backend + frontend)
✅ Reconnect → sieci wracają **BEZ DUPLIKACJI**
✅ Logi pokazują: "Store is empty, creating FRESH networks"
✅ UI pokazuje każdą sieć/kanał tylko RAZ
