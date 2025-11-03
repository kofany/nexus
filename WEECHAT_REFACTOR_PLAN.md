# WeeChat Relay Bridge - Plan Refaktoryzacji

## Błędne założenie (PRZED):

```
Lith <-> WeeChat Bridge <-> ErssiToWeeChatAdapter <-> IrssiClient <-> erssi
```

- Próbowaliśmy tłumaczyć erssi → WeeChat
- Duplikowaliśmy logikę z IrssiClient
- Nie wykorzystywaliśmy istniejącej infrastruktury

## Prawidłowe podejście (PO):

```
Lith <-> WeeChat Bridge <-> IrssiClient (Node) <-> erssi
Vue  <-> Socket.io      <-> IrssiClient (Node) <-> erssi
```

- **IrssiClient już ma wszystko**: bufory, wiadomości, nicklist, unread/highlight
- **Vue już działa** - musimy tylko nasłuchiwać tych samych eventów
- **Nie tłumaczymy erssi**, tylko **Node → WeeChat**

## Eventy które IrssiClient emituje (i Vue słucha):

### 1. `init` - Początkowy stan

```typescript
{
  networks: SharedNetwork[],  // Zawiera channels z messages!
  token: string,
  active: number
}
```

**WeeChat odpowiednik**: `hdata buffer:gui_buffers(*)`

### 2. `msg` - Nowa wiadomość

```typescript
{
  chan: number,
  msg: Msg,
  unread: number,
  highlight: number
}
```

**WeeChat odpowiednik**: `_buffer_line_added`

### 3. `names` - Nicklist

```typescript
{
  id: number,
  users: User[]
}
```

**WeeChat odpowiednik**: `_nicklist` lub `_nicklist_diff`

### 4. `join` - Nowy kanał

```typescript
{
  network: string,
  chan: SharedNetworkChan,
  index: number,
  shouldOpen: boolean
}
```

**WeeChat odpowiednik**: `_buffer_opened`

### 5. `part` - Zamknięcie kanału

```typescript
{
  chan: number;
}
```

**WeeChat odpowiednik**: `_buffer_closing`

### 6. `activity_update` - Zmiana unread/highlight

```typescript
{
  chan: number,
  unread: number,
  highlight: number
}
```

**WeeChat odpowiednik**: Hotlist update

### 7. `topic` - Zmiana topicu

```typescript
{
  chan: number,
  topic: string
}
```

**WeeChat odpowiednik**: `_buffer_title_changed`

## Nowa architektura klas:

### 1. `NodeToWeeChatAdapter` (nowa nazwa dla ErssiToWeeChatAdapter)

- Słucha eventów z IrssiClient (tak jak Vue)
- Tłumaczy na WeeChat Relay protocol
- Nie duplikuje logiki - używa danych z IrssiClient

### 2. `WeeChatRelayClient` (bez zmian)

- Obsługuje połączenie TCP/WebSocket
- Parsuje komendy TEXT protocol
- Wysyła wiadomości BINARY protocol

### 3. `WeeChatCommandHandler` (nowa nazwa dla WeeChatToErssiAdapter)

- Obsługuje komendy od Lith (hdata, input, sync, etc.)
- Przekazuje do IrssiClient (tak jak Vue)

## Plan implementacji:

### Faza 1: Refaktoryzacja nazw ✅

1. Zmienić `ErssiToWeeChatAdapter` → `NodeToWeeChatAdapter`
2. Zmienić `WeeChatToErssiAdapter` → `WeeChatCommandHandler`
3. Usunąć duplikaty logiki

### Faza 2: Podłączenie do IrssiClient eventów

1. Słuchać `msg` → wysyłać `_buffer_line_added`
2. Słuchać `names` → wysyłać `_nicklist` lub `_nicklist_diff`
3. Słuchać `join` → wysyłać `_buffer_opened`
4. Słuchać `part` → wysyłać `_buffer_closing`
5. Słuchać `topic` → wysyłać `_buffer_title_changed`

### Faza 3: Hotlist (activity tracking)

1. Śledzić `activity_update` z IrssiClient
2. Budować hotlist z `Chan.unread` i `Chan.highlight`
3. Wysyłać hotlist updates do Lith

### Faza 4: Nicklist z grupami

