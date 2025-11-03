# The Lounge + irssi fe-web Integration - Message Storage Implementation

## 🎯 CEL PROJEKTU

Dostosowanie implementacji **The Lounge** do łączenia się z WebSocket modułem **fe-web dla irssi** (budowanym równolegle).

### ⚠️ WAŻNE - AUTOCONNECT NA STARCIE!

**PROBLEM DO ROZWIĄZANIA (PRIORYTET #1):**

Jeśli user ma już skonfigurowane irssi proxy (host, port, password), to backend **POWINIEN ŁĄCZYĆ SIĘ DO IRSSI OD RAZU** przy starcie The Lounge (`npm start`), **NIE CZEKAJĄC** na pierwszą przeglądarkę!

**Obecny flow (ZŁY):**

```
npm start → Backend startuje → Czeka na login → User loguje się → Backend łączy do irssi
```

**Docelowy flow (DOBRY):**

```
npm start → Backend startuje → Sprawdza config → Jeśli passwordEncrypted != "" → Łączy do irssi OD RAZU
                                                                                    ↓
                                                                    User loguje się → Dostaje init z cache!
```

**Rozwiązanie encryption:**

- Używamy **IP+PORT** jako salt do szyfrowania hasła irssi
- `PBKDF2(irssiPassword, "${host}:${port}", 10k iter, 256-bit)` → Encryption Key
- Zapisujemy encrypted password w config
- Przy starcie: odczytujemy IP+PORT z config → derive key → decrypt password → connect!

### Architektura:

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│  Browser 1  │◄───────►│                  │◄───────►│             │
├─────────────┤  HTTP   │  The Lounge      │  WSS    │   irssi     │
│  Browser 2  │◄───────►│  Backend         │◄───────►│  + fe-web   │
├─────────────┤         │                  │         │             │
│  Browser 3  │◄───────►│  (Node.js)       │         │  (Perl)     │
└─────────────┘         └──────────────────┘         └─────────────┘
                         ▲                             ▲
                         │                             │
                    Encrypted                     Encrypted
                    SQLite DB                     WebSocket
                    (AES-256-GCM)                (AES-256-GCM)
```

### Kluczowe założenia:

1. **NIE UŻYWAMY trybu IRC** - The Lounge działa TYLKO jako proxy do irssi
2. **Backend trzyma połączenie z irssi** - jedno WebSocket connection per user
3. **Frontend łączy się do backendu** - wiele przeglądarek per user
4. **Backend cachuje stan** - networks, channels, users, messages
5. **Wszystkie przeglądarki widzą to samo** - synchronizacja przez backend

---

## 🔧 OBECNY STAN (CO JUŻ DZIAŁA)

### ✅ Zaimplementowane:

1. **FeWebSocket** - WebSocket client dla irssi fe-web

   - Dual-layer encryption: TLS + AES-256-GCM
   - PBKDF2 key derivation (password + "irssi-fe-web-v1", 10k iterations)
   - Binary frames, ping/pong keepalive

2. **FeWebAdapter** - mapowanie fe-web messages → The Lounge events

   - 20 server→client message types
   - 4 client→server message types
   - Pełna implementacja CLIENT-SPEC.md

3. **IrssiClient** - zmodyfikowany Client class

   - Persistent WebSocket connection do irssi
   - Multiple browser sessions (`attachedBrowsers: Map<socketId, BrowserSession>`)
   - Networks cache (`networks: NetworkData[]`)
   - Encrypted message storage (wyłączony - do włączenia!)

4. **Frontend integration**

   - Socket.IO events
   - Vue components (MessageList, nicklist, etc.)
   - Lazy loading UI ("Show older messages" button)

5. **Message types**
   - MESSAGE, NOTICE, JOIN, PART, QUIT, KICK, MODE, TOPIC
   - Nicklist updates (delta updates dla wydajności)
   - Channel modes, user modes
   - WHOIS, channel list

### ❌ NIE DZIAŁA (DO NAPRAWY):

1. **Messages NIE SĄ ZAPISYWANE** do storage

   - `if (this.messageStorage && false)` - wyłączone!
   - `channel.messages` pozostaje puste

2. **Messages NIE SĄ DODAWANE** do cache

   - `handleMessage()` tylko emituje event do frontendów
   - Nie dodaje do `channel.messages` array

3. **Druga przeglądarka NIE DOSTAJE init event**

   - `attachBrowser()` nie wysyła init jeśli `this.networks` już istnieje
   - Czeka na `state_dump` który NIE PRZYJDZIE (bo już połączony)

4. **Lazy loading NIE DZIAŁA**
   - Frontend wysyła `socket.emit("more")`
   - Backend `more()` zwraca `chan.messages.slice()`
   - Ale `chan.messages` jest PUSTE!

---

## 🎯 CO TRZEBA ZROBIĆ

### 1. Message Storage - Wymagania

#### Buffer w pamięci (cache):

- **1000 ostatnich linii** per kanał/query
- Nowe messages wypychają stare (FIFO)
- Używany dla:
  - Initial load (100 messages dla aktywnego kanału, 1 dla innych)
  - Lazy loading (`more` event - 100 messages per request)

#### Storage na dysku (SQLite):

- **10 lat wstecz** - wszystko!
- **Encrypted** - AES-256-GCM (to samo hasło co fe-web)
- **Wszystkie message types:**
  - MESSAGE, NOTICE (chat messages)
  - JOIN, PART, QUIT (user events)
  - KICK, MODE, TOPIC (channel events)
  - Wszystko z timestampami!

#### Lazy loading:

- Scroll w górę → "Show older messages" button
- Klik → `socket.emit("more", {target, lastId})`
- Backend → pobiera 100 starszych messages z cache
- Jeśli cache nie ma → pobiera z storage (SQLite)
- Max 5000 messages w cache (po lazy load)

### 2. Backend Cache - CO TRZYMAMY W PAMIĘCI

**WAŻNE:** Backend cache **NIE TRZYMA MESSAGES**!

```typescript
this.networks = [
  {
    uuid: "...",
    name: "IRCnet",
    nick: "kofany",
    channels: [
      {
        id: 1,
        name: "#polska",
        users: Map<nick, User>, // ✅ ZAWSZE AKTUALNY (nicklist)
        messages: [], // ❌ PUSTE! Nie cachujemy messages!
      },
    ],
  },
];
```

**Co trzymamy:**

- ✅ Networks (uuid, name, nick, serverOptions)
- ✅ Channels (id, name, topic, state)
- ✅ Users (nicklist - Map<nick, User>)
- ✅ Open queries (prywatne rozmowy)
- ❌ Messages (tylko w SQLite storage!)

**Dlaczego nie cachujemy messages:**

- Pamięć: 1000 messages × 100 kanałów × 10 users = dużo RAM!
- Storage jest szybki (SQLite + encryption)
- Frontend ładuje lazy (100 messages per request)

### 3. Initial Load - KAŻDA Przeglądarka (1sza, 2ga, 5ta - bez różnicy!)

**WAŻNE:** Initial load robi **BACKEND**, nie frontend! Każda przeglądarka jest obsługiwana **IDENTYCZNIE**!

**Flow dla KAŻDEJ przeglądarki:**

```
Browser podłącza się (obojętnie która - 1sza, 2ga, 5ta)
    ↓
Backend: attachBrowser()
    ↓
Backend: sendInitToSocket(socket)
    ↓
Dla KAŻDEGO kanału/query w this.networks[].channels[]:
  - Pobiera 100 ostatnich messages z STORAGE (SQLite)
  - Dodaje do channel.messages (tymczasowo, tylko dla tego init)
    ↓
Wysyła init event:
  - networks (z cache)
  - channels (z cache + 100 messages z storage dla każdego!)
  - users (z cache)
    ↓
Frontend otrzymuje init
    ↓
Frontend wyświetla wszystko OD RAZU:
  - Networks, channels, nicklist
  - 100 ostatnich messages dla każdego kanału/query
    ↓
User scrolluje w górę → "Show older messages" button
    ↓
Frontend: socket.emit("more", {target: channelId, lastId: oldestId})
    ↓
Backend: more() - pobiera kolejne 100 z storage
    ↓
Frontend: dodaje starsze messages na początek listy
```

**WAŻNE:**

- Open queries też muszą być w cache (`this.networks[].channels[]`)!
- Jeśli ktoś napisał do nas godzinę temu, query **MUSI BYĆ** w channels[] żeby backend mógł załadować messages przy init!
- Backend ładuje messages **PRZY KAŻDYM INIT** (dla każdej przeglądarki osobno)

### 4. Implementacja - Krok po kroku

#### A. Zapisywać messages do storage (BEZ CACHE!)

```typescript
// server/irssiClient.ts - handleMessage()

private handleMessage(networkUuid: string, channelId: number, msg: Msg): void {
    const network = this.networks.find((n) => n.uuid === networkUuid);
    const channel = network?.channels.find((c) => c.id === channelId);

    if (!channel) return;

    // 1. SAVE TO STORAGE (disk) - ASYNC!
    // NIE DODAJEMY DO channel.messages - to zostaje PUSTE!
    if (this.messageStorage) {
        // Create minimal Network/Channel objects for storage
        const networkForStorage = {
            uuid: network.uuid,
            name: network.name,
        } as Network;

        const channelForStorage = {
            name: channel.name,
        } as Channel;

        // Save encrypted to SQLite
        this.messageStorage.index(networkForStorage, channelForStorage, msg)
            .catch(err => log.error(`Failed to save message: ${err}`));
    }

    // 2. BROADCAST to all browsers (live update)
    this.broadcastToAllBrowsers("msg", {
        chan: channelId,
        msg: msg,
        unread: ...,
        highlight: ...,
    });
}
```

#### B. Loadować messages przy KAŻDYM sendInitToSocket()

```typescript
// server/irssiClient.ts - handleInit()

private async handleInit(networks: NetworkData[]): Promise<void> {
    this.networks = networks;

    // NIE ŁADUJEMY MESSAGES tutaj!
    // Będziemy ładować przy sendInitToSocket() dla każdej przeglądarki osobno

    // Send init to all browsers (jeśli są już podłączone)
    this.broadcastToAllBrowsers("init", {...});
}
```

#### C. Wysyłać init do KAŻDEJ przeglądarki (z messages!)

```typescript
// server/irssiClient.ts - attachBrowser()

attachBrowser(socket: Socket, openChannel: number = -1): void {
    const socketId = socket.id;

    this.attachedBrowsers.set(socketId, {socket, openChannel});

    log.info(`User ${this.name}: browser attached (${socketId}), total: ${this.attachedBrowsers.size}`);

    // If networks exist, send init NOW (dla KAŻDEJ przeglądarki!)
    if (this.networks.length > 0) {
        log.info(`User ${this.name}: sending init to browser ${socketId}`);
        this.sendInitToSocket(socket);
    } else {
        log.info(`User ${this.name}: waiting for state_dump before sending init`);
    }
}

private async sendInitToSocket(socket: Socket): Promise<void> {
    // ŁADUJEMY MESSAGES Z STORAGE dla każdego kanału/query!
    if (this.messageStorage) {
        for (const network of this.networks) {
            for (const channel of network.channels) {
                try {
                    // Pobierz 100 ostatnich messages z storage
                    const messages = await this.messageStorage.getLastMessages(
                        network.uuid,
                        channel.name,
                        100
                    );

                    // TYMCZASOWO dodaj do channel.messages (tylko dla tego init!)
                    channel.messages = messages;
                } catch (err) {
                    log.error(`Failed to load messages for ${channel.name}: ${err}`);
                    channel.messages = [];
                }
            }
        }
    }

    // Convert NetworkData[] to SharedNetwork[]
    const sharedNetworks = this.networks.map(net => ({
        uuid: net.uuid,
        name: net.name,
        nick: net.nick,
        serverOptions: {...},
        status: {...},
        channels: net.channels.map(ch => ch.getFilteredClone(true)), // Zawiera messages!
    }));

    // Wyczyść messages z cache (nie trzymamy w pamięci!)
    for (const network of this.networks) {
        for (const channel of network.channels) {
            channel.messages = [];
        }
    }

    socket.emit("init", {
        active: this.lastActiveChannel,
        networks: sharedNetworks,
        token: ...,
    });
}
```

#### D. Zmienić `more()` - ZAWSZE pobierać z storage

```typescript
// server/irssiClient.ts - more()

async more(data: {target: number; lastId: number}): Promise<{...} | null> {
    const channel = ...; // Find channel
    const network = ...; // Find network
    if (!channel || !network) return null;

    // ZAWSZE pobieramy z storage (NIE Z CACHE!)
    if (!this.messageStorage) {
        return {chan: data.target, messages: [], totalMessages: 0};
    }

    let messages: Msg[] = [];

    if (data.lastId < 0) {
        // Initial load - last 100 messages
        messages = await this.messageStorage.getLastMessages(
            network.uuid,
            channel.name,
            100
        );
    } else {
        // Lazy load - 100 messages before lastId
        const lastMsg = await this.messageStorage.getMessageById(data.lastId);
        if (lastMsg) {
            messages = await this.messageStorage.getMessagesBefore(
                network.uuid,
                channel.name,
                lastMsg.time.getTime(),
                100
            );
        }
    }

    // Get total count for "moreHistoryAvailable"
    const totalMessages = await this.messageStorage.getMessageCount(
        network.uuid,
        channel.name
    );

    return {
        chan: data.target,
        messages,
        totalMessages
    };
}
```

#### E. Dodać metody do EncryptedMessageStorage

```typescript
// server/plugins/messageStorage/encrypted.ts

// Get last N messages
async getLastMessages(
    networkUuid: string,
    channelName: string,
    limit: number
): Promise<Message[]> {
    await this.initDone.promise;
    if (!this.isEnabled) return [];

    const rows = await this.serialize_fetchall(
        "SELECT encrypted_data, time FROM messages WHERE network = ? AND channel = ? ORDER BY time DESC LIMIT ?",
        networkUuid,
        channelName.toLowerCase(),
        limit
    );

    return rows.reverse().map(row => {
        const decrypted = this.decrypt(row.encrypted_data);
        const msg = JSON.parse(decrypted);
        msg.time = row.time;
        msg.id = this.nextId(); // Generate new ID
        return new Msg(msg);
    });
}

// Get messages before timestamp
async getMessagesBefore(
    networkUuid: string,
    channelName: string,
    beforeTime: number,
    limit: number
): Promise<Message[]> {
    await this.initDone.promise;
    if (!this.isEnabled) return [];

    const rows = await this.serialize_fetchall(
        "SELECT encrypted_data, time FROM messages WHERE network = ? AND channel = ? AND time < ? ORDER BY time DESC LIMIT ?",
        networkUuid,
        channelName.toLowerCase(),
        beforeTime,
        limit
    );

    return rows.reverse().map(row => {
        const decrypted = this.decrypt(row.encrypted_data);
        const msg = JSON.parse(decrypted);
        msg.time = row.time;
        msg.id = this.nextId();
        return new Msg(msg);
    });
}

// Get total message count
async getMessageCount(
    networkUuid: string,
    channelName: string
): Promise<number> {
    await this.initDone.promise;
    if (!this.isEnabled) return 0;

    const row = await this.serialize_get(
        "SELECT COUNT(*) as count FROM messages WHERE network = ? AND channel = ?",
        networkUuid,
        channelName.toLowerCase()
    );

    return row?.count || 0;
}

// Get message by ID (for lazy loading)
async getMessageById(messageId: number): Promise<Message | null> {
    // This requires storing message ID in database
    // For now, we can skip this and use timestamp-based approach
    return null;
}
```

#### F. Autoconnect przy starcie The Lounge

```typescript
// server/clientManager.ts - loadUser()

loadUser(name: string): IrssiClient {
    const userConfig = this.readUserConfig(name);
    const client = new IrssiClient(this, name, userConfig);

    this.clients.push(client);

    // ✅ AUTOCONNECT: Jeśli user ma skonfigurowane irssi, połącz OD RAZU!
    if (userConfig.irssiConnection?.passwordEncrypted) {
        log.info(`User ${name} has irssi config - autoconnecting...`);

        // Decrypt password using IP+PORT as salt
        const host = userConfig.irssiConnection.host;
        const port = userConfig.irssiConnection.port;
        const salt = `${host}:${port}`;

        try {
            const key = crypto.pbkdf2Sync(
                userConfig.irssiConnection.passwordEncrypted,
                salt,
                10000,
                32,
                "sha256"
            );

            // Decrypt password
            const decrypted = this.decryptWithKey(
                userConfig.irssiConnection.passwordEncrypted,
                key
            );

            // Connect to irssi
            client.autoConnect(decrypted).catch(err => {
                log.error(`Autoconnect failed for ${name}: ${err}`);
            });
        } catch (err) {
            log.error(`Failed to decrypt irssi password for ${name}: ${err}`);
        }
    }

    return client;
}
```

#### G. Zmienić encryption na IP+PORT salt

```typescript
// server/irssiConfigHelper.ts

export async function encryptIrssiPassword(
  irssiPassword: string,
  host: string,
  port: number
): Promise<string> {
  // Use IP+PORT as salt
  const salt = `${host}:${port}`;
  const key = crypto.pbkdf2Sync(irssiPassword, salt, 10000, 32, "sha256");

  // Generate random IV (12 bytes for GCM)
  const iv = crypto.randomBytes(12);

  // Encrypt with AES-256-GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(irssiPassword, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: [IV (12 bytes)] [Ciphertext] [Tag (16 bytes)]
  const result = Buffer.concat([iv, encrypted, tag]);
  return result.toString("base64");
}

export async function decryptIrssiPassword(
  encryptedPassword: string,
  host: string,
  port: number
): Promise<string> {
  // Use IP+PORT as salt
  const salt = `${host}:${port}`;
  const key = crypto.pbkdf2Sync(encryptedPassword, salt, 10000, 32, "sha256");

  const encryptedBuffer = Buffer.from(encryptedPassword, "base64");

  // Parse: [IV (12 bytes)] [Ciphertext] [Tag (16 bytes)]
  const iv = encryptedBuffer.slice(0, 12);
  const tag = encryptedBuffer.slice(-16);
  const ciphertext = encryptedBuffer.slice(12, -16);

  // Decrypt with AES-256-GCM
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
```

---

## 🔐 ENCRYPTION - NOWA ARCHITEKTURA

### ⚠️ ZMIANA: IP+PORT jako salt (zamiast user password)

**STARA METODA (wymagała user password przy starcie):**

```
User Password → PBKDF2 → Encryption Key → Decrypt irssi password
```

❌ Problem: Nie możemy autoconnect przy starcie (nie mamy user password)

**NOWA METODA (używa IP+PORT):**

```
irssi Password + IP+PORT → PBKDF2 → Encrypted Password → Save to config
```

✅ Rozwiązanie: IP+PORT są w config (plaintext), możemy decrypt przy starcie!

### Encryption flow:

```
1. User zapisuje irssi config (host, port, irssi_websocket_password):
   PBKDF2(irssiPassword, "${host}:${port}", 10k iter, 256-bit) → Encryption Key
   Encrypt(irssiPassword, key) → passwordEncrypted → Save to config

2. Backend startuje (npm start):
   Read config → host, port, passwordEncrypted
   PBKDF2(passwordEncrypted, "${host}:${port}", 10k iter) → Encryption Key
   Decrypt(passwordEncrypted, key) → irssiPassword
   Connect to irssi!

3. User zmienia IP/PORT:
   Re-encrypt password z nowym salt "${newHost}:${newPort}"
```

### Message encryption (bez zmian):

```
[IV 12 bytes][Ciphertext][Auth Tag 16 bytes]
```

Używamy irssi_websocket_password do encryption key dla messages:

```
User irssi_websocket_password → PBKDF2("thelounge_irssi_temp_salt") → Message Encryption Key
```

### SQLite schema (bez zmian):

```sql
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT,           -- plaintext (for indexing)
    channel TEXT,           -- plaintext (for indexing)
    time INTEGER,           -- plaintext (for sorting)
    encrypted_data BLOB     -- [IV][Encrypted JSON][Tag]
);
CREATE INDEX network_channel ON messages (network, channel);
CREATE INDEX time ON messages (time);
```

---

## 📊 FLOW DIAGRAM

### Initial connection (first browser):

```
Browser 1 → Login → Backend
                      ↓
                  Connect to irssi (WebSocket)
                      ↓
                  Receive state_dump
                      ↓
                  Load messages from SQLite (last 1000 per channel)
                      ↓
                  Store in this.networks[].channels[].messages
                      ↓
                  Send init event → Browser 1
```

### Second browser connection:

```
Browser 2 → Login → Backend
                      ↓
                  irssi already connected ✅
                      ↓
                  this.networks already populated ✅
                      ↓
                  Send init event → Browser 2 (from cache!)
```

### New message arrives:

```
irssi → fe-web message → Backend
                           ↓
                      Add to channel.messages (cache)
                           ↓
                      Save to SQLite (async)
                           ↓
                      Broadcast to ALL browsers
```

### Lazy loading (scroll up):

```
Browser → "Show older messages" → socket.emit("more", {target, lastId})
                                        ↓
                                   Backend: more()
                                        ↓
                                   Check cache (channel.messages)
                                        ↓
                                   If not enough → Load from SQLite
                                        ↓
                                   Add to cache (max 5000)
                                        ↓
                                   Return 100 messages → Browser
```

---

## 🚀 NASTĘPNE KROKI

1. **Włączyć message storage** - usunąć `&& false` w `handleMessage()`
2. **Dodać messages do cache** - `channel.messages.push(msg)`
3. **Loadować z storage przy init** - `getMessages()` dla każdego kanału
4. **Wysyłać init do nowych przeglądarek** - `sendInitToSocket()`
5. **Rozszerzyć `more()`** - fallback do storage jeśli cache nie ma
6. **Dodać `getMessagesBefore()`** - nowa metoda w EncryptedMessageStorage
7. **Testować** - wiele przeglądarek, lazy loading, encryption

---

## 📝 NOTATKI

- **Backend cache:** NIE TRZYMA MESSAGES! Tylko networks, channels, users
- **Storage retention:** 10 lat (wszystko!)
- **Lazy load:** 100 messages per request (ZAWSZE z storage)
- **Encryption irssi password:** IP+PORT jako salt (autoconnect!)
- **Encryption messages:** User password jako salt (jak dotychczas)
- **Message types:** WSZYSTKO (MESSAGE, JOIN, PART, QUIT, KICK, MODE, TOPIC, etc.)
- **Timestamps:** TAK - wszystkie messages mają `time` field
- **Open queries:** Muszą być w cache (channels[]) żeby frontend mógł pobrać messages!

---

## 🔗 PLIKI DO MODYFIKACJI

1. `server/irssiClient.ts` - główna logika
2. `server/plugins/messageStorage/encrypted.ts` - nowa metoda `getMessagesBefore()`
3. `server/feWebClient/feWebAdapter.ts` - wszystkie handlery (MESSAGE, JOIN, PART, etc.)

---

## ✅ ZAIMPLEMENTOWANE: Unread Markers Synchronization

### Phase 3: Frontend unread markers (Vue.js) - ZAKOŃCZONE

**Commit:** `0c21bd33` (2025-10-14)

**Zaimplementowane funkcje:**

1. **Socket.io event types** (`shared/types/socket-events.d.ts`)

   - `activity_update: EventHandler<{chan: number; unread: number; highlight: number}>`
   - `mark_read: EventHandler<{target: number}>`

2. **Frontend handler** (`client/js/socket-events/activity_update.ts`)

   - Odbiera `activity_update` z backendu
   - Aktualizuje `channel.unread` i `channel.highlight`
   - Ignoruje update dla aktywnego kanału (user już go widzi)

3. **Frontend wysyłanie mark_read** (`client/components/Chat.vue`)

   - Wysyła `mark_read` event przy otwarciu kanału
   - Czyści unread markers w irssi

4. **Backend handler** (`server/server.ts`)

   - `socket.on("mark_read")` w `initializeIrssiClient()`
   - Wywołuje `IrssiClient.markAsRead(network.uuid, channel.name)`

5. **Backend poprawki** (`server/irssiClient.ts`)

   - Zmieniono event z `activity:update` na `activity_update`
   - Format danych: `{chan, unread, highlight}` (zgodny z frontendem)

6. **Wizualne markery** (już istniały!)
   - `Channel.vue` - badge z unread count
   - `ChannelWrapper.vue` - CSS classes `.has-unread`, `.has-highlight`
   - `style.css` - style dla `.badge` i `.badge.highlight`

**Przepływ danych:**

```
irssi → The Lounge Backend → wszystkie przeglądarki:
  WEB_MSG_ACTIVITY_UPDATE → handleActivityUpdate() → broadcast "activity_update"
  → frontend aktualizuje channel.unread/highlight → Vue.js renderuje badge

przeglądarka → The Lounge Backend → irssi → wszystkie przeglądarki:
  User otwiera kanał → "mark_read" → markAsRead() → WEB_MSG_MARK_READ do irssi
  → broadcast "activity_update" {unread:0, highlight:0} → wszystkie przeglądarki czyszczą badge
```

**Status:** ✅ Wszystkie 3 fazy zakończone (irssi C, Backend TypeScript, Frontend Vue.js)

### 🐛 Bugfix: Automatyczne czyszczenie activity przy przełączaniu okien w irssi

**Problem:**
Gdy użytkownik przełączał okna w irssi (np. `/window 5`), activity dla tego okna **NIE było czyszczone** w statusbar (Act:). Badge w The Lounge również pozostawał.

**Przyczyna:**

- irssi core emituje sygnał `"window changed"` gdy user przełącza okna
- fe-web **NIE** obsługiwał tego sygnału
- Czyszczenie activity działało TYLKO gdy:
  1. Przeglądarka wysyłała `mark_read` (kliknięcie w kanał)
  2. irssi core emitował `"window dehilight"` (ale to się działo tylko w niektórych przypadkach)

**Rozwiązanie:**
Dodano handler `sig_window_changed()` w `fe-web-signals.c`:

```c
static void sig_window_changed(WINDOW_REC *new_window, WINDOW_REC *old_window)
{
    // Sprawdza czy nowe aktywne okno ma activity (data_level > 0)
    // Jeśli tak, wysyła ACTIVITY_UPDATE z level=0 do wszystkich klientów
    // Czyści badge w The Lounge i usuwa z Act: w irssi statusbar
}
```

Zarejestrowano sygnał:

```c
signal_add("window changed", (SIGNAL_FUNC)sig_window_changed);
```

**Commit:** `cb5033a0d` (2025-10-14 11:06:26)

**Teraz działa:**

- User przełącza okno w irssi → activity automatycznie czyszczone
- Badge w The Lounge znika
- Statusbar Act: aktualizowany poprawnie

### 🐛 Bugfix #2: Duplikaty activity_update z irssi

**Problem:**
Irssi core emituje **DWA** sygnały dla tej samej wiadomości:

1. `"window hilight"` → `sig_window_hilight()` → wysyła `activity_update`
2. `"window activity"` → `sig_window_activity()` → **DUPLIKAT** wysyła znowu `activity_update`

**Dowód z logów:**

```
15:10:18 Activity HILIGHT for #irc.al (level=2)      ← pierwszy activity_update
15:10:18 Activity UPDATE for #irc.al (level=2, old=1) ← DUPLIKAT (level się nie zmienił!)
```

**Rozwiązanie:**
Dodano deduplikację w `sig_window_activity()`:

```c
/* Skip if level didn't change (avoid duplicates with window hilight) */
if (data_level == old_level) {
    return;  // Nie wysyłaj duplikatu
}
```

**Commit:** `c41186c4b` (2025-10-14 15:26:23)

### 🐛 Bugfix #3: unreadCount zawsze 0

**Problem:**
Backend otrzymywał `activity_update` z irssi, ale licznik `unreadCount` zawsze wynosił 0.

**Przyczyna:**

```typescript
// server/irssiClient.ts - handleActivityUpdate()
if (dataLevel === DataLevel.NONE) {
  marker.unreadCount = 0;
}
// ❌ Brak inkrementacji gdy dataLevel > 0!
```

**Rozwiązanie:**

```typescript
if (dataLevel === DataLevel.NONE) {
  marker.unreadCount = 0;
} else {
  marker.unreadCount++; // ✅ Dodano
}
```

**Commit:** `d8935020` (2025-10-14 15:23:13)

### 🔍 DEBUG: sig_window_changed

**Status:** W trakcie debugowania

Dodano szczegółowe logi do `sig_window_changed()` żeby zdiagnozować dlaczego handler nie jest wywoływany:

- Log przy wywołaniu funkcji
- Log przy każdym warunku (no active item, no server, data_level)
- Log gdy wysyłamy activity_update
- Log gdy pomijamy (brak activity)

**Commit:** `b214baea6` (2025-10-14 15:28:23)

**Następne kroki:** Restart irssi i test przełączania okien z nowymi logami.

### 🐛 Bugfix #4: mark_read nie przełącza okna w irssi

**Problem:**
User klika w The Lounge na kanał → backend wysyła `mark_read` do irssi → irssi czyści activity **ALE NIE PRZEŁĄCZA OKNA**.

**Dowód z logów:**

```
node2.log: Sending: {"type":"mark_read","server":"IRCnet","target":"#polska"}
irssi2.log: Received mark_read → Activity CLEAR (dehilight)
```

Okno w irssi pozostaje niezmienione.

**Rozwiązanie:**
Dodano `window_set_active(window)` w mark_read handler:

```c
/* Switch to this window in irssi (user clicked in browser) */
window_set_active(window);
```

**Commit:** `53ea76b58` (2025-10-14 15:39:35)

### 🐛 Bugfix #5: unreadCount zawsze 1 (duplikaty activity_update)

**Problem:**
Gdy przychodzi 5 wiadomości, unreadCount = 1 zamiast 5.

**Przyczyna:**
Deduplikacja w `sig_window_activity()` była **ZA AGRESYWNA**:

```c
// Stary kod:
if (data_level == old_level) {
    return;  // Skipuj jeśli level się nie zmienił
}
```

Gdy przychodzi nowa wiadomość z highlightem na kanale który JUŻ MA level=2:

1. `sig_window_hilight()` wysyła activity_update level=2
2. `sig_window_activity()` dostaje old_level=2, data_level=2 → **SKIPUJE**
3. Backend dostaje tylko 1x activity_update → unreadCount++
4. Kolejne wiadomości są skipowane → unreadCount nie rośnie!

**Rozwiązanie:**
Zmieniono logikę deduplikacji - skipuj TYLKO gdy level **SPADA**:

```c
/* Skip if level DECREASED (e.g. from hilight to text) */
/* But ALWAYS send if level stayed same or increased - this counts new messages */
if (data_level < old_level) {
    return;  // Skipuj tylko gdy level spada
}
```

Teraz:

- Nowa wiadomość z highlightem (level=2) → `sig_window_hilight()` + `sig_window_activity()` → **2x activity_update** → unreadCount += 2 ✅
- Kolejna wiadomość z highlightem → znowu 2x → unreadCount += 2 ✅

**Commit:** `53ea76b58` (2025-10-14 15:39:35)

**UWAGA:** To powoduje duplikaty (2x activity_update na wiadomość), ale dzięki temu unreadCount rośnie poprawnie. Alternatywne rozwiązanie: liczyć unread na podstawie liczby wiadomości w bazie, nie liczby activity_update.

### 🐛 Bugfix #6: unreadCount liczony z bazy zamiast increment

**Problem z poprzednim rozwiązaniem (#5):**

- Duplikaty activity_update (2x na wiadomość) powodowały że unreadCount rósł 2x za szybko
- `msg.level` to **POZIOM** aktywności (0-3), NIE liczba wiadomości
- Increment przy każdym activity_update był błędny

**Nowe rozwiązanie:**
Liczyć unread na podstawie **liczby wiadomości w bazie** które są nowsze niż `lastReadTime`:

```typescript
// EncryptedMessageStorage - nowa funkcja
async getUnreadCount(networkUuid: string, channelName: string, lastReadTime: number): Promise<number> {
    const row = await this.serialize_get(
        "SELECT COUNT(*) as count FROM messages WHERE network = ? AND channel = ? AND time > ?",
        networkUuid, channelName.toLowerCase(), lastReadTime
    );
    return row ? row.count : 0;
}

// IrssiClient - handleActivityUpdate()
if (dataLevel === DataLevel.NONE) {
    marker.lastReadTime = Date.now();  // Aktualizuj timestamp
    marker.unreadCount = 0;
} else {
    // Policz z bazy ile wiadomości jest nowszych niż lastReadTime
    const count = await this.messageStorage.getUnreadCount(network.uuid, channel.name, marker.lastReadTime);
    marker.unreadCount = count;  // Prawdziwa liczba!
}
```

**Teraz działa:**

- Każda wiadomość zapisana w bazie z `time > lastReadTime` jest liczona jako unread ✅
- Nie ma znaczenia ile razy irssi wysyła activity_update (duplikaty nie szkodzą) ✅
- unreadCount zawsze pokazuje **prawdziwą liczbę** nieprzeczytanych wiadomości ✅

**Commit:** `2090099b` (2025-10-14 15:45:01)

### 🐛 Bugfix #7: activity_update level=0 nie był broadcastowany

**Problem:**
Gdy user klikał w Vue na kanał:

1. Backend wysyłał `mark_read` do irssi ✅
2. irssi przełączał okno i wysyłał `activity_update level=0` ✅
3. Backend otrzymywał `level=0` i ustawiał `marker.unreadCount = 0` ✅
4. **ALE NIE BROADCASTOWAŁ** do przeglądarek! ❌
5. Badge w Vue **NIE ZNIKAŁ** ❌

**Rozwiązanie:**

```typescript
if (dataLevel === DataLevel.NONE) {
  marker.lastReadTime = Date.now();
  marker.unreadCount = 0;
  this.unreadMarkers.set(key, marker);

  // ✅ DODANO: Broadcast do przeglądarek
  this.broadcastToAllBrowsers("activity_update" as any, {
    chan: channel.id,
    unread: 0,
    highlight: 0,
  });
  return;
}
```

**Teraz działa:**

- User klika w Vue → irssi przełącza okno → wysyła level=0 → backend broadcastuje → badge znika ✅

**Commit:** `5b68d635` (2025-10-14 16:01:49)

### 🐛 Bugfix #8: CRITICAL - fe-web blokował czyszczenie Act: w irssi

**Problem:**
Gdy user przełączał okna w irssi (ESC+nr lub `/window N`):

- W **czystym irssi** (bez fe-web): Act: [2,3,4,5] → numer znika ✅
- Z **załadowanym fe-web**: Act: [2,3,4,5] → **numer NIE ZNIKA** ❌

**Przyczyna:**
Gdy core irssi czyści activity:

1. Core wywołuje `window_activity(window, 0, NULL)` ✅
2. Core ustawia `window->data_level = 0` ✅
3. Core emituje `"window hilight"` signal ✅
4. **fe-web `sig_window_hilight()` jest wywołany** ✅
5. fe-web czyta: `data_level = item->data_level > 0 ? item->data_level : window->data_level;`
6. **PROBLEM**: `item->data_level` może być **JESZCZE NIEZEROWANY** (core zeruje item później) ❌
7. fe-web wysyła `activity_update` z **STARYM LEVELEM** (np. level=2) ❌
8. Backend otrzymuje level=2 → **NIE CZYŚCI** badge ❌
9. **Act: w irssi NIE ZNIKA** bo statusbar czeka na kolejny update ❌

**Rozwiązanie:**
Sprawdzać `window->data_level` zamiast `item->data_level` w `sig_window_hilight()`:

```c
// fe-web-signals.c - sig_window_hilight()
/* CRITICAL FIX: Skip if window->data_level is 0 (being cleared by core) */
if (window->data_level == 0) {
    printtext(NULL, NULL, MSGLEVEL_CLIENTNOTICE,
              "fe-web: Activity HILIGHT SKIPPED (window level=0, being cleared)");
    return;  // ✅ Nie wysyłaj stale activity_update!
}
```

**Teraz działa:**

- User przełącza okno w irssi → core czyści `window->data_level = 0` → fe-web **SKIPUJE** wysyłanie → Act: znika ✅
- User klika w Vue → irssi przełącza okno → Act: znika ✅

**Commit:** `ec5d09d0a` (irssi, 2025-10-14 16:19:31)

### 🐛 Bugfix #9: Command translator - brak translacji kick/ban/invite

**Problem:**
User wpisuje w Vue na kanale `#polska`: `/kick gibi~ test`
Backend wysyła do irssi: `/kick gibi~ test`
irssi odpowiada: `Not joined to any channel` ❌

**Przyczyna:**
irssi wymaga pełnej składni: `/kick #polska gibi~ test` gdy komenda nie jest wykonywana w oknie kanału.

Backend ma `translateCommand()` który tłumaczy `/close` → `/part #channel`, ale **NIE MA** translacji dla:

- `/kick nick reason` → `/kick #channel nick reason`
- `/ban nick` → `/ban #channel nick`
- `/invite nick` → `/invite nick #channel`

**Rozwiązanie:**
Dodano translacje w `translateCommand()`:

```typescript
case "kick":
case "kickban":
    if (channel.type === ChanType.CHANNEL && args.length > 0) {
        return `${command} ${channel.name} ${args.join(" ")}`;
    }
    break;

case "ban":
case "unban":
    if (channel.type === ChanType.CHANNEL && args.length > 0) {
        return `${command} ${channel.name} ${args.join(" ")}`;
    }
    break;

case "invite":
    if (channel.type === ChanType.CHANNEL && args.length === 1) {
        return `invite ${args[0]} ${channel.name}`;
    }
    break;
```

**Teraz działa:**

- User w Vue: `/kick gibi~ test` → Backend: `/kick #polska gibi~ test` → irssi: ✅
- User w Vue: `/ban troll` → Backend: `/ban #polska troll` → irssi: ✅
- User w Vue: `/invite friend` → Backend: `/invite friend #polska` → irssi: ✅

**Commit:** `6e63e763` (2025-10-14 16:23:12)

### 🐛 Bugfix #10: CRITICAL - Act: statusbar nie odświeżał się (numery nie znikały)

**Problem:**
Po bugfix #8 (skipowanie `sig_window_hilight` gdy `window->data_level=0`):

- User klika w Vue → irssi przełącza okno ✅
- Backend otrzymuje `activity_update level=0` ✅
- Badge w Vue znika ✅
- **ALE Act: w irssi statusbar NIE ZNIKA** ❌
- Numery okien zmieniają kolor na zielony ale **NIE ZNIKAJĄ** ❌

**Przyczyna:**
W `mark_read` handler (fe-web-client.c) kod **RĘCZNIE ZEROWAŁ** `window->data_level`:

```c
// ❌ ZŁE - ręczne zerowanie
item->data_level = 0;
window->data_level = 0;
signal_emit("window dehilight", 1, window);
```

**Dlaczego to nie działa:**

1. Ręczne zerowanie `window->data_level` **NIE AKTUALIZUJE** statusbar
2. Core irssi ma funkcję `window_activity(window, 0, NULL)` która:
   - Ustawia `window->data_level = 0` ✅
   - Emituje `"window hilight"` signal ✅
   - **AKTUALIZUJE STATUSBAR** ✅
3. Bez wywołania `window_activity()` statusbar **NIE WIE** że activity zostało wyczyszczone

**Rozwiązanie:**
Użyć `window_activity(window, 0, NULL)` zamiast ręcznego zerowania:

```c
// ✅ DOBRE - używamy core irssi API
window_set_active(window);
window_activity(window, 0, NULL);  // Czyści activity + aktualizuje statusbar
```

**Teraz działa:**

- User klika w Vue → irssi przełącza okno ✅
- `window_activity(window, 0, NULL)` czyści activity ✅
- Statusbar dostaje sygnał i **USUWA NUMER** z Act: ✅
- Backend otrzymuje `activity_update level=0` ✅
- Badge w Vue znika ✅

**Commit:** `d79986590` (irssi, 2025-10-14 16:38:49)

### 🐛 Bugfix #11: Zamykanie kanałów/query nie synchronizowało się między irssi a Vue

**Problem:**

```
User w Vue: Leave channel (#polska)
  ↓
Backend → irssi: /part #polska
  ↓
irssi: Wychodzi z kanału, zamyka okno ✅
  ↓
Vue: Okno kanału NADAL WIDOCZNE ❌
```

**I odwrotnie:**

```
User w irssi: /wc (window close)
  ↓
irssi: Zamyka okno kanału/query ✅
  ↓
Vue: Okno NADAL WIDOCZNE ❌
```

**Przyczyna:**
fe-web **NIE MIAŁ** handlerów dla sygnałów:

- `"window item remove"` - emitowany gdy kanał/query jest usuwany z okna (np. `/wc`, `/part`)
- `"window destroyed"` - emitowany gdy całe okno jest zamykane

**Istniejące handlery były tylko dla INNYCH userów:**

- `"message part"` - gdy **KTOŚ INNY** wychodzi z kanału (otrzymujemy IRC PART message od serwera)
- `"query destroyed"` - gdy query jest niszczony (ale to też dla innych userów)

**Rozwiązanie:**
Dodano nowe handlery w `fe-web-signals.c`:

1. **`sig_window_item_remove()`** - obsługuje `"window item remove"`:

   - Sprawdza czy item to kanał (`IRC_CHANNEL`) czy query (`QUERY`)
   - Dla kanału: wysyła `WEB_MSG_CHANNEL_PART` z `nick = server->nick` (MY wychodzimy)
   - Dla query: wysyła `WEB_MSG_QUERY_CLOSED`

2. **`sig_window_destroyed()`** - obsługuje `"window destroyed"`:
   - Tylko loguje (bo `"window item remove"` jest emitowany PRZED `"window destroyed"` dla każdego item)

**Backend już miał implementację:**

- `handleChannelPart()` sprawdza `if (nick === network.nick)` → usuwa kanał z UI
- `handleQueryClosed()` usuwa query z UI

**Teraz działa:**

```
User w Vue: Leave → /part → irssi zamyka okno → window item remove → channel_part → Vue usuwa kanał ✅
User w irssi: /wc → window item remove → channel_part/query_closed → Vue usuwa kanał/query ✅
User w irssi: /part → IRC PART → window item remove → channel_part → Vue usuwa kanał ✅
```

**Commit:** `a2086894a` (irssi, 2025-10-14 17:06:28)

---

**Data utworzenia:** 2025-10-13
**Ostatnia aktualizacja:** 2025-10-14 17:06
**Status:** Message storage ready, Unread markers FIXED, Command translator FIXED, Act: statusbar FIXED, Window close sync FIXED
