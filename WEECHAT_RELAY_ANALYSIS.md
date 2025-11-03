# WeeChat Relay Bridge - Analiza i Plan Naprawy

## Co już działa ✅

1. **Podstawowa komunikacja**

   - Połączenie TCP/WebSocket
   - Handshake i autentykacja (init)
   - Parsowanie komend TEXT protocol
   - Wysyłanie wiadomości BINARY protocol

2. **Bufory**

   - Lista buforów (hdata buffer:gui_buffers)
   - Historia wiadomości (hdata lines)
   - Wysyłanie wiadomości (input)
   - Odbieranie wiadomości (\_buffer_line_added)

3. **Podstawowy nicklist**
   - Komenda nicklist zwraca użytkowników
   - Podstawowe prefiksy (@, +)

## Co nie działa ❌

### 1. **Nicklist - brak grup**

**Problem**: Lith nie widzi nicklist bo wysyłamy tylko użytkowników bez grup.

**Zgodnie z dokumentacją WeeChat**:

- Nicklist musi zawierać **grupy** (root, ops, voices, users)
- Każdy user musi być w grupie
- Format: `_diff: '^'` (parent group), `_diff: '+'` (add user)

**Przykład z dokumentacji**:

```
item 1: group=1, name='root', level=0
item 2: group=1, name='000|o', level=1  (ops group)
item 3: group=0, name='FlashCode', prefix='@'  (user in ops)
item 4: group=1, name='999|...', level=1  (users group)
item 5: group=0, name='test', prefix=' '  (user in users)
```

**Co musimy zrobić**:

- Dodać grupy do nicklist (root, ops, voices, users)
- Wysyłać `_nicklist_diff` z `_diff: '^'` dla grup
- Poprawnie mapować mode (o, v) na grupy

### 2. **Eventy - brak synchronizacji**

**Problem**: Nie wszystkie eventy z IrssiClient są przekazywane do WeeChat clients.

**Brakujące eventy**:

- `_buffer_opened` - nowy kanał/query
- `_buffer_closing` - zamykanie kanału
- `_buffer_title_changed` - zmiana topicu
- `_buffer_renamed` - zmiana nazwy
- `_nicklist_diff` - zmiany w nicklist (join, part, mode)

**Co musimy zrobić**:

- Podłączyć IrssiClient eventy do ErssiToWeeChatAdapter
- Emitować odpowiednie eventy WeeChat

### 3. **Hotlist - brak activity tracking**

**Problem**: Lith nie pokazuje unread/highlight markers.

**Zgodnie z dokumentacją WeeChat**:

- Hotlist to lista buforów z aktywnością
- Format: `priority` (0-3), `count` (array[4]), `buffer_id`
- Priority: 0=join/part, 1=message, 2=private, 3=highlight

**Co musimy zrobić**:

- Implementować `hdata hotlist:gui_hotlist(*)`
- Śledzić unread/highlight per buffer
- Wysyłać hotlist updates
- Obsługiwać mark as read

### 4. **Sync - niepełna implementacja**

**Problem**: Sync nie obsługuje wszystkich flag.

**Zgodnie z dokumentacją**:

- `sync * buffer,nicklist` - sync all buffers + nicklist
- `sync 0x123 buffer` - sync specific buffer
- Flagi: `buffer`, `nicklist`, `buffers`

**Co musimy zrobić**:

- Parsować flagi sync
- Wysyłać odpowiednie eventy tylko dla zsynchronizowanych buforów

## Plan naprawy

### Faza 1: Nicklist z grupami

1. Zmodyfikować `handleNicklist()` w `weechatToErssiAdapter.ts`
2. Dodać funkcję `buildNicklistGroups()`
3. Wysyłać grupy + użytkowników w poprawnej kolejności

### Faza 2: Eventy

1. Dodać event handlers w `IrssiClient`
2. Emitować eventy w `ErssiToWeeChatAdapter`
3. Obsłużyć w `WeeChatToErssiAdapter`

### Faza 3: Hotlist

1. Dodać `hotlistData` w `ErssiToWeeChatAdapter`
2. Śledzić unread/highlight z `Chan.unread` i `Chan.highlight`
3. Implementować `hdata hotlist:gui_hotlist(*)`
4. Wysyłać hotlist updates

### Faza 4: Testowanie

1. Przetestować z Lith wszystkie funkcje
2. Porównać z Vue frontend
3. Naprawić bugi

## Szczegóły implementacji

### Nicklist z grupami (przykład)

```typescript
// Root group
msg.addPointer(bufferPtr);
msg.addPointer(rootGroupPtr);
msg.addChar(94); // '^' = parent
msg.addChar(1); // group
msg.addChar(1); // visible
msg.addInt(0); // level
msg.addString("root");
msg.addString("");
msg.addString("");
msg.addString("");

// Ops group
msg.addPointer(bufferPtr);
msg.addPointer(opsGroupPtr);
msg.addChar(43); // '+' = add
msg.addChar(1); // group
msg.addChar(1); // visible
msg.addInt(1); // level
msg.addString("000|o");
msg.addString("weechat.color.nicklist_group");
msg.addString("");
msg.addString("");

// User in ops
msg.addPointer(bufferPtr);
msg.addPointer(userPtr);
msg.addChar(43); // '+' = add
msg.addChar(0); // nick
msg.addChar(1); // visible
msg.addInt(0); // level
msg.addString("FlashCode");
msg.addString("142");
msg.addString("@");
msg.addString("lightgreen");
```

### Hotlist (przykład)

```typescript
// Build hotlist HData
const fields: HDataField[] = [
  {name: "priority", type: "int"},
  {name: "time", type: "tim"},
  {name: "time_usec", type: "int"},
  {name: "buffer", type: "ptr"},
  {name: "count", type: "arr", arrayType: "int"},
];

const objects: HDataObject[] = [];
for (const buffer of this.buffers.values()) {
  if (buffer.unread > 0 || buffer.highlight > 0) {
    const priority = buffer.highlight > 0 ? 3 : 1;
    objects.push({
      pointers: [hotlistPtr],
      values: {
        priority,
        time: Math.floor(Date.now() / 1000),
        time_usec: 0,
        buffer: buffer.pointer,
        count: [0, buffer.unread, 0, buffer.highlight],
      },
    });
  }
}
```