1. Używać `Chan.users` z IrssiClient
2. Grupować po `User.mode` (ops, voices, regular)
3. Wysyłać w formacie WeeChat (root + groups + users)

## Kluczowe zmiany w kodzie:

### PRZED (błędne):

```typescript
// Duplikujemy logikę z IrssiClient
private buffers: Map<string, WeeChatBuffer> = new Map();
private getOrCreateBuffer(network, channel) { ... }
```

### PO (prawidłowe):

```typescript
// Używamy danych z IrssiClient
private irssiClient: IrssiClient;

// Słuchamy eventów
this.irssiClient.on("msg", (data) => {
  this.sendLineAdded(data);
});
```

## Korzyści:

1. **Brak duplikacji** - jedna źródło prawdy (IrssiClient)
2. **Mniej kodu** - nie tworzymy własnych buforów
3. **Spójność** - Vue i Lith widzą te same dane
4. **Łatwiejsze utrzymanie** - zmiany w IrssiClient automatycznie działają dla Lith
5. **Hotlist działa** - używamy `Chan.unread` i `Chan.highlight` które już działają dla Vue

---

## Status implementacji (2025-11-01)

### ✅ Zrobione:

1. **Refaktoryzacja `ErssiToWeeChatAdapter`**:

   - Usunięto duplikację buforów (`buffers`, `bufferPointers`)
   - Dodano event handlery dla wszystkich eventów z IrssiClient
   - `buildBuffersHData()` używa danych z `IrssiClient.networks`
   - `buildLinesHData()` używa danych z `IrssiClient.networks`
   - Dodano `getBufferPointer()` - używa `channel.id` jako pointer
   - Dodano `findChannel()` - znajduje channel po ID

2. **Aktualizacja `WeeChatToErssiAdapter`**:
   - Zaktualizowano `setupErssiAdapterHandlers()` aby słuchał nowych eventów
   - Dodano handlery dla: `buffer_opened`, `buffer_closing`, `buffer_line_added`, `nicklist_diff`, `buffer_title_changed`, `hotlist_changed`

### 🚧 Do zrobienia:

1. **Aktualizacja metod wysyłających w `WeeChatToErssiAdapter`**:

   - `sendBufferOpened(data)` - zmienić sygnaturę z `(buffer)` na `(data)`
   - `sendBufferClosed(data)` - zmienić sygnaturę
   - `sendLineAdded(data)` - zmienić sygnaturę z `(buffer, msg)` na `(data)`
   - `sendNicklistChanged()` → `sendNicklistDiff(data)` - zmienić nazwę i sygnaturę
   - Dodać `sendBufferTitleChanged(data)` - nowa metoda
   - Dodać `sendHotlistChanged(data)` - nowa metoda

2. **Podłączenie eventów z IrssiClient**:

   - Obecnie `ErssiToWeeChatAdapter` ma handlery, ale nie są one wywoływane
   - Musimy podłączyć się do `IrssiClient.broadcastToAllBrowsers()` lub stworzyć mechanizm "virtual browser"
   - Opcja 1: Dodać `weechatClients: Set<ErssiToWeeChatAdapter>` w IrssiClient
   - Opcja 2: Stworzyć "virtual socket" który emituje eventy do adaptera

3. **Nicklist z grupami**:

   - Zaimplementować `buildNicklistWithGroups()` w `WeeChatToErssiAdapter`
   - Grupować użytkowników po `User.mode` (ops, voices, regular)
   - Wysyłać w formacie WeeChat (root + groups + users)

4. **Hotlist (activity tracking)**:

   - Implementować `buildHotlistHData()` w `ErssiToWeeChatAdapter`
   - Używać `Chan.unread` i `Chan.highlight` z IrssiClient
   - Wysyłać hotlist updates przy każdej zmianie

5. **Testowanie**:
   - Przetestować z Lith na iPhone
   - Sprawdzić czy wszystkie funkcje działają (nicklist, hotlist, eventy)
   - Porównać z Vue frontend

### 📝 Następne kroki:

1. Zaktualizować metody `send*()` w `WeeChatToErssiAdapter` aby używały nowego formatu danych
2. Podłączyć eventy z IrssiClient do `ErssiToWeeChatAdapter`
3. Zaimplementować nicklist z grupami
4. Zaimplementować hotlist
5. Przetestować z Lith
