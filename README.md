# Listen Card

Eine eigene To‑Do‑Karte für [Home Assistant](https://www.home-assistant.io/) — funktionsreicher als die eingebaute Liste. Zeigt deine `todo.*`‑Listen mit **Auswahl‑Leiste**, **sortierbaren Einträgen**, **einklappbaren erledigten Punkten** und einer **Detailseite je Eintrag** (mit Fälligkeit und Push‑Erinnerung).

Die Einträge bleiben in den nativen HA‑`todo`‑Objekten gespeichert — die **Companion‑App und Sprachassistenten bleiben synchron**, es wird keine eigene Datenbank angelegt.

> Sprache: Die Oberfläche der Karte ist auf **Deutsch**.

## Funktionen

- **Listen‑Auswahl** oben als Chips, mit Zähler offener Punkte — es wird immer **eine Liste** angezeigt
- **Alle Listen automatisch** (`show_all`) oder **feste Auswahl** (`entities`)
- **Listen verwalten** („Bearbeiten"‑Modus): Reihenfolge ändern, Liste **löschen**
- **Neue Liste** direkt in der Karte anlegen (nur Admin; erzeugt eine lokale `local_todo`‑Liste)
- **Einträge**: hinzufügen, per Tipp abhaken / wiederherstellen
- **Einträge sortieren** (▲▼) — die Reihenfolge wird in der Liste gespeichert (`todo/item/move`)
- **Erledigte** einklappbar („Erledigt (N)") und **mit einem Klick löschen**
- **Detailseite je Eintrag** (ⓘ): Titel bearbeiten, *angelegt von* (automatisch), **Fällig‑Datum**, **Erinnerung (Datum + Uhrzeit)**, löschen
- **Fällig‑Badge** (rot wenn überfällig) und **Glocken‑Icon** (Erinnerung gesetzt) direkt in der Zeile
- **Push‑Erinnerungen** über die Companion‑App (per Automatisierung, siehe unten)
- **Theme‑konform** (hell/dunkel); Auswahl und Reihenfolge werden pro Gerät gemerkt (localStorage)

## Installation

### HACS (empfohlen)
1. HACS → oben rechts ⋮ → **Custom repositories**
2. Dieses Repository hinzufügen, Kategorie **Dashboard**
3. „Listen Card" suchen → **herunterladen**
4. Browser hart neu laden (Strg/⌘ + Shift + R)

### Manuell
1. `listen-card.js` nach `/config/www/` kopieren
2. Als Dashboard‑Ressource eintragen: `/local/listen-card.js`, Typ **JavaScript‑Modul**

## Konfiguration

```yaml
type: custom:listen-card
show_all: true            # alle todo.*-Listen automatisch (Standard, wenn keine "entities")
icons:
  todo.einkaufsliste: mdi:cart-outline
  todo.infuse: mdi:filmstrip
# order: [todo.einkaufsliste, todo.infuse]   # optionale Standard-Reihenfolge
# entities: [todo.einkaufsliste]             # ODER feste Auswahl statt show_all
```

| Option     | Typ    | Beschreibung                                             |
|------------|--------|----------------------------------------------------------|
| `show_all` | bool   | Alle `todo.*`‑Listen automatisch anzeigen                |
| `entities` | Liste  | Feste Auswahl an Listen (statt `show_all`)               |
| `entity`   | String | Einzelne Liste                                           |
| `order`    | Liste  | Standard‑Reihenfolge der Listen                          |
| `icons`    | Map    | Icon je Liste (Standard `mdi:format-list-checks`)        |

> **Hinweis:** Fälligkeit, Beschreibung und Erinnerung funktionieren nur bei Listen, die das unterstützen — das sind die lokalen **„To‑do"‑Listen** (Integration `local_todo`). Die eingebaute **„Shopping List"** unterstützt das nicht.

## Wie Zusatzdaten gespeichert werden

- **Fällig‑Datum** → natives `due`‑Feld des Eintrags.
- **„Angelegt von"** und **Erinnerung** → in der **Beschreibung** des Eintrags, jeweils als eigene Zeile:

  ```
  Von: Alex
  Erinnerung: 2026-09-12T18:00:00.000Z
  ```

  „Angelegt von" wird automatisch gesetzt, wenn ein Eintrag **über die Karte** hinzugefügt wird. Die Erinnerung ist ein ISO‑Zeitstempel (UTC).

## Push‑Erinnerungen (Automatisierung)

Die Karte speichert die Erinnerungszeit — den **Push** verschickt eine Automatisierung. Sie prüft jede Minute alle Listen und benachrichtigt, wenn die Zeit erreicht ist (danach wird die Erinnerung entfernt, damit sie nicht doppelt kommt). **`notify.mobile_app_…` und die Listen anpassen:**

```yaml
alias: Listen Card – Erinnerungen (Push)
mode: single
triggers:
  - trigger: time_pattern
    minutes: "/1"
actions:
  - repeat:
      for_each:
        - todo.einkaufsliste
        - todo.infuse
      sequence:
        - variables: { listid: "{{ repeat.item }}" }
        - action: todo.get_items
          target: { entity_id: "{{ listid }}" }
          data: { status: needs_action }
          response_variable: res
        - repeat:
            for_each: "{{ res[listid]['items'] }}"
            sequence:
              - variables:
                  item: "{{ repeat.item }}"
                  remind: >-
                    {%- set ns = namespace(v='') -%}
                    {%- for line in (repeat.item.description or '').split('\n') -%}
                      {%- if line.startswith('Erinnerung:') -%}{%- set ns.v = line[11:] | trim -%}{%- endif -%}
                    {%- endfor -%}{{ ns.v }}
              - if:
                  - condition: template
                    value_template: "{{ remind and as_datetime(remind) is not none and now() >= as_datetime(remind) }}"
                then:
                  - action: notify.mobile_app_DEIN_HANDY
                    data: { title: "⏰ Erinnerung", message: "{{ item.summary }}" }
                  - action: todo.update_item
                    target: { entity_id: "{{ listid }}" }
                    data:
                      item: "{{ item.uid }}"
                      description: >-
                        {%- set ns = namespace(out=[]) -%}
                        {%- for line in (item.description or '').split('\n') -%}
                          {%- if not line.startswith('Erinnerung:') -%}{%- set ns.out = ns.out + [line] -%}{%- endif -%}
                        {%- endfor -%}{{ ns.out | join('\n') }}
```

## Changelog

- **1.6.0** – Detail‑Dialog stabil (kein Neu‑Rendern bei offener Detailseite); Fällig‑Badge + Erinnerungs‑Icon in der Zeile
- **1.5.0** – Detailseite je Eintrag (angelegt von, Fällig‑Datum, Erinnerung)
- **1.4.0** – Einträge sortieren; erledigte mit einem Klick löschen
- **1.3.0** – Listen löschen im „Bearbeiten"‑Modus
- **1.2.0** – Listen‑Auswahl (Chips) + Sortiermodus
- **1.1.0** – alle Listen automatisch anzeigen + neue Liste anlegen
- **1.0.x** – erste Version (einklappbare erledigte Punkte, Shadow‑DOM)

## Lizenz

[MIT](LICENSE)
