# Flow Analysis: /join command

## Flow 1: /join z Vue (przeglądarka)

### 1. Vue Client (przeglądarka)

**Plik:** `client/components/ChatInput.vue` (linia 141-195)

- Użytkownik wpisuje `/join #channel` w textarea
- `onSubmit()` jest wywołane
- Sprawdza czy komenda zaczyna się od `/` (linia 181)
- Parsuje komendę: `args = ["join", "#channel"]`, `cmd = "join"` (linia 182-183)
- Sprawdza czy istnieje handler w `commands[cmd]` (linia 189)

**Plik:** `client/js/commands/join.ts` (linia 6-50)

- Handler `input(args)` jest wywołany
- Sprawdza czy kanał już istnieje lokalnie (linia 24)
- Jeśli NIE istnieje → wysyła przez Socket.IO:
  ```javascript
  socket.emit("input", {
    text: `/join ${channels} ${args.length > 1 ? args[1] : ""}`,
    target: store.state.activeChannel.channel.id,
  });
  ```
- Zwraca `true` (komenda obsłużona)

### 2. Node.js Server (nexuslounge)

**Plik:** `server/client.ts` (linia ~486-512)

- Socket.IO odbiera event `"input"` z `{text: "/join #channel", target: channelId}`
- Parsuje komendę: `cmd = "join"`, `args = ["#channel"]`
- Sprawdza czy istnieje plugin w `inputs.userInputs.get(cmd)`
- **UWAGA:** Dla `/join` prawdopodobnie NIE ma pluginu, więc przechodzi dalej

**Plik:** `server/irssiClient.ts` (linia 588-608)

- `translateCommand("join", ["#channel"], channel, network)` jest wywołane
- Dla `join` zwraca `null` (brak translacji)
- Wysyła do irssi przez WebSocket:
  ```typescript
  await this.irssiConnection.executeCommand("join #channel", network.serverTag);
  ```

**Plik:** `server/feWebClient/feWebConnection.ts` (przypuszczalnie)

- Wysyła JSON przez WebSocket do erssi:
  ```json
  {
    "type": "command",
    "command": "join #channel",
    "server": "libera"
  }
  ```

### 3. erssi fe-web (moduł C)

**Plik:** `erssi/src/fe-web/fe-web-client.c` (linia 94-146)

- `fe_web_client_handle_message(client, json)` odbiera wiadomość
- Parsuje `type = "command"` (linia 122)
- Parsuje `command = "join #channel"` i `server_tag = "libera"` (linia 126-127)
- Ustawia `client->server` na odpowiedni server (linia 131-138)
- Wywołuje `fe_web_client_execute_command(client, "join #channel")` (linia 140)

**Plik:** `erssi/src/fe-web/fe-web-client.c` (linia 315-330)

- `fe_web_client_execute_command(client, command)` jest wywołane
- Emituje sygnał irssi:
  ```c
  signal_emit("send command", 3, command, client->server, NULL);
  ```
- **UWAGA:** To jest ASYNCHRONICZNE - sygnał jest dodany do kolejki

### 4. irssi Core

**Plik:** `erssi/src/core/commands.c` (linia ~1007)

- Handler `event_command()` przechwytuje sygnał `"send command"`
- Parsuje komendę `"join #channel"`
- Znajduje handler dla komendy `JOIN` w IRC module
- Wykonuje komendę JOIN

**Plik:** `erssi/src/irc/core/irc-commands.c` (przypuszczalnie)

- Wysyła do serwera IRC: `JOIN #channel`
- Czeka na odpowiedź od serwera IRC

### 5. IRC Server → irssi

- IRC server odpowiada: `:nick!user@host JOIN #channel`
- irssi core odbiera i parsuje
- Tworzy strukturę `IRC_CHANNEL_REC` dla kanału
- Emituje sygnał: `signal_emit("channel joined", 1, channel)`

### 6. fe-common (irssi frontend-common)

**Przypuszczalnie:** `erssi/src/fe-common/irc/fe-irc.c`

- Handler dla `"channel joined"` (uruchamia się PRZED fe-web bo fe-web używa `signal_add_last`)
- Tworzy nowe okno dla kanału
- Ustawia to okno jako aktywne: `window_set_active(channel_window)`
- **To powoduje że `active_win` wskazuje na nowe okno kanału**

### 7. fe-web (moduł WebSocket)

**Plik:** `erssi/src/fe-web/fe-web-signals.c` (linia 834-910)

- `sig_channel_joined(channel)` jest wywołane (przez `signal_add_last` - OSTATNI)
- Buduje nicklist JSON (linia 858-893)
- Wysyła `WEB_MSG_NICKLIST` do node (linia 896)
- **PROBLEM TUTAJ (linia 899-909):**
  ```c
  /* Return to main window (refnum 1) to avoid focus issues */
  channel_window = window_item_window((WI_ITEM_REC *) channel);
  if (channel_window && active_win == channel_window) {
      main_window = window_find_refnum(1);
      if (main_window && main_window != channel_window) {
          window_set_active(main_window);  // ← PRZEŁĄCZA NA OKNO 1
      }
  }
  ```
- Przełącza aktywne okno z powrotem na okno 1 (main window)

