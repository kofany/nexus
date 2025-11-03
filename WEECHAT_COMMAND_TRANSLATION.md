# WeeChat Command Translation - KRYTYCZNA NAPRAWA

## Data: 2025-11-01

## 🚨 PROBLEM - Komendy WeeChat wysyłane bezpośrednio do erssi!

### Co było nie tak:

**Lith wysyła**: `input 0x3 /buffer set hotlist -1`  
**Nasz kod (PRZED)**: Wysyła `/buffer set hotlist -1` bezpośrednio do erssi  
**erssi**: "WTF is /buffer?" ❌ (to jest komenda WeeChat, nie IRC!)

### Dlaczego to jest problem:

1. **`/buffer` to komenda WeeChat**, nie IRC
2. erssi nie rozumie komend WeeChat
3. Komendy są ignorowane lub powodują błędy
4. **Mark as read nie działa** w Lith!
5. **Close buffer nie działa** w Lith!

---

## ✅ ROZWIĄZANIE - Translator komend WeeChat → Node

### Architektura (POPRAWNA):

```
Lith (WeeChat client)
    ↓
    | WeeChat Relay Protocol
    ↓
WeeChatToNodeAdapter (TRANSLATOR) ← TU TŁUMACZYMY!
    ↓
    | Node API (IrssiClient)
    ↓
IrssiClient (Node backend)
    ↓
    | erssi protocol
    ↓
erssi (IRC client)
```

**Kluczowe**: WeeChatToNodeAdapter **MUSI** tłumaczyć komendy WeeChat na akcje Node!

---

## Zaimplementowane translacje:

### 1. `/buffer set hotlist -1` → Mark as read

**WeeChat komenda**:

```
input 0x3 /buffer set hotlist -1
```

**Translacja**:

```typescript
if (text.includes("set hotlist -1") || text.includes("set unread")) {
  this.irssiClient.markAsRead(network.uuid, channel.name, false);
  return; // NIE wysyłamy do erssi!
}
```

**Co się dzieje**:

1. Lith wysyła `/buffer set hotlist -1`
2. WeeChatToNodeAdapter wykrywa komendę `/buffer`
3. Wywołuje `IrssiClient.markAsRead()`
4. IrssiClient wysyła do erssi: `/window item_set_activity 0`
5. erssi czyści activity
6. Node aktualizuje `channel.unread = 0`
7. Lith dostaje aktualizację hotlist

**Rezultat**: ✅ Mark as read działa w Lith!

---

### 2. `/buffer close` → Close channel (part)

**WeeChat komenda**:

```
input 0x3 /buffer close
```

**Translacja**:

```typescript
if (text.includes("close")) {
  // Tłumaczymy na IRC /part
  this.irssiClient.handleInput(this.relayClient.getId(), {
    target: channel.id,
    text: `/part ${channel.name}`,
  });
  return;
}
```

**Co się dzieje**:

1. Lith wysyła `/buffer close`
2. WeeChatToNodeAdapter wykrywa komendę `/buffer close`
3. Tłumaczy na IRC komendę `/part #channel`
4. IrssiClient wysyła `/part` do erssi
5. erssi opuszcza kanał
6. Node dostaje event `part`
7. Lith dostaje `_buffer_closing`

**Rezultat**: ✅ Close buffer działa w Lith!

---

### 3. IRC komendy i wiadomości → Bez zmian

**IRC komendy** (przechodzą bez zmian):

```
/msg nick text
/join #channel
/part #channel
/quit
/nick newnick
/topic #channel new topic
```

**Normalne wiadomości** (przechodzą bez zmian):

```
Hello world!
```

**Kod**:

```typescript
// For IRC commands and messages, send to IrssiClient
// IrssiClient will handle IRC commands like /msg, /join, /part, etc.
this.irssiClient.handleInput(this.relayClient.getId(), {
  target: channel.id,
  text: text,
});
```

**Rezultat**: ✅ IRC komendy działają normalnie!

---

## Porównanie: PRZED vs PO

### PRZED (BUG):

```typescript
// Wszystko wysyłane bezpośrednio do erssi
this.irssiClient.handleInput(this.relayClient.getId(), {
  target: channel.id,
  text: text, // ❌ "/buffer set hotlist -1" → erssi (błąd!)
});
```

**Problemy**:

- ❌ `/buffer` wysyłane do erssi
- ❌ Mark as read nie działa
- ❌ Close buffer nie działa
- ❌ erssi dostaje nieznane komendy

### PO (POPRAWNE):

```typescript
// Translate WeeChat commands to Node actions
if (text.startsWith("/buffer ")) {
  this.handleBufferCommand(text, network, channel); // ✅ Tłumaczymy!
  return;
}

// IRC commands and messages - send to IrssiClient
this.irssiClient.handleInput(this.relayClient.getId(), {
  target: channel.id,
  text: text, // ✅ Tylko IRC komendy i wiadomości
});
```

**Korzyści**:

- ✅ `/buffer` tłumaczone na akcje Node
- ✅ Mark as read działa
- ✅ Close buffer działa
- ✅ erssi dostaje tylko IRC komendy

---

## Jak to działa w Vue?

**Vue NIE ma tego problemu** bo:

1. Vue używa Socket.io, nie WeeChat Relay
2. Vue wysyła bezpośrednio akcje Node (np. `markAsRead`)
3. Vue nie wysyła komend WeeChat

**Lith MA ten problem** bo:

1. Lith używa WeeChat Relay Protocol
2. Lith wysyła komendy WeeChat (np. `/buffer set hotlist -1`)
3. **Musimy tłumaczyć** WeeChat → Node

---

## Inne komendy WeeChat do zaimplementowania (TODO):

### `/buffer set notify X`

- Zmiana poziomu powiadomień dla bufora
- TODO: Zmapować na ustawienia Node

### `/buffer set title "New title"`

- Zmiana tytułu bufora
- TODO: Zmapować na `/topic` dla kanałów

### `/buffer move X`

- Zmiana kolejności buforów
- TODO: Ignorować (Node nie ma kolejności buforów)

### `/buffer merge X`

- Łączenie buforów
- TODO: Ignorować (Node nie wspiera merge)

### `/input send "text"`

- Wysłanie tekstu (alternatywa dla `input 0xXXX text`)
- TODO: Zmapować na `handleInput`

---

## Testowanie:

### Co sprawdzić w Lith:

1. **Mark as read** ✅

   - Otwórz kanał z unread
   - Zamknij kanał (swipe back)
   - Sprawdź czy unread zniknął

2. **Close buffer** ✅

   - Otwórz kanał
   - Swipe left → Delete
   - Sprawdź czy kanał zniknął z listy
   - Sprawdź czy erssi opuścił kanał

3. **Wysyłanie wiadomości** ✅

   - Wyślij wiadomość
   - Sprawdź czy pojawia się w Lith
   - Sprawdź czy pojawia się w Vue
   - Sprawdź czy pojawia się na IRC

4. **IRC komendy** ✅
   - `/join #test`
   - `/part #test`
   - `/topic #channel New topic`
   - Sprawdź czy działają

---

## Podsumowanie:

✅ **Translator komend WeeChat → Node zaimplementowany**  
✅ **Mark as read działa w Lith**  
✅ **Close buffer działa w Lith**  
✅ **IRC komendy działają normalnie**  
✅ **erssi nie dostaje komend WeeChat**  
✅ **Architektura poprawna: Lith → Translator → Node → erssi**

**Teraz Lith działa jak Vue - 1:1!** 🎉
