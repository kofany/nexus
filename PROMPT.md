# Nexus Lounge - WeeChat Relay Implementation

## Cel projektu
Implementacja WeeChat Relay Protocol w Node.js, umożliwiająca połączenie klienta Lith (mobilny klient WeeChat) z backendem erssi przez translator Node.

## Architektura
```
erssi (IRC backend) <-> Node.js (translator) <-> WeeChat Relay Protocol <-> Lith (mobile client)
```

Obecnie działa:
```
erssi <-> Node.js <-> Vue (web frontend) ✅
```

Cel:
```
erssi <-> Node.js <-> WeeChat Relay <-> Lith ✅
```

## Dostępne zasoby

### Kod źródłowy (workdir)
- `erssi/` - backend IRC (C)
- `lith/` - klient mobilny (Qt/QML)
- `weechat/` - oryginalny WeeChat (C)
- `nexuslounge/` - nasza implementacja (TypeScript)

### Dokumentacja
https://weechat.org/files/doc/devel/weechat_relay_protocol.en.html

## Aktualny problem

### ✅ Działa:
- Połączenie Lith z Node
- Wyświetlanie buforów (kanałów)
- Wyświetlanie wiadomości
- Wysyłanie wiadomości
- Nicklist (lista użytkowników)
- Mode changes (+o/-o) - aktualizacja nicklist

### ❌ Do naprawy:
**Kick event** - format wiadomości OK, ale wykopany użytkownik **nie znika z nicklist** w Lith

## Kluczowe zasady

### ⚠️ OSTRZEŻENIA:
1. **Node backend ma już wszystko co potrzebujemy** - działa z Vue!
2. **Patrzymy jak Vue dostaje eventy** i robimy tylko **translację formatu** dla Lith
3. **POD ŻADNYM POZOREM nie ruszamy**:
   - Frontend Vue
   - IrssiClient
   - FeWebAdapter
   - Pluginów irc-events
   
   **BEZ WYRAŹNEGO POZWOLENIA!**

4. **Zmiany tylko w**:
   - `server/weechatRelay/nodeToWeechatAdapter.ts`
   - `server/weechatRelay/weechatToNodeAdapter.ts`
   - `server/weechatRelay/weechatHData.ts`

## Metodologia
1. Sprawdź jak Vue dostaje event (działa!)
2. Sprawdź co Lith oczekuje (dokumentacja WeeChat)
3. Dodaj translację w WeeChat adapter
4. **NIE ZMIENIAJ** backendu - on już działa!

