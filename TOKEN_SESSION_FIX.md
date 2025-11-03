# Fix: Token sesji wysyłany w payload init (nie osobny event)

## Problem

Po zalogowaniu do The Lounge, gdy irssi websocket był niedostępny:

- ✅ `user` trafiał do localStorage (w SignIn.vue)
- ❌ `token` NIE trafiał do localStorage
- ❌ Po odświeżeniu strony trzeba było logować się ponownie

## Przyczyna

**Token był wysyłany jako osobny event `socket.emit("token")`, ale oryginalny The Lounge wysyła token W PAYLOAD eventu `init`!**

### Oryginalny The Lounge (standardowy Client):

```typescript
// server/server.ts - initializeClient():
const sendInitEvent = (tokenToSend?: string) => {
    socket.emit("init", {
        active: openChannel,
        networks: client.networks.map(...),
        token: tokenToSend,  // ← TOKEN W PAYLOAD!
    });
};

// client/js/socket-events/init.ts:
socket.on("init", async function (data) {
    if (data.token) {
        storage.set("token", data.token);  // ← Zapisuje z payload
    }
    // ...
});
```

### Nasz kod (IrssiClient) - PRZED fixem:

```typescript
// server/server.ts - initializeIrssiClient():
client.attachBrowser(socket, openChannel); // Wysyła init BEZ tokenu
socket.emit("token", newToken); // Osobny event (nie działa!)

// server/irssiClient.ts - attachBrowser():
socket.emit("init", {
  networks: [],
  active: -1,
  // BRAK TOKEN!
});
```

Handler `socket.on("token")` istniał, ale był ignorowany przez klienta gdy przekierowywał do Settings.

## Rozwiązanie

**Token musi być w payload eventu `init`, tak jak w oryginalnym The Lounge.**

### Zmiany:

#### 1. server/server.ts - initializeIrssiClient():

```typescript
const continueInit = (tokenToSend?: string) => {
  // Przekaż token do attachBrowser
  client.attachBrowser(socket, openChannel, tokenToSend);
  socket.emit("commands", inputs.getCommands());
};

if (!Config.values.public) {
  client.generateToken((newToken) => {
    const tokenHash = client.calculateTokenHash(newToken);
    client.updateSession(tokenHash, getClientIp(socket), socket.request);
    continueInit(newToken); // Przekaż token
  });
} else {
  continueInit();
}
```

#### 2. server/irssiClient.ts - attachBrowser():

```typescript
attachBrowser(socket: Socket, openChannel: number = -1, token?: string): void {
    // ...
    if (this.networks.length > 0) {
        void this.sendInitialState(socket, token);  // Przekaż token
    } else {
        socket.emit("init", {
            networks: [],
            active: -1,
            token: token,  // ← TOKEN W PAYLOAD!
        });
    }
}
```

#### 3. server/irssiClient.ts - sendInitialState():

```typescript
private async sendInitialState(socket: Socket, token?: string): Promise<void> {
    // ...
    socket.emit("init", {
        networks: sharedNetworks,
        active: this.lastActiveChannel || -1,
        token: token,  // ← TOKEN W PAYLOAD!
    });
}
```

#### 4. client/js/socket-events/init.ts:

```typescript
socket.on("init", async function (data) {
  console.log("[INIT] Received init event");
  console.log("[INIT] data.token present:", !!data.token);

  // ZAPISZ TOKEN (The Lounge auth, niezależnie od irssi)
  if (data.token) {
    storage.set("token", data.token);
    console.log("[INIT] Token saved to localStorage");
  }

  store.commit("networks", mergeNetworkData(data.networks));
  // ...
});
```

## Kluczowe zasady

1. **Token ZAWSZE w payload `init`** - tak samo jak oryginalny The Lounge
2. **Token generowany PRZED attachBrowser** - callback crypto.randomBytes musi wywołać attachBrowser
3. **Token przekazywany przez wszystkie warstwy**: initializeIrssiClient → attachBrowser → sendInitialState
4. **Token zapisywany w init handler** - na samym początku, przed jakąkolwiek logiką

## Test

```bash
npm run build
npm start
```

1. Zaloguj się (bez irssi websocket)
2. Sprawdź w konsoli przeglądarki:
   ```
   [INIT] Received init event
   [INIT] data.token present: true
   [INIT] Token saved to localStorage
   ```
3. Sprawdź localStorage:
   ```javascript
   localStorage.getItem("user"); // "kfn"
   localStorage.getItem("token"); // długi hex string (128 znaków)
   ```
4. Odśwież stronę (F5) - **NIE wymaga ponownego logowania!**

## Pliki zmienione

1. `server/server.ts` - initializeIrssiClient() przekazuje token do attachBrowser
2. `server/irssiClient.ts` - attachBrowser() i sendInitialState() dodają token do payload init
3. `client/js/socket-events/init.ts` - zapisuje token z data.token
4. `client/js/socket-events/token.ts` - usunięte logi (nieużywany handler)

## Wnioski

**Autentykacja The Lounge jest w 100% niezależna od połączenia z irssi.**

- Token jest ZAWSZE wysyłany w payload `init`
- Format zgodny z oryginalnym The Lounge
- Fast auth działa bez względu na stan irssi websocket

