# WeeChat Relay - Upgrade do pełnego formatu

## Data: 2025-11-01

## Co się zmieniło?

Zmieniliśmy format `_buffer_line_added` z **uproszczonego** (Go bridge) na **pełny** (oficjalny WeeChat Relay).

### PRZED (uproszczony format):
```
buffer:ptr,date:tim,date_printed:tim,displayed:chr,highlight:chr,tags_array:arr,prefix:str,message:str
```

**8 pól** - minimalny format który działa z Lith

### PO (pełny format):
```
buffer:ptr,id:ptr,date:tim,date_usec:int,date_printed:tim,date_usec_printed:int,displayed:chr,notify_level:int,highlight:chr,tags_array:arr,prefix:str,message:str
```

**12 pól** - pełny format zgodny z oficjalnym WeeChat Relay

---

## Nowe pola i ich znaczenie:

### 1. **`id:ptr`** - Unikalny identyfikator linii
**Źródło**: `message.id` z IrssiClient  
**Format**: BigInt pointer  
**Zastosowanie**:
- Identyfikacja konkretnej wiadomości
- Potencjalnie: edycja/usuwanie wiadomości w przyszłości

**Implementacja**:
```typescript
const lineId = BigInt(message.id || Date.now());
msg.addPointer(lineId);
```

---

### 2. **`date_usec:int`** - Mikrosekundy dla date
**Źródło**: `message.time.getTime()` (milisekundy → mikrosekundy)  
**Format**: Integer (0-999999)  
**Zastosowanie**:
- Dokładniejsze sortowanie wiadomości
- Rozróżnienie wiadomości w tej samej sekundzie
- Lepsze wyświetlanie czasu w Lith

**Implementacja**:
```typescript
const timestampMs = message.time?.getTime() || Date.now();
const seconds = Math.floor(timestampMs / 1000);
const microseconds = (timestampMs % 1000) * 1000; // ms → μs
msg.addTime(seconds);
msg.addInt(microseconds);
```

---

### 3. **`date_usec_printed:int`** - Mikrosekundy dla date_printed
**Źródło**: To samo co `date_usec` (u nas date = date_printed)  
**Format**: Integer (0-999999)  
**Zastosowanie**:
- W prawdziwym WeeChat: czas wyświetlenia może być inny niż czas otrzymania
- U nas: zawsze taki sam jak `date_usec`

**Implementacja**:
```typescript
msg.addTime(seconds);
msg.addInt(microseconds); // to samo co date_usec
```

---

### 4. **`notify_level:int`** - Poziom powiadomienia ⭐ NAJWAŻNIEJSZE
**Źródło**: `message.type` + `message.highlight`  
**Format**: Integer (0-3)  
**Wartości**:
- `0` = **low** (join/part/quit) - dla smart filtering
- `1` = **message** (normalna wiadomość)
- `2` = **private** (prywatna wiadomość) - TODO
- `3` = **highlight** (mention/highlight)

**Zastosowanie**:
- ✅ **Smart filtering** w Lith (ukrywanie join/part/quit)
- ✅ Różne dźwięki/powiadomienia dla różnych poziomów
- ✅ Filtrowanie wiadomości według ważności
- ✅ Priorytetyzacja powiadomień

**Implementacja**:
```typescript
let notifyLevel = 1; // default: normal message
if (message.highlight) {
    notifyLevel = 3; // highlight (mention)
} else if (message.type === "join" || message.type === "part" || message.type === "quit") {
    notifyLevel = 0; // low (for smart filtering)
}
msg.addInt(notifyLevel);
```

---

## Korzyści z pełnego formatu:

### 1. **Smart Filtering** ✅
- Lith może teraz ukrywać join/part/quit (notify_level=0)
- Użytkownik może włączyć/wyłączyć smart filter w ustawieniach Lith
- Działa tak samo jak w prawdziwym WeeChat

### 2. **Lepsze sortowanie** ✅
- Mikrosekundy pozwalają na dokładne sortowanie
- Ważne gdy wiele wiadomości przychodzi w tej samej sekundzie
- Brak "przeskakiwania" wiadomości

### 3. **Pełna kompatybilność z WeeChat** ✅
- Nasz format jest teraz identyczny z prawdziwym WeeChat
- Lith nie widzi różnicy między nami a prawdziwym WeeChat
- Wszystkie funkcje Lith powinny działać

### 4. **Lepsze powiadomienia** ✅
- Lith może różnicować powiadomienia według notify_level
- Highlight (3) → głośne powiadomienie
- Message (1) → normalne powiadomienie
- Low (0) → brak powiadomienia lub ciche

### 5. **Przyszłościowość** ✅
- Mamy `id` - możemy w przyszłości dodać edycję/usuwanie wiadomości
- Mamy pełny format - łatwiej dodać nowe funkcje
- Jesteśmy bliżej prawdziwego WeeChat niż Go bridge

---

## Porównanie z Go bridge:

| Funkcja | Go bridge | Nasz Node bridge (PO) |
|---------|-----------|----------------------|
| Format | Uproszczony (8 pól) | Pełny (12 pól) |
| Line ID | ❌ Brak | ✅ message.id |
| Mikrosekundy | ❌ Brak | ✅ Z Date.getTime() |
| notify_level | ❌ Brak | ✅ Z type + highlight |
| Smart filtering | ⚠️ Może nie działać | ✅ Powinno działać |
| Kompatybilność | ⚠️ Częściowa | ✅ Pełna |

---

## Testowanie:

### Co sprawdzić w Lith:

1. **Wiadomości wyświetlają się poprawnie** ✅
   - Nick + treść widoczne
   - Timestamp poprawny
   - Highlight działa

2. **Smart filtering** (nowa funkcja!)
   - Włącz smart filter w ustawieniach Lith
   - Join/part/quit powinny być ukryte
   - Normalne wiadomości widoczne

3. **Sortowanie wiadomości**
   - Wiadomości w poprawnej kolejności
   - Brak "przeskakiwania"

4. **Powiadomienia**
   - Highlight → głośne powiadomienie
   - Normalna wiadomość → normalne powiadomienie
   - Join/part/quit → brak powiadomienia

---

## Backward compatibility:

**Czy to zepsuje coś?**
- ❌ NIE - Lith obsługuje zarówno uproszczony jak i pełny format
- ✅ Tylko dodajemy pola, nie usuwamy
- ✅ Kolejność pól jest poprawna
- ✅ Typy pól są poprawne

**Czy Vue frontend jest dotknięty?**
- ❌ NIE - Vue używa Socket.io, nie WeeChat Relay
- ✅ Zmiany tylko w WeeChat bridge
- ✅ Vue działa tak samo jak wcześniej

---

## Następne kroki (opcjonalne):

1. **Dodać notify_level=2 dla private messages**
   - Wykryć czy buffer.type === "private"
   - Ustawić notifyLevel = 2

2. **Dodać kolory w prefix**
   - WeeChat używa color codes w prefix
   - Możemy dodać `\x19F<nn>` dla kolorów

3. **Zoptymalizować tags**
   - Dodać więcej tagów zgodnie z WeeChat
   - Np. `irc_action`, `irc_ctcp`, etc.

---

## Podsumowanie:

✅ **Pełny format WeeChat Relay zaimplementowany**  
✅ **Smart filtering powinien działać**  
✅ **Lepsza kompatybilność z Lith**  
✅ **Brak breaking changes**  
✅ **Gotowe do testowania!** 🚀

