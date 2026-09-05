/**
 * Listen-Card – eigene To-Do-Karte für Home Assistant
 * -----------------------------------------------------
 * Zeigt eine oder mehrere todo.*-Listen an:
 *   - offene Punkte immer sichtbar (Tipp = abhaken)
 *   - erledigte in einer aufklappbaren Sektion (Standard: eingeklappt)
 *   - unten: neue Liste anlegen (ohne das eingebaute Panel)
 *
 * Die Daten liegen weiter in den HA-todo-Entitäten – App/Alexa bleiben synchron.
 *
 * Beispiel-Konfiguration:
 *   type: custom:listen-card
 *   show_all: true            # alle todo.*-Listen automatisch anzeigen
 *   icons:
 *     todo.einkaufsliste: mdi:cart-outline
 *   # ODER feste Auswahl:
 *   # entities: [todo.einkaufsliste, todo.infuse]
 */
const LISTEN_CARD_VERSION = "1.1.0";

class ListenCard extends HTMLElement {
  setConfig(config) {
    this._config = config;
    // Auto-Modus: alle todo.*-Listen anzeigen (wenn show_all oder keine entities)
    this._auto = config.show_all === true || !config.entities;
    this._entities = config.entities
      ? [...config.entities]
      : (config.entity ? [config.entity] : null);
    if (!this._auto && (!this._entities || !this._entities.length)) {
      throw new Error("Bitte 'entities' angeben oder 'show_all: true' setzen.");
    }
    this._items = {};   // entity_id -> [items]
    this._sig = {};     // entity_id -> Signatur für Änderungserkennung
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;

    // Auto-Modus: aktuelle Liste aller todo.*-Entitäten bestimmen (alphabetisch)
    if (this._auto) {
      const all = Object.keys(hass.states)
        .filter((e) => e.startsWith("todo."))
        .sort((a, b) => {
          const na = (hass.states[a].attributes.friendly_name || a).toLowerCase();
          const nb = (hass.states[b].attributes.friendly_name || b).toLowerCase();
          return na < nb ? -1 : na > nb ? 1 : 0;
        });
      if (!this._entities || this._entities.join(",") !== all.join(",")) {
        this._entities = all;
        this._built = false; // Liste der Listen hat sich geändert -> neu aufbauen
      }
    }

    if (!this._entities) return;
    if (!this._built || !this.shadowRoot || !this.shadowRoot.querySelector("ha-card")) this._build();

    for (const eid of this._entities) {
      const st = hass.states[eid];
      const sig = st ? `${st.state}|${st.last_updated}` : "missing";
      if (this._sig[eid] !== sig) {
        this._sig[eid] = sig;
        this._fetchItems(eid);
      } else if (
        this._items[eid] &&
        this._sections && this._sections[eid] &&
        this._sections[eid].ulAktiv.childElementCount === 0
      ) {
        this._renderList(eid);
      }
    }
  }

  connectedCallback() {
    if (this._hass) this.hass = this._hass;
  }

  async _fetchItems(eid) {
    if (!this._hass) return;
    try {
      const r = await this._hass.callWS({ type: "todo/item/list", entity_id: eid });
      this._items[eid] = (r && r.items) || [];
      this._renderList(eid);
    } catch (e) {
      console.error("Listen-Card: Konnte Einträge nicht laden für", eid, e);
    }
  }

