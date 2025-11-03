# fe-web WebSocket Message Formats

Kompletna lista wszystkich komunikatów obsługiwanych przez fe-web w wersji aktualnej.  
Format: dla każdego typu komunikatu pokazane są formaty JSON dla kierunku klient → serwer i serwer → klient.

---

## 1. Synchronizacja serwera / Server Synchronization / Serversynchronisation

### Klient → Serwer / Client → Server / Client → Server

```json
{
  "type": "sync_server",
  "server": "IRCnet"
}

lub dla wszystkich serwerów / or for all servers / oder für alle Server:

{
  "type": "sync_server",
  "server": "*"
}

Serwer → Klient / Server → Client / Server → Client

{
  "id": "1706198400-0018",
  "type": "state_dump",
  "server": "IRCnet",
  "timestamp": 1706198400
}

Następnie serwer wysyła serię komunikatów: channel_join, topic, nicklist dla każdego kanału.
Then the server sends a series of messages: channel_join, topic, nicklist for each channel.
Anschließend sendet der Server eine Reihe von Nachrichten: channel_join, topic, nicklist für jeden Kanal.

⸻

2. Wykonanie komendy IRC / IRC Command Execution / Ausführung eines IRC-Kommandos

Klient → Serwer / Client → Server / Client → Server

{
  "type": "command",
  "command": "/msg #polska Hello!",
  "server": "IRCnet"
}

Serwer → Klient / Server → Client / Server → Client

Brak bezpośredniej odpowiedzi. Komenda generuje eventy (np. message, channel_mode, whois).
No direct response. The command generates events (e.g. message, channel_mode, whois).
Keine direkte Antwort. Der Befehl erzeugt Events (z. B. message, channel_mode, whois).

⸻

3. Ping/Pong (keepalive)

Klient → Serwer

{
  "id": "ping-123",
  "type": "ping"
}

Serwer → Klient

{
  "id": "1706198400-0001",
  "type": "pong",
  "response_to": "ping-123",
  "timestamp": 1706198400
}


⸻

4. Zamknięcie query / Close Query / Abbruch einer Query

Klient → Serwer

{
  "type": "close_query",
  "server": "IRCnet",
  "nick": "alice"
}

Serwer → Klient

{
  "id": "1706198400-0025",
  "type": "query_closed",
  "server": "IRCnet",
  "nick": "alice",
  "timestamp": 1706198400
}


⸻

5. Wiadomości (publiczne i prywatne) / Messages (public & private) / Nachrichten (öffentlich & privat)

Klient → Serwer

Przez komendę:

{
  "type": "command",
  "command": "/msg #polska Witam!",
  "server": "IRCnet"
}

Serwer → Klient

Wiadomość publiczna (kanał) / Public message (channel) / Öffentliche Nachricht (Kanal):

{
  "id": "1706198400-0005",
  "type": "message",
  "server": "IRCnet",
  "channel": "#polska",
  "nick": "alice",
  "text": "Witam wszystkich!",
  "timestamp": 1706198400,
  "level": 4,
  "is_own": false
}

Wiadomość prywatna (query) / Private message (query) / Private Nachricht (Query):

{
  "id": "1706198400-0006",
  "type": "message",
  "server": "IRCnet",
  "channel": "alice",
  "nick": "alice",
  "text": "Prywatna wiadomość",
  "timestamp": 1706198400,
  "level": 12,
  "is_own": false
}

Własna wiadomość publiczna / Own public message / Eigene öffentliche Nachricht:

{
  "id": "1706198400-0007",
  "type": "message",
  "server": "IRCnet",
  "channel": "#polska",
  "nick": "mynick",
  "text": "Moja wiadomość",
  "timestamp": 1706198400,
  "level": 1,
  "is_own": true
}

Własna wiadomość prywatna / Own private message / Eigene private Nachricht:

{
  "id": "1706198400-0008",
  "type": "message",
  "server": "IRCnet",
  "channel": "alice",
  "nick": "mynick",
  "text": "Moja prywatna wiadomość",
  "timestamp": 1706198400,
  "level": 9,
  "is_own": true
}


⸻

6. Join (dołączenie do kanału) / Join (channel) / Beitreten eines Kanals

Klient → Serwer

Przez komendę:

{
  "type": "command",
  "command": "/join #polska",
  "server": "IRCnet"
}

Serwer → Klient

Podstawowy join / Basic join / Basis-Join:

{
  "id": "1706198400-0010",
  "type": "channel_join",
  "server": "IRCnet",
  "channel": "#polska",
  "nick": "alice",
  "timestamp": 1706198400,
  "extra": {
    "hostname": "user@host.example.com"
  }
}

Join z IRCv3 extended-join / Join with IRCv3 extended-join / Join mit IRCv3 extended-join:

{
  "id": "1706198400-0011",
  "type": "channel_join",
  "server": "IRCnet",
  "channel": "#polska",
  "nick": "bob",
  "timestamp": 1706198400,
  "extra": {
    "hostname": "user@host.example.com",
    "account": "bob_account",
    "realname": "Bob Smith"
  }
}


⸻

7. Part (opuszczenie kanału) / Part (leave channel) / Verlassen eines Kanals

Klient → Serwer

Przez komendę:

{
  "type": "command",
  "command": "/part #polska Żegnajcie",
  "server": "IRCnet"
}

Serwer → Klient

{
  "id": "1706198400-0012",
  "type": "channel_part",
  "server": "IRCnet",
  "channel": "#polska",
  "nick": "alice",
  "text": "Żegnajcie",
  "timestamp": 1706198400,
  "extra": {
    "hostname": "user@host.example.com"
  }
}


⸻

8. Kick (wyrzucenie z kanału) / Kick / Kick (Ausschluss aus Kanal)

Klient → Serwer

Przez komendę:

{
  "type": "command",
  "command": "/kick #polska spammer Get out",
  "server": "IRCnet"
}

Serwer → Klient

{
  "id": "1706198400-0013",
  "type": "channel_kick",
  "server": "IRCnet",
  "channel": "#polska",
  "nick": "spammer",
  "text": "Get out",
  "timestamp": 1706198400,
  "extra": {
    "kicker": "operator",
    "hostname": "spam@spam.example.com"
  }
}


⸻

9. Quit (rozłączenie użytkownika) / Quit / Verlassen (User Quit)

Klient → Serwer

Nie dotyczy (event generowany przez serwer IRC). / Not applicable (event generated by the IRC server). / Nicht anwendbar (Event vom IRC-Server erzeugt).

Serwer → Klient

{
  "id": "1706198400-0014",
  "type": "user_quit",
  "server": "IRCnet",
  "nick": "alice",
  "text": "Connection reset",
  "timestamp": 1706198400,
  "extra": {
    "hostname": "user@host.example.com"
  }
}


⸻

10. Topic (temat kanału) / Topic / Thema eines Kanals

Klient → Serwer

Przez komendę:

{
  "type": "command",
  "command": "/topic #polska Witamy na kanale!",
  "server": "IRCnet"
}

Serwer → Klient

{
  "id": "1706198400-0015",
  "type": "topic",
  "server": "IRCnet",
  "channel": "#polska",
  "text": "Witamy na kanale!",
  "timestamp": 1706198400,
  "extra": {
    "topic_by": "operator",
    "topic_time": "1706198350"
  }
}


⸻

11. Channel Mode (tryb kanału) / Channel Mode / Kanalmodus

Klient → Serwer

Przez komendę:

{
  "type": "command",
  "command": "/mode #polska +o alice",
  "server": "IRCnet"
}

Serwer → Klient

{
  "id": "1706198400-0016",
  "type": "channel_mode",
  "server": "IRCnet",
  "channel": "#polska",
  "nick": "operator",
  "timestamp": 1706198400,
  "extra": {
    "mode": "+o",
    "params": ["alice"]
  }
}

Przykład z wieloma parametrami / example with multiple params / Beispiel mit mehreren Parametern:

{
  "id": "1706198400-0017",
  "type": "channel_mode",
  "server": "IRCnet",
  "channel": "#polska",
  "nick": "operator",
  "timestamp": 1706198400,
  "extra": {
    "mode": "+ov-b",
    "params": ["alice", "bob", "*!*@spam.com"]
  }
}


⸻

12. User Mode (tryb użytkownika) / User Mode / Benutzermodus

Klient → Serwer

Przez komendę:

{
  "type": "command",
  "command": "/mode mynick +i",
  "server": "IRCnet"
}

Serwer → Klient

{
  "id": "1706198400-0018",
  "type": "user_mode",
  "server": "IRCnet",
  "nick": "mynick",
  "text": "+i",
  "timestamp": 1706198400
}


⸻

13. Nick Change (zmiana nicka) / Nick Change / Nickwechsel

Klient → Serwer

Przez komendę:

{
  "type": "command",
  "command": "/nick newnick",
  "server": "IRCnet"
}

Serwer → Klient

{
  "id": "1706198400-0019",
  "type": "nick_change",
  "server": "IRCnet",
  "nick": "oldnick",
  "text": "newnick",
  "timestamp": 1706198400
}


⸻

14. Nicklist (lista użytkowników na kanale) / Nicklist / Nickliste

Klient → Serwer

Nie dotyczy / Not applicable / Nicht anwendbar (wysyłane automatycznie po sync_server lub join).

Serwer → Klient

{
  "id": "1706198400-0020",
  "type": "nicklist",
  "server": "IRCnet",
  "channel": "#polska",
  "text": "@operator +voice alice bob charlie",
  "timestamp": 1706198400
}

Format text: prefiksy (@, + itd.) przed nickami, oddzielone spacjami.
Format of text: prefixes (@, + etc.) before nicks, separated by spaces.
Format von text: Präfixe (@, + etc.) vor Nicknamen, getrennt durch Leerzeichen.

⸻

15. Away (status away) / Away / Abwesenheit

Klient → Serwer

Przez komendę:

{
  "type": "command",
  "command": "/away Jestem AFK",
  "server": "IRCnet"
}

Serwer → Klient

{
  "id": "1706198400-0021",
  "type": "away",
  "server": "IRCnet",
  "nick": "alice",
  "text": "Jestem AFK",
  "timestamp": 1706198400
}

Powrót (brak away) / Return (no away) / Rückkehr (kein away):

{
  "id": "1706198400-0022",
  "type": "away",
  "server": "IRCnet",
  "nick": "alice",
  "text": "",
  "timestamp": 1706198400
}


⸻

16. WHOIS

Klient → Serwer

Przez komendę:

{
  "type": "command",
  "command": "/whois alice",
  "server": "IRCnet"
}

Serwer → Klient

{
  "id": "1706198400-0023",
  "type": "whois",
  "server": "IRCnet",
  "nick": "alice",
  "timestamp": 1706198400,
  "extra": {
    "user": "alice",
    "host": "host.example.com",
    "realname": "Alice Smith",
    "channels": "#polska #test @#ops",
    "server_name": "irc.example.com",
    "server_info": "Example IRC Server",
    "idle": "125",
    "signon": "1706198000",
    "account": "alice_account",
    "secure": "1",
    "away": "Jestem AFK",
    "oper": "1"
  }
}

Pola w extra są opcjonalne — obecne tylko, gdy dostępne.
Fields in extra are optional — present only if available.
Felder in extra sind optional — nur vorhanden, wenn verfügbar.

⸻

17. Query Opened (otwarcie prywatnej rozmowy) / Query Opened / Query geöffnet

Klient → Serwer

Nie dotyczy / Not applicable / Nicht anwendbar.

Serwer → Klient

{
  "id": "1706198400-0024",
  "type": "query_opened",
  "server": "IRCnet",
  "nick": "alice",
  "timestamp": 1706198400
}


⸻

18. Server Status (status połączenia) / Server Status / Server-Status

Klient → Serwer

Nie dotyczy / Not applicable / Nicht anwendbar.

Serwer → Klient

Połączono / Connected / Verbunden:

{
  "id": "1706198400-0026",
  "type": "server_status",
  "server": "IRCnet",
  "text": "connected",
  "timestamp": 1706198400
}

Rozłączono / Disconnected / Getrennt:

{
  "id": "1706198400-0027",
  "type": "server_status",
  "server": "IRCnet",
  "text": "disconnected",
  "timestamp": 1706198400
}


⸻

19. Auth OK (potwierdzenie autentykacji) / Auth OK / Auth OK

Klient → Serwer

Nie dotyczy / Not applicable / Nicht anwendbar.

Serwer → Klient

{
  "id": "1706198400-0001",
  "type": "auth_ok",
  "timestamp": 1706198400
}


⸻

20. Error (błąd) / Error / Fehler

Klient → Serwer

Nie dotyczy / Not applicable / Nicht anwendbar.

Serwer → Klient

{
  "id": "1706198400-0028",
  "type": "error",
  "text": "Not connected to any server",
  "timestamp": 1706198400
}


⸻

Podsumowanie / Summary / Zusammenfassung

Komunikaty Klient → Serwer (4 typy) / Client → Server messages (4 types) / Client → Server Nachrichten (4 Typen):
    1.  sync_server – synchronizacja z serwerem / server synchronization / Serversynchronisation
    2.  command – wykonanie komendy IRC / IRC command execution / Ausführung eines IRC-Kommandos
    3.  ping – keepalive / ping / keepalive
    4.  close_query – zamknięcie query / close query / Abbruch einer Query

Komunikaty Serwer → Klient (20 typów) / Server → Client messages (20 types) / Server → Client Nachrichten (20 Typen):
    1.  auth_ok – autentykacja OK / authentication OK / Auth OK
    2.  message – wiadomość (publiczna/prywatna) / message (public/private) / Nachricht (öffentlich/privat)
    3.  channel_join – dołączenie do kanału / join channel / Kanalbeitritt
    4.  channel_part – opuszczenie kanału / part channel / Kanal verlassen
    5.  channel_kick – wyrzucenie z kanału / kick from channel / Ausschluss aus Kanal
    6.  user_quit – rozłączenie użytkownika / user quit / Nutzer verlassen
    7.  topic – temat kanału / topic / Thema
    8.  channel_mode – tryb kanału / channel mode / Kanalmodus
    9.  user_mode – tryb użytkownika / user mode / Benutzermodus
    10. nick_change – zmiana nicka / nick change / Nickwechsel
    11. nicklist – lista użytkowników / nicklist / Nickliste
    12. away – status away / away / Abwesenheit
    13. whois – informacje o użytkowniku / whois / Whois
    14. query_opened – otwarcie query / query opened / Query geöffnet
    15. query_closed – zamknięcie query / query closed / Query geschlossen
    16. server_status – status połączenia / server status / Server-Status
    17. state_dump – marker zrzutu stanu / state dump / Zustandsabzug
    18. pong – odpowiedź na ping / pong response / pong-Antwort
    19. error – błąd / error / Fehler

Uwagi / Notes / Hinweise:
    •   Wszystkie komunikaty serwer → klient zawierają id i timestamp / All server → client messages include id and timestamp / Alle Server → Client Nachrichten enthalten id und timestamp
    •   Pole extra zawiera dodatkowe dane specyficzne dla typu komunikatu / The extra field contains additional type-specific data / Das Feld extra enthält zusätzliche typabhängige Daten
    •   Komunikaty klient → serwer mogą zawierać opcjonalne pole id dla śledzenia odpowiedzi / Client → server messages may include optional id for tracking responses / Client → Server Nachrichten können ein optionales id zur Verfolgung von Antworten enthalten
    •   Większość akcji klienta odbywa się przez command z komendami IRC / Most client actions are done via command with IRC commands / Die meisten Client-Aktionen erfolgen über command mit IRC-Befehlen
```