### 8. Node.js Server (nexuslounge)

**Plik:** `server/feWebClient/feWebAdapter.ts` (przypuszczalnie)

- Odbiera `WEB_MSG_NICKLIST` z fe-web
- Konwertuje do formatu The Lounge
- Wysyła przez Socket.IO do Vue

### 9. Vue Client (przeglądarka)

**Plik:** `client/js/socket-events/join.ts` (linia 7-30)

- Odbiera event `"join"` z danymi kanału
- Dodaje kanał do `network.channels` (linia 15)
- Wywołuje `switchToChannel(chan.channel)` (linia 25)
- **Przełącza widok w przeglądarce na nowy kanał**

---

## Flow 2: /join z terminala erssi

### 1. erssi fe-text (terminal frontend)

**Plik:** `erssi/src/fe-text/gui-readline.c` (przypuszczalnie)

- Użytkownik wpisuje `/join #channel` w terminalu
- fe-text parsuje input
- Emituje sygnał:
  ```c
  signal_emit("send command", 3, "join #channel", server, NULL);
  ```

### 2. irssi Core

**Identycznie jak w Flow 1, krok 4**

- Handler `event_command()` przechwytuje sygnał
- Wykonuje komendę JOIN
- Wysyła do IRC servera

### 3. IRC Server → irssi

**Identycznie jak w Flow 1, krok 5**

- IRC server odpowiada
- irssi tworzy `IRC_CHANNEL_REC`
- Emituje `signal_emit("channel joined", 1, channel)`

### 4. fe-common

**Identycznie jak w Flow 1, krok 6**

- Tworzy nowe okno
- Ustawia jako aktywne
- `active_win` wskazuje na nowe okno kanału

### 5. fe-web

**Identycznie jak w Flow 1, krok 7**

- `sig_channel_joined(channel)` jest wywołane
- Buduje nicklist
- Wysyła do node
- **PROBLEM: Przełącza okno na 1** (linia 907)
  - **To jest BUG dla terminala!**
  - Użytkownik chce pozostać na nowym kanale w terminalu
  - Ale fe-web przełącza z powrotem na okno 1

### 6. Node.js + Vue

**Identycznie jak w Flow 1, kroki 8-9**

- Node odbiera nicklist
- Vue przełącza widok na nowy kanał

---

## Kluczowe różnice między Flow 1 i Flow 2

| Aspekt                                | Flow 1 (Vue)                                      | Flow 2 (Terminal)                      |
| ------------------------------------- | ------------------------------------------------- | -------------------------------------- |
| **Źródło komendy**                    | Vue → Socket.IO → Node → WebSocket → fe-web       | fe-text → irssi core                   |
| **Sygnał "send command"**             | Emitowany przez `fe_web_client_execute_command()` | Emitowany przez fe-text                |
| **Czy przechodzi przez fe-web?**      | TAK (linia 329 w fe-web-client.c)                 | NIE                                    |
| **Czy powinno przełączyć okno na 1?** | TAK (Vue kontroluje widok)                        | NIE (użytkownik chce zostać na kanale) |

---

## Problem

**Oba flow przechodzą przez ten sam handler `sig_channel_joined()`** w fe-web-signals.c (linia 834-910).

Handler nie wie skąd przyszła komenda:

- Czy z fe-web (Vue) → powinien przełączyć na okno 1
- Czy z fe-text (terminal) → NIE powinien przełączać

**Obecne rozwiązanie:** Zawsze przełącza na okno 1 (linia 907)

- ✅ Działa dla Vue
- ❌ Psuje dla terminala

---

## Możliwe rozwiązania

### Rozwiązanie 1: Flaga globalna (NIEUDANE)

- Dodać `fe_web_command_active = TRUE` w `fe_web_client_execute_command()`
- Problem: `signal_emit()` jest asynchroniczne
- Flaga jest czyszczona zanim `sig_channel_joined()` się wykona

### Rozwiązanie 2: Sprawdzić czy są podłączeni klienci fe-web

- Jeśli `g_slist_length(web_clients) > 0` → przełącz na okno 1
- Jeśli `g_slist_length(web_clients) == 0` → nie przełączaj
- Problem: Co jeśli klient jest podłączony ale użytkownik pracuje w terminalu?

### Rozwiązanie 3: Dodać parametr do sygnału "channel joined"

- Zmienić sygnał na: `signal_emit("channel joined", 2, channel, source)`
- Gdzie `source` = "fe-web" lub "fe-text"
- Problem: Wymaga zmian w irssi core (duża ingerencja)

### Rozwiązanie 4: Nie przełączać okna wcale

- Usunąć kod przełączania (linia 899-909)
- Problem: Czy Vue naprawdę potrzebuje tego przełączania?
- Trzeba przetestować czy Vue działa bez tego

### Rozwiązanie 5: Sprawdzić `active_win` przed przełączeniem

- Jeśli `active_win->refnum == 1` → użytkownik jest na oknie głównym → przełącz
- Jeśli `active_win->refnum != 1` → użytkownik jest na innym oknie → nie przełączaj
- Problem: Nie rozwiązuje problemu bo fe-common już przełączyło okno