  _build() {
    const style = document.createElement("style");
    style.textContent = `
      ha-card { padding: 4px 0 8px; }
      .liste { padding: 0 16px; }
      .liste:not(:last-child), .neueListe { border-bottom: 1px solid var(--divider-color); }
      .liste:not(:last-child) { padding-bottom: 8px; margin-bottom: 4px; }
      .kopf { display:flex; align-items:center; gap:8px; font-weight:600; font-size:1.05rem; padding: 14px 0 4px; }
      .kopf ha-icon { color: var(--primary-color); --mdc-icon-size: 22px; }
      .add { display:flex; align-items:center; gap:8px; padding: 2px 0 6px; }
      .add input { flex:1; background:transparent; border:none; border-bottom:1px solid var(--divider-color);
                   color:var(--primary-text-color); font-size:1rem; padding:6px 2px; outline:none; }
      .add input:focus { border-bottom-color: var(--primary-color); }
      .add button { background:none; border:none; color:var(--primary-color); cursor:pointer;
                    font-size:1.6rem; line-height:1; padding:0 6px; }
      ul { list-style:none; margin:0; padding:0; }
      li { display:flex; align-items:center; gap:12px; padding:9px 2px; cursor:pointer; }
      li .box { width:19px; height:19px; border:2px solid var(--secondary-text-color); border-radius:4px;
                flex:0 0 auto; display:flex; align-items:center; justify-content:center; box-sizing:border-box; }
      li.done .box { background:var(--primary-color); border-color:var(--primary-color); color:var(--text-primary-color, #fff); }
      li.done .txt { text-decoration:line-through; color:var(--secondary-text-color); }
      .box ha-icon { --mdc-icon-size:15px; }
      details { margin: 2px 0 4px; }
      summary { cursor:pointer; color:var(--secondary-text-color); font-size:0.9rem; padding:8px 2px;
                user-select:none; list-style:none; display:flex; align-items:center; gap:6px; }
      summary::-webkit-details-marker { display:none; }
      summary ha-icon { --mdc-icon-size:18px; transition: transform .15s ease; }
      details[open] summary ha-icon.chev { transform: rotate(90deg); }
      .leer { color:var(--secondary-text-color); font-size:0.92rem; padding:8px 2px; }
      .clear { color:var(--secondary-text-color); font-size:0.8rem; padding:6px 2px 2px;
               cursor:pointer; text-align:right; }
      .clear:hover { color: var(--error-color, #db4437); }
      .neueListe { display:flex; align-items:center; gap:8px; padding: 12px 16px 4px; }
      .neueListe > ha-icon { color: var(--secondary-text-color); --mdc-icon-size: 22px; }
      .neueListe input { flex:1; background:transparent; border:none; border-bottom:1px solid var(--divider-color);
                         color:var(--primary-text-color); font-size:1rem; padding:6px 2px; outline:none; }
      .neueListe input:focus { border-bottom-color: var(--primary-color); }
      .neueListe button { background:none; border:1px solid var(--primary-color); color:var(--primary-color);
                          border-radius:16px; padding:6px 14px; cursor:pointer; font-size:0.9rem; }
      .neueListe button:hover { background: var(--primary-color); color: var(--text-primary-color, #fff); }
    `;

    const card = document.createElement("ha-card");
    this._sections = {};

    for (const eid of this._entities) {
      const sec = document.createElement("div");
      sec.className = "liste";
      const st = this._hass.states[eid];
      const name = (st && st.attributes.friendly_name) || eid;
      const icon = (this._config.icons && this._config.icons[eid]) || "mdi:format-list-checks";

      const kopf = document.createElement("div");
      kopf.className = "kopf";
      kopf.innerHTML = `<ha-icon icon="${icon}"></ha-icon><span></span>`;
      kopf.querySelector("span").textContent = name;

      const addRow = document.createElement("div");
      addRow.className = "add";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Hinzufügen…";
      const addBtn = document.createElement("button");
      addBtn.title = "Hinzufügen";
      addBtn.textContent = "+";
      addRow.appendChild(input);
      addRow.appendChild(addBtn);

      const ulAktiv = document.createElement("ul");
      ulAktiv.className = "aktiv";

      const details = document.createElement("details");
      details.className = "fertig";
      const summary = document.createElement("summary");
      summary.innerHTML = `<ha-icon class="chev" icon="mdi:chevron-right"></ha-icon><span class="label">Erledigt</span>`;
      const ulFertig = document.createElement("ul");
      ulFertig.className = "erledigt";
      const clear = document.createElement("div");
      clear.className = "clear";
      clear.textContent = "Erledigte löschen";
      details.appendChild(summary);
      details.appendChild(ulFertig);
      details.appendChild(clear);

      const doAdd = () => {
        const v = input.value.trim();
        if (v) { this._add(eid, v); input.value = ""; input.focus(); }
      };
      addBtn.addEventListener("click", doAdd);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
      clear.addEventListener("click", () => this._clearCompleted(eid));

      sec.appendChild(kopf);
      sec.appendChild(addRow);
      sec.appendChild(ulAktiv);
      sec.appendChild(details);
      card.appendChild(sec);

      this._sections[eid] = { sec, ulAktiv, ulFertig, details, label: summary.querySelector(".label") };
    }

    // Fußzeile: neue Liste anlegen (nur für Admins – Listen sind Konfigurationseinträge)
    if (!this._hass.user || this._hass.user.is_admin) {
      const foot = document.createElement("div");
      foot.className = "neueListe";
      foot.innerHTML = `<ha-icon icon="mdi:playlist-plus"></ha-icon>
        <input type="text" placeholder="Neue Liste…">
        <button>Anlegen</button>`;
      const inp = foot.querySelector("input");
      const b = foot.querySelector("button");
      const create = () => { const v = inp.value.trim(); if (v) { this._createList(v); inp.value = ""; } };
      b.addEventListener("click", create);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });
      card.appendChild(foot);
    }

    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = "";
    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(card);
    this._built = true;

    for (const eid of this._entities) if (this._items[eid]) this._renderList(eid);
  }

  _renderList(eid) {
    const s = this._sections && this._sections[eid];
    if (!s) return;
    const items = this._items[eid] || [];
    const aktiv = items.filter((i) => i.status !== "completed");
    const fertig = items.filter((i) => i.status === "completed");

    s.ulAktiv.innerHTML = "";
    if (!aktiv.length) {
      const leer = document.createElement("div");
      leer.className = "leer";
      leer.textContent = "Keine offenen Punkte 🎉";
      s.ulAktiv.appendChild(leer);
    } else {
      for (const it of aktiv) s.ulAktiv.appendChild(this._row(eid, it, false));
    }

    s.ulFertig.innerHTML = "";
    for (const it of fertig) s.ulFertig.appendChild(this._row(eid, it, true));

    s.details.style.display = fertig.length ? "" : "none";
    s.label.textContent = `Erledigt (${fertig.length})`;
  }

  _row(eid, item, done) {
    const li = document.createElement("li");
    if (done) li.className = "done";
    const box = document.createElement("span");
    box.className = "box";
    if (done) box.innerHTML = `<ha-icon icon="mdi:check"></ha-icon>`;
    const txt = document.createElement("span");
    txt.className = "txt";
    txt.textContent = item.summary;
    li.appendChild(box);
    li.appendChild(txt);
    li.addEventListener("click", () => this._toggle(eid, item, done));
    return li;
  }

  _toggle(eid, item, done) {
    this._hass.callService("todo", "update_item",
      { item: item.uid, status: done ? "needs_action" : "completed" },
      { entity_id: eid });
    setTimeout(() => this._fetchItems(eid), 300);
  }

  _add(eid, summary) {
    this._hass.callService("todo", "add_item", { item: summary }, { entity_id: eid });
    setTimeout(() => this._fetchItems(eid), 300);
  }

  _clearCompleted(eid) {
    this._hass.callService("todo", "remove_completed_items", {}, { entity_id: eid });
    setTimeout(() => this._fetchItems(eid), 300);
  }

  async _createList(name) {
    try {
      const flow = await this._hass.callApi("POST", "config/config_entries/flow",
        { handler: "local_todo", show_advanced_options: false });
      if (flow && flow.flow_id) {
        await this._hass.callApi("POST", "config/config_entries/flow/" + flow.flow_id,
          { todo_list_name: name });
      }
      // Die neue todo.*-Entität erscheint kurz darauf -> Auto-Modus baut neu auf.
    } catch (e) {
      console.error("Listen-Card: Liste anlegen fehlgeschlagen", e);
      alert("Liste konnte nicht angelegt werden: " + e);
    }
  }

  getCardSize() { return (this._entities ? this._entities.length : 0) * 4 + 1; }

  static getStubConfig() { return { show_all: true }; }
}

customElements.define("listen-card", ListenCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "listen-card",
  name: "Listen Card",
  description: "Eigene To-Do-Karte mit einklappbaren erledigten Punkten",
});

console.info(
  `%c LISTEN-CARD %c v${LISTEN_CARD_VERSION} `,
  "background:#03a9f4;color:#fff;border-radius:3px 0 0 3px;padding:2px 4px",
  "background:#555;color:#fff;border-radius:0 3px 3px 0;padding:2px 4px"
);
