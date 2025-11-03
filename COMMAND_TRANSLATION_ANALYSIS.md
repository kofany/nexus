# Analiza komend Vue → irssi - Command Translation Layer

## Problem

Frontend Vue wysyła komendy IRC przez `socket.emit("input", {target: channelId, text: "/command"})`, ale wiele z tych komend nie jest obsługiwanych przez irssi lub wymaga dodatkowej logiki translacji.

## Komendy wykryte w kodzie Vue

### 1. Client-side commands (nie trafiają do serwera)

**Lokalizacja:** `client/js/commands/index.ts`

- `/collapse` - zwija podglądy
- `/expand` - rozwija podglądy
- `/join` - otwiera dialog join (nie wysyła do serwera!)
- `/search` - otwiera dialog search

### 2. Commands wysyłane do backendu przez contextMenu.ts

#### Lobby (sieć):

```typescript
socket.emit("input", {target: channel.id, text: "/list"});
socket.emit("input", {target: channel.id, text: "/ignorelist"});
socket.emit("input", {target: channel.id, text: "/disconnect"});
socket.emit("input", {target: channel.id, text: "/connect"});
```

#### Channel:

```typescript
socket.emit("input", {target: channel.id, text: "/banlist"}); // ❌ NIE DZIAŁA W IRSSI!
```

#### Query:

```typescript
socket.emit("input", {target: channel.id, text: "/whois " + nick});
socket.emit("input", {target: channel.id, text: "/ignore " + nick});
```

#### User actions:

```typescript
socket.emit("input", {target: channel.id, text: "/query " + nick});
socket.emit("input", {target: channel.id, text: "/mode +o " + nick});
socket.emit("input", {target: channel.id, text: "/kick " + nick});
```

### 3. Commands z use-close-channel.ts

```typescript
// Zamknięcie sieci (lobby)
socket.emit("input", {target: channel.id, text: "/quit"}); // ❌ TRZEBA SPECJALNIE OBSŁUŻYĆ!

// Zamknięcie kanału/query
socket.emit("input", {target: channel.id, text: "/close"}); // ❌ NIE DZIAŁA W IRSSI!
```

## Komendy wymagające translacji

### Kategoria 1: Komendy nieobsługiwane przez irssi

#### `/close` → wymaga translacji

**Problem:** irssi nie rozumie `/close`
**Rozwiązanie:**

- Dla kanału: `/part #channel` → wyślij do irssi
- Dla query: wyślij `close_query` do irssi (już zaimplementowane w fe-web-client.c:166)
- Backend musi wywołać odpowiednie metody

**Implementacja:**

```typescript
// Backend: irssiClient.ts
if (command === "close") {
  if (channel.type === ChanType.CHANNEL) {
    // Send /part to IRC
    await this.irssiConnection.executeCommand(`part ${channel.name}`, network.serverTag);
  } else if (channel.type === ChanType.QUERY) {
    // Send close_query to irssi
    this.irssiConnection.send({
      type: "close_query",
      server: network.serverTag,
      nick: channel.name,
    });
  }
  return; // Don't forward original /close
}
```

#### `/banlist` → tłumacz na `/mode #channel +b`

**Problem:** irssi nie ma komendy `/banlist`
**Rozwiązanie:**

```typescript
// Backend: irssiClient.ts
if (command === "banlist") {
  await this.irssiConnection.executeCommand(`mode ${channel.name} +b`, network.serverTag);
  return; // Don't forward /banlist
}
```

#### `/quit` → specjalna obsługa

**Problem:** `/quit` w lobby powinien rozłączyć sieć w irssi (nie zamykać całego irssi!)
**Rozwiązanie:**

```typescript
// Backend: irssiClient.ts
if (command === "quit" && channel.type === ChanType.LOBBY) {
  // Send /disconnect for this server in irssi
  await this.irssiConnection.executeCommand(`disconnect ${network.serverTag}`, "*");
  // Note: irssi will send server_status with connected=false
  return; // Don't forward /quit
}
```

### Kategoria 2: Synchronizacja 2-kierunkowa

#### Query close (zamknięcie okna query)

**Aktualny stan:**

- ✅ Frontend → Backend → irssi: działa (close_query)
- ❌ irssi → Backend → Frontend: brak

**Problem:** Gdy w irssi zamknę query (`/unquery nick`), frontend nie wie o tym

**Rozwiązanie:**

- irssi już wysyła `WEB_MSG_QUERY_CLOSED` (fe-web-signals.c)
- Backend musi obsłużyć to zdarzenie i wysłać `part` do frontendu

**Implementacja:**