## Problem

Po zalogowaniu do The Lounge, gdy irssi websocket był niedostępny:

- ✅ `user` trafiał do localStorage
- ❌ `token` NIE trafiał do localStorage
- ❌ Po odświeżeniu strony trzeba było logować się ponownie

## Przyczyna

**Token (autentykacja The Lounge) był uzależniony od połączenia z irssi websocket.**

### Przepływ PRZED fixem:

```
SERWER (initializeIrssiClient):
1. socket.emit("auth:success")        ✅
2. client.attachBrowser(socket)       ✅ → wysyła init NATYCHMIAST
   └─> socket.emit("init", {...})     ✅
3. socket.emit("commands", ...)       ✅
4. client.generateToken((newToken) => {   ❌ ASYNCHRONICZNE!
     socket.emit("token", newToken)       ❌ Za późno!
   })

KLIENT:
1. Otrzymuje init
2. Widzi brak irssi connection + brak networks
3. Przekierowuje do Settings
4. Token przychodził PÓŹNIEJ (lub wcale)
```

### Problem z crypto.randomBytes

`client.generateToken()` używa `crypto.randomBytes()` który jest **asynchroniczny**:

```typescript
generateToken(callback: (token: string) => void): void {
    crypto.randomBytes(64, (err, buf) => {
        if (err) throw err;
        callback(buf.toString("hex"));
    });
}
```

Event `token` był wysyłany w callback'u, **PO** wysłaniu `init`.

## Rozwiązanie

**Token musi być wysłany PRZED init**, niezależnie od stanu połączenia z irssi.

### Zmiana w server/server.ts (initializeIrssiClient):

```typescript
// PRZED:
client.attachBrowser(socket, openChannel); // wysyła init
socket.emit("commands", inputs.getCommands());
client.generateToken((newToken) => {
  socket.emit("token", newToken); // Za późno!
});

// PO:
const continueInit = () => {
  client.attachBrowser(socket, openChannel);
  socket.emit("commands", inputs.getCommands());
};

if (!Config.values.public) {
  client.generateToken((newToken) => {
    const tokenHash = client.calculateTokenHash(newToken);
    client.updateSession(tokenHash, getClientIp(socket), socket.request);
    socket.emit("token", newToken); // Najpierw token
    continueInit(); // Potem init
  });
} else {
  continueInit();
}
```

### Przepływ PO fixie:

```
SERWER (initializeIrssiClient):
1. socket.emit("auth:success")        ✅
2. client.generateToken((newToken) => {
     socket.emit("token", newToken)   ✅ NAJPIERW token!
     client.attachBrowser(socket)     ✅ POTEM init
     socket.emit("commands", ...)     ✅
   })

KLIENT:
1. Otrzymuje token → zapisuje do localStorage  ✅
2. Otrzymuje init → może przekierować do Settings ✅
3. Po odświeżeniu: ma user + token → fast auth działa ✅
```

## Testy

### Test 1: Logowanie gdy irssi niedostępny

1. Wyloguj się z The Lounge
2. Zatrzymaj irssi websocket
3. Zaloguj się (user + hasło)
4. **Oczekiwany rezultat:**
   - Przekierowanie do Settings
   - localStorage zawiera `user` i `token`
5. Odśwież stronę (F5)
6. **Oczekiwany rezultat:**
   - Nie wymaga ponownego logowania
   - Fast auth z tokenem działa
   - Przekierowanie do Settings (bo irssi niedostępny)

### Test 2: Logowanie gdy irssi dostępny

1. Wyloguj się
2. Upewnij się że irssi działa
3. Zaloguj się
4. **Oczekiwany rezultat:**
   - Przekierowanie do chatu
   - localStorage zawiera `user` i `token`
   - Widoczne sieci i kanały

### Weryfikacja w konsoli przeglądarki:

```javascript
// Sprawdź localStorage:
localStorage.getItem("user"); // powinien być username
localStorage.getItem("token"); // powinien być długi hex string

// Logi diagnostyczne:
// [TOKEN] Received token from server, saving to localStorage
// [TOKEN] Token saved, verification: SUCCESS
// [INIT] Received init event, irssi status: {...}
// [INIT] Current localStorage - user: kfn, token: present
```

## Wnioski

**Autentykacja The Lounge jest teraz w 100% niezależna od połączenia z irssi websocket.**

- Token sesji jest generowany i zapisywany ZAWSZE po zalogowaniu
- Stan połączenia z irssi wpływa tylko na dostępność sieci IRC
- User może zalogować się do The Lounge i skonfigurować irssi w Settings
- Fast auth działa niezależnie od stanu irssi

## Pliki zmienione

1. `server/server.ts` - zmiana kolejności w `initializeIrssiClient()`
2. `client/js/socket-events/token.ts` - dodane logi diagnostyczne
3. `client/js/socket-events/init.ts` - dodane logi diagnostyczne

## Związane problemy

- Session storage (sessionStorage) NIE jest używany w tej aplikacji
- Używamy tylko localStorage dla persistentnego storage
- Token jest zawsze generowany przy każdym logowaniu (nie reused)
