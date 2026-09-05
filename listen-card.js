/**
 * Listen-Card – eigene To-Do-Karte für Home Assistant
 * -----------------------------------------------------
 * - Auswahl-Leiste oben: eine Liste zur Zeit anzeigen (mit Zähler offener Punkte)
 * - offene Punkte tippen = abhaken; erledigte in aufklappbarer Sektion
 * - Sortiermodus: Reihenfolge der Listen ändern (wird gemerkt)
 * - neue Liste direkt in der Karte anlegen (nur Admin)
 *
 * Daten bleiben in den HA-todo-Entitäten -> App/Alexa synchron.
 *
 * Konfiguration:
 *   type: custom:listen-card
 *   show_all: true                 # alle todo.*-Listen (Standard, wenn keine entities)
 *   # entities: [todo.a, todo.b]   # ODER feste Auswahl
 *   # order: [todo.b, todo.a]      # optionale Standard-Reihenfolge
 *   icons:
 *     todo.einkaufsliste: mdi:cart-outline
 */
const LISTEN_CARD_VERSION = "1.2.0";

class ListenCard extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._auto = config.show_all === true || !config.entities;
    this._fixed = config.entities ? [...config.entities] : (config.entity ? [config.entity] : null);
    if (!this._auto && (!this._fixed || !this._fixed.length)) {
      throw new Error("Bitte 'entities' angeben oder 'show_all: true' setzen.");
    }
    this._configOrder = config.order || null;
    this._items = {};
    this._order = this._loadOrder();       // gemerkte Reihenfolge (oder null)
    this._selected = this._loadSelected();
    this._sortMode = false;
    this._built = false;
    this._selSig = null;
    this._contentSig = {};
  }

  // ---- localStorage-Helfer (robust) ----
  _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  _loadOrder() { try { return JSON.parse(this._lsGet("listenCardOrder")) || null; } catch (e) { return null; } }
  _saveOrder() { this._lsSet("listenCardOrder", JSON.stringify(this._order)); }
  _loadSelected() { return this._lsGet("listenCardSelected") || null; }
  _saveSelected() { if (this._selected) this._lsSet("listenCardSelected", this._selected); }

  _available(hass) {
    if (this._auto) return Object.keys(hass.states).filter((e) => e.startsWith("todo."));
    return this._fixed.filter((e) => hass.states[e]);
  }
  _name(eid) {
    const st = this._hass.states[eid];
    return (st && st.attributes.friendly_name) || eid;
  }
  _icon(eid) {
    return (this._config.icons && this._config.icons[eid]) || "mdi:format-list-checks";
  }

  set hass(hass) {
    this._hass = hass;
    const avail = this._available(hass);

    // Reihenfolge bestimmen: gemerkt -> config-order -> alphabetisch
    let base = (this._order && this._order.length) ? this._order
             : (this._configOrder && this._configOrder.length) ? this._configOrder
             : avail.slice().sort((a, b) => this._name(a).toLowerCase().localeCompare(this._name(b).toLowerCase()));
    let order = base.filter((e) => avail.includes(e));
    for (const e of avail) if (!order.includes(e)) order.push(e);
    this._order = order;

    // Auswahl validieren
    if (!this._selected || !order.includes(this._selected)) {
      this._selected = order[0] || null;
      this._saveSelected();
    }

    if (!this._built || !this.shadowRoot || !this.shadowRoot.querySelector("ha-card")) this._build();

    // Auswahl-Leiste nur bei Änderung neu zeichnen (Reihenfolge/Auswahl/Zähler/Sortmodus)
    const selSig = this._sortMode + "|" + this._selected + "|" +
      order.map((e) => e + ":" + (hass.states[e] ? hass.states[e].state : "?")).join("|");
    if (selSig !== this._selSig) { this._selSig = selSig; this._renderSelector(); }

    // Inhalt der gewählten Liste
    if (this._selected) {
      if (!this._cur || this._cur.eid !== this._selected) {
        this._renderSelected(); // Struktur neu + laden
      } else {
        const st = hass.states[this._selected];
        const sig = st ? `${st.state}|${st.last_updated}` : "missing";
        if (this._contentSig[this._selected] !== sig) {
          this._contentSig[this._selected] = sig;
          this._fetchSelected();
        } else if (this._items[this._selected] && this._cur.ulAktiv.childElementCount === 0) {
          this._renderItems();
        }
      }
    }
  }

  connectedCallback() { if (this._hass) this.hass = this._hass; }

  _build() {
    const style = document.createElement("style");
    style.textContent = `
      ha-card { padding: 8px 0 10px; }
      .selector { display:flex; gap:8px; overflow-x:auto; padding: 4px 12px 10px; scrollbar-width:thin; }
      .selector::-webkit-scrollbar { height:6px; }
      .chip { display:flex; align-items:center; gap:6px; flex:0 0 auto; cursor:pointer; user-select:none;
              border:1px solid var(--divider-color); border-radius:18px; padding:6px 12px;
              color:var(--primary-text-color); background:transparent; font-size:0.95rem; white-space:nowrap; }
      .chip ha-icon { --mdc-icon-size:18px; color:var(--secondary-text-color); }
      .chip.active { background:var(--primary-color); border-color:var(--primary-color); color:var(--text-primary-color,#fff); }
      .chip.active ha-icon { color:var(--text-primary-color,#fff); }
      .chip .cnt { font-size:0.8rem; opacity:0.8; }
      .chip .mv { border:none; background:transparent; color:inherit; cursor:pointer; font-size:1rem; padding:0 2px; line-height:1; }
      .tool { flex:0 0 auto; border:1px solid var(--divider-color); border-radius:18px; padding:6px 10px;
              background:transparent; color:var(--secondary-text-color); cursor:pointer; display:flex; align-items:center; gap:4px; font-size:0.85rem; }
      .tool.on { background:var(--primary-color); border-color:var(--primary-color); color:var(--text-primary-color,#fff); }
      .tool ha-icon { --mdc-icon-size:18px; }

      .inhalt { padding: 0 16px; }
      .kopf { display:flex; align-items:center; gap:8px; font-weight:600; font-size:1.1rem; padding: 4px 0 6px; }
      .kopf ha-icon { color: var(--primary-color); --mdc-icon-size: 24px; }
      .add { display:flex; align-items:center; gap:8px; padding: 2px 0 6px; }
      .add input { flex:1; background:transparent; border:none; border-bottom:1px solid var(--divider-color);
                   color:var(--primary-text-color); font-size:1rem; padding:6px 2px; outline:none; }
      .add input:focus { border-bottom-color: var(--primary-color); }
      .add button { background:none; border:none; color:var(--primary-color); cursor:pointer; font-size:1.6rem; line-height:1; padding:0 6px; }
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
      .clear { color:var(--secondary-text-color); font-size:0.8rem; padding:6px 2px 2px; cursor:pointer; text-align:right; }
      .clear:hover { color: var(--error-color, #db4437); }
      .hint { color:var(--secondary-text-color); font-size:0.9rem; padding:8px 2px; }

      .neueListe { display:flex; align-items:center; gap:8px; padding: 12px 16px 0; margin-top:8px;
                   border-top:1px solid var(--divider-color); }
      .neueListe > ha-icon { color: var(--secondary-text-color); --mdc-icon-size: 22px; }
      .neueListe input { flex:1; background:transparent; border:none; border-bottom:1px solid var(--divider-color);
                         color:var(--primary-text-color); font-size:1rem; padding:6px 2px; outline:none; }
      .neueListe input:focus { border-bottom-color: var(--primary-color); }
      .neueListe button { background:none; border:1px solid var(--primary-color); color:var(--primary-color);
                          border-radius:16px; padding:6px 14px; cursor:pointer; font-size:0.9rem; }
      .neueListe button:hover { background: var(--primary-color); color: var(--text-primary-color, #fff); }
    `;

    const card = document.createElement("ha-card");
    this._selectorEl = document.createElement("div");
    this._selectorEl.className = "selector";
    this._contentEl = document.createElement("div");
    this._contentEl.className = "inhalt";
    card.appendChild(this._selectorEl);
    card.appendChild(this._contentEl);

    // Fußzeile: neue Liste anlegen (nur Admin)
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
    this._cur = null;
  }

  _renderSelector() {
    const el = this._selectorEl;
    if (!el) return;
    el.innerHTML = "";
    for (let i = 0; i < this._order.length; i++) {
      const eid = this._order[i];
      const chip = document.createElement("div");
      chip.className = "chip" + (eid === this._selected ? " active" : "");
      const open = this._hass.states[eid] ? this._hass.states[eid].state : "?";

      if (this._sortMode) {
        const left = document.createElement("button");
        left.className = "mv"; left.textContent = "‹"; left.title = "nach links";
        left.addEventListener("click", (ev) => { ev.stopPropagation(); this._moveList(i, -1); });
        const right = document.createElement("button");
        right.className = "mv"; right.textContent = "›"; right.title = "nach rechts";
        right.addEventListener("click", (ev) => { ev.stopPropagation(); this._moveList(i, 1); });
        const nm = document.createElement("span"); nm.textContent = this._name(eid);
        chip.appendChild(left); chip.appendChild(nm); chip.appendChild(right);
      } else {
        const ic = document.createElement("ha-icon"); ic.setAttribute("icon", this._icon(eid));
        const nm = document.createElement("span"); nm.textContent = this._name(eid);
        const cnt = document.createElement("span"); cnt.className = "cnt"; cnt.textContent = open;
        chip.appendChild(ic); chip.appendChild(nm); chip.appendChild(cnt);
        chip.addEventListener("click", () => this._selectList(eid));
      }
      el.appendChild(chip);
    }
    // Sortier-Umschalter
    if (this._order.length > 1) {
      const tool = document.createElement("button");
      tool.className = "tool" + (this._sortMode ? " on" : "");
      tool.innerHTML = this._sortMode
        ? `<ha-icon icon="mdi:check"></ha-icon><span>Fertig</span>`
        : `<ha-icon icon="mdi:swap-horizontal"></ha-icon><span>Sortieren</span>`;
      tool.addEventListener("click", () => this._toggleSort());
      el.appendChild(tool);
    }
  }

  _renderSelected() {
    const eid = this._selected;
    const c = this._contentEl;
    if (!c) return;
    c.innerHTML = "";
    if (!eid) { c.innerHTML = `<div class="hint">Keine Liste vorhanden. Lege unten eine neue an.</div>`; this._cur = null; return; }

    const kopf = document.createElement("div");
    kopf.className = "kopf";
    kopf.innerHTML = `<ha-icon icon="${this._icon(eid)}"></ha-icon><span></span>`;
    kopf.querySelector("span").textContent = this._name(eid);

    const addRow = document.createElement("div");
    addRow.className = "add";
    const input = document.createElement("input");
    input.type = "text"; input.placeholder = "Hinzufügen…";
    const addBtn = document.createElement("button");
    addBtn.title = "Hinzufügen"; addBtn.textContent = "+";
    addRow.appendChild(input); addRow.appendChild(addBtn);

    const ulAktiv = document.createElement("ul"); ulAktiv.className = "aktiv";

    const details = document.createElement("details"); details.className = "fertig";
    const summary = document.createElement("summary");
    summary.innerHTML = `<ha-icon class="chev" icon="mdi:chevron-right"></ha-icon><span class="label">Erledigt</span>`;
    const ulFertig = document.createElement("ul"); ulFertig.className = "erledigt";
    const clear = document.createElement("div"); clear.className = "clear"; clear.textContent = "Erledigte löschen";
    details.appendChild(summary); details.appendChild(ulFertig); details.appendChild(clear);

    const doAdd = () => { const v = input.value.trim(); if (v) { this._add(eid, v); input.value = ""; input.focus(); } };
    addBtn.addEventListener("click", doAdd);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
    clear.addEventListener("click", () => this._clearCompleted(eid));

    c.appendChild(kopf); c.appendChild(addRow); c.appendChild(ulAktiv); c.appendChild(details);
    this._cur = { eid, ulAktiv, ulFertig, details, label: summary.querySelector(".label") };

    const st = this._hass.states[eid];
    this._contentSig[eid] = st ? `${st.state}|${st.last_updated}` : "missing";
    if (this._items[eid]) this._renderItems();
    this._fetchSelected();
  }

  async _fetchSelected() {
    const eid = this._selected;
    if (!eid || !this._hass) return;
    try {
      const r = await this._hass.callWS({ type: "todo/item/list", entity_id: eid });
      this._items[eid] = (r && r.items) || [];
      if (this._cur && this._cur.eid === eid) this._renderItems();
    } catch (e) {
      console.error("Listen-Card: Konnte Einträge nicht laden für", eid, e);
    }
  }

  _renderItems() {
    const s = this._cur;
    if (!s) return;
    const items = this._items[s.eid] || [];
    const aktiv = items.filter((i) => i.status !== "completed");
    const fertig = items.filter((i) => i.status === "completed");

    s.ulAktiv.innerHTML = "";
    if (!aktiv.length) {
      const leer = document.createElement("div");
      leer.className = "leer"; leer.textContent = "Keine offenen Punkte 🎉";
      s.ulAktiv.appendChild(leer);
    } else {
      for (const it of aktiv) s.ulAktiv.appendChild(this._row(s.eid, it, false));
    }
    s.ulFertig.innerHTML = "";
    for (const it of fertig) s.ulFertig.appendChild(this._row(s.eid, it, true));
    s.details.style.display = fertig.length ? "" : "none";
    s.label.textContent = `Erledigt (${fertig.length})`;
  }

  _row(eid, item, done) {
    const li = document.createElement("li");
    if (done) li.className = "done";
    const box = document.createElement("span"); box.className = "box";
    if (done) box.innerHTML = `<ha-icon icon="mdi:check"></ha-icon>`;
    const txt = document.createElement("span"); txt.className = "txt"; txt.textContent = item.summary;
    li.appendChild(box); li.appendChild(txt);
    li.addEventListener("click", () => this._toggle(eid, item, done));
    return li;
  }

  // ---- Auswahl / Sortierung ----
  _selectList(eid) { this._selected = eid; this._saveSelected(); this._sortMode = false; this.hass = this._hass; }
  _toggleSort() { this._sortMode = !this._sortMode; this._selSig = null; this.hass = this._hass; }
  _moveList(index, dir) {
    const j = index + dir;
    if (j < 0 || j >= this._order.length) return;
    const o = this._order.slice();
    const tmp = o[index]; o[index] = o[j]; o[j] = tmp;
    this._order = o; this._saveOrder();
    this._selSig = null; this.hass = this._hass;
  }

  // ---- Mutationen ----
  _toggle(eid, item, done) {
    this._hass.callService("todo", "update_item",
      { item: item.uid, status: done ? "needs_action" : "completed" }, { entity_id: eid });
    setTimeout(() => this._fetchSelected(), 300);
  }
  _add(eid, summary) {
    this._hass.callService("todo", "add_item", { item: summary }, { entity_id: eid });
    setTimeout(() => this._fetchSelected(), 300);
  }
  _clearCompleted(eid) {
    this._hass.callService("todo", "remove_completed_items", {}, { entity_id: eid });
    setTimeout(() => this._fetchSelected(), 300);
  }
  async _createList(name) {
    try {
      const flow = await this._hass.callApi("POST", "config/config_entries/flow",
        { handler: "local_todo", show_advanced_options: false });
      if (flow && flow.flow_id) {
        await this._hass.callApi("POST", "config/config_entries/flow/" + flow.flow_id, { todo_list_name: name });
      }
    } catch (e) {
      console.error("Listen-Card: Liste anlegen fehlgeschlagen", e);
      alert("Liste konnte nicht angelegt werden: " + e);
    }
  }

  getCardSize() { return 6; }
  static getStubConfig() { return { show_all: true }; }
}

customElements.define("listen-card", ListenCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "listen-card",
  name: "Listen Card",
  description: "Eigene To-Do-Karte: Listenauswahl, sortierbar, erledigte einklappbar",
});

console.info(
  `%c LISTEN-CARD %c v${LISTEN_CARD_VERSION} `,
  "background:#03a9f4;color:#fff;border-radius:3px 0 0 3px;padding:2px 4px",
  "background:#555;color:#fff;border-radius:0 3px 3px 0;padding:2px 4px"
);