```typescript
// Backend: setupIrssiEventHandlers()
(this.irssiConnection as any).on("query_closed", (msg: FeWebMessage) => {
    this.handleQueryClosed(msg);
});

private handleQueryClosed(msg: FeWebMessage): void {
    const serverTag = msg.server || msg.server_tag;
    const nick = msg.nick;

    // Find network and query
    const network = this.networks.find(n => n.serverTag === serverTag);
    if (!network) return;

    const query = network.channels.find(c =>
        c.type === ChanType.QUERY &&
        c.name.toLowerCase() === nick.toLowerCase()
    );

    if (query) {
        // Remove from network
        const index = network.channels.indexOf(query);
        network.channels.splice(index, 1);

        // Broadcast to all browsers
        this.broadcastToAllBrowsers("part", {
            chan: query.id
        });
    }
}
```

#### Channel part (opuszczenie kanału)

**Aktualny stan:**

- ✅ irssi → Backend → Frontend: działa (channel_part)
- ✅ Frontend → Backend → irssi: działa (/part)

**Problem:** Frontend wysyła `/close` zamiast `/part` dla kanałów!

**Rozwiązanie:** Tłumaczenie w command translator (patrz `/close` wyżej)

## Architektura rozwiązania

### Opcja 1: Command Translator w handleInput()

**Zalety:**

- Centralne miejsce dla wszystkich tłumaczeń
- Łatwe dodawanie nowych komend
- Możliwość logowania/debugowania

**Wady:**

- Wymaga parsowania każdej komendy

**Implementacja:**

```typescript
// irssiClient.ts - rozszerz handleInput()
async handleInput(socketId: string, data: {target: number; text: string}): Promise<void> {
    const text = data.text;

    // Check if it's a command
    if (text.charAt(0) === "/" && text.charAt(1) !== "/") {
        const parts = text.substring(1).split(" ");
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        // Find channel and network
        let channel: Chan | undefined;
        let network: NetworkData | undefined;
        for (const net of this.networks) {
            channel = net.channels.find((c) => c.id === data.target);
            if (channel) {
                network = net;
                break;
            }
        }

        if (!channel || !network) {
            log.warn(`Channel ${data.target} not found`);
            return;
        }

        // Command translation layer
        const translated = await this.translateCommand(command, args, channel, network);
        if (translated === false) {
            return; // Command was handled, don't forward
        }

        // If translated to new command, use it
        const finalText = translated || text;

        // Forward to irssi...
    }
}

private async translateCommand(
    command: string,
    args: string[],
    channel: Chan,
    network: NetworkData
): Promise<string | false> {
    switch (command) {
        case "close":
            if (channel.type === ChanType.CHANNEL) {
                return `/part ${channel.name}`;
            } else if (channel.type === ChanType.QUERY) {
                this.irssiConnection?.send({
                    type: "close_query",
                    server: network.serverTag,
                    nick: channel.name
                });
                return false; // Handled
            }
            break;

        case "banlist":
            return `/mode ${channel.name} +b`;

        case "quit":
            if (channel.type === ChanType.LOBBY) {
                return `/disconnect ${network.serverTag}`;
            }
            break;
    }

    return null; // No translation, use original
}
```

### Opcja 2: Uniwersalny translator z konfiguracją

**Zalety:**

- Łatwe dodawanie nowych komend bez kodu
- Możliwość konfiguracji przez JSON

**Wady:**

- Trudniejsze dla złożonych translacji (np. /close wymaga logiki)
- Mniej czytelne dla programistów

**Nie polecam** - zbyt skomplikowane dla obecnych potrzeb.

## Rekomendowane rozwiązanie

### Command Translator (Opcja 1) + Query sync

**Kroki implementacji:**

1. **Rozszerz handleInput() w irssiClient.ts:**

   - Dodaj `translateCommand()` method
   - Obsłuż `/close`, `/banlist`, `/quit`

2. **Dodaj obsługę query_closed:**

   - Zarejestruj handler w `setupIrssiEventHandlers()`
   - Implementuj `handleQueryClosed()`

3. **Test wszystkich komend:**
   - `/close` dla kanału → `/part`
   - `/close` dla query → `close_query`
   - `/banlist` → `/mode #chan +b`
   - `/quit` w lobby → `/disconnect`
   - Query close w irssi → close w Vue

## Komendy NIE wymagające translacji (działają OK)

✅ `/list` - irssi rozumie
✅ `/ignorelist` - irssi rozumie
✅ `/disconnect` - irssi rozumie
✅ `/connect` - irssi rozumie
✅ `/whois` - irssi rozumie
✅ `/ignore` - irssi rozumie
✅ `/query` - irssi rozumie
✅ `/mode` - irssi rozumie
✅ `/kick` - irssi rozumie
✅ `/part` - irssi rozumie (ale frontend wysyła `/close`!)

## Wnioski

**Najlepsze rozwiązanie:** Command Translator Layer w `handleInput()` z hardcoded translations dla problematycznych komend. To daje:

1. ✅ Pełną kontrolę nad tłumaczeniem
2. ✅ Możliwość dodania logiki (np. różne zachowanie dla channel vs query)
3. ✅ Łatwe debugowanie i logowanie
4. ✅ Jasny kod bez magic strings w JSON

**Dodatkowe wymaganie:** 2-way sync dla query close (irssi → frontend)
