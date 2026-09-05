# Listen Card

Eine eigene To‑Do‑Karte für [Home Assistant](https://www.home-assistant.io/). Zeigt eine oder mehrere `todo.*`‑Listen an – **offene Punkte immer sichtbar**, **erledigte Punkte eingeklappt** in einer aufklappbaren Sektion „Erledigt (N)".

Die Einträge bleiben in den HA‑`todo`‑Objekten gespeichert, d. h. die Companion‑App und Sprachassistenten (Alexa/Google) bleiben synchron.

## Funktionen (v1)

- Mehrere Listen in einer Karte
- Punkt hinzufügen (Eingabefeld, Enter oder „+")
- Antippen hakt einen Punkt ab / stellt ihn wieder her
- Erledigte Punkte standardmäßig eingeklappt, per Klick ausklappbar
- „Erledigte löschen"
- Passt sich dem HA‑Theme an (hell/dunkel)

## Konfiguration

```yaml
type: custom:listen-card
entities:
  - todo.einkaufsliste
  - todo.infuse
  - todo.italien
  - todo.packliste_christiane
icons:
  todo.einkaufsliste: mdi:cart-outline
  todo.infuse: mdi:filmstrip
  todo.italien: mdi:map-marker-radius-outline
  todo.packliste_christiane: mdi:bag-suitcase-outline
```

| Option     | Typ     | Beschreibung                                             |
|------------|---------|----------------------------------------------------------|
| `entities` | Liste   | Eine oder mehrere `todo.*`‑Entitäten                     |
| `entity`   | String  | Alternativ eine einzelne Liste                           |
| `icons`    | Map     | Optional: Icon je Entität (Standard `mdi:format-list-checks`) |

## Installation

**Manuell:** `listen-card.js` nach `/config/www/` kopieren und als Dashboard‑Ressource
`/local/listen-card.js` (Typ: JavaScript‑Modul) eintragen.

**HACS (custom repository):** Dieses Repo in HACS als benutzerdefiniertes Repository
(Kategorie „Dashboard") hinzufügen und installieren.
