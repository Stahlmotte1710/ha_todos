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
const LISTEN_CARD_VERSION = "1.6.0";

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
    this._itemSort = false;
    this._detailUid = null;
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
      if (this._detailUid) {
        // Detailseite offen -> NICHT neu rendern (sonst schließt sich der Datums-Dialog)
      } else if (!this._cur || this._cur.eid !== this._selected) {
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
      .chip .mv.del ha-icon { --mdc-icon-size:16px; vertical-align:middle; }
      .chip .mv.del:hover { color: var(--error-color,#db4437); }
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
      .kopf .itemsort { margin-left:auto; border:none; background:transparent; color:var(--secondary-text-color); cursor:pointer; padding:2px 4px; line-height:1; }
      .kopf .itemsort.on { color: var(--primary-color); }
      .kopf .itemsort ha-icon { --mdc-icon-size:22px; }
      summary .clearIcon { margin-left:auto; border:none; background:transparent; color:var(--secondary-text-color); cursor:pointer; padding:0 2px; line-height:1; }
      summary .clearIcon:hover { color: var(--error-color,#db4437); }
      summary .clearIcon ha-icon { --mdc-icon-size:18px; }
      li.sortrow { justify-content:space-between; cursor:default; }
      li.sortrow .arrows { display:flex; gap:2px; flex:0 0 auto; }
      li.sortrow .mv { border:none; background:transparent; color:var(--primary-color); cursor:pointer; font-size:1rem; padding:2px 8px; line-height:1; }
      li.sortrow .mv:disabled { color:var(--disabled-text-color,#666); cursor:default; }
      li .txt { flex:1; }
      li .info { border:none; background:transparent; color:var(--secondary-text-color); cursor:pointer; padding:0 2px; flex:0 0 auto; }
      li .info ha-icon { --mdc-icon-size:20px; }
      li .info:hover { color: var(--primary-color); }
      li .duebadge { color: var(--secondary-text-color); font-size:0.78rem; flex:0 0 auto; white-space:nowrap; }
      li .duebadge.overdue { color: var(--error-color,#db4437); }
      li .rembadge { color: var(--primary-color); flex:0 0 auto; display:flex; align-items:center; }
      li .rembadge ha-icon { --mdc-icon-size:18px; }
      .detail { padding: 2px 0 6px; }
      .dhead { display:flex; align-items:center; gap:8px; padding:4px 0 8px; }
      .dhead .dback { border:none; background:transparent; color:var(--primary-text-color); cursor:pointer; padding:2px; line-height:1; }
      .dhead .dback ha-icon { --mdc-icon-size:24px; }
      .dhead .dtitle { font-weight:600; font-size:1.1rem; }
      .dfield { display:flex; flex-direction:column; gap:4px; padding:8px 0; }
      .dfield > span { color:var(--secondary-text-color); font-size:0.85rem; }
      .dfield input { background:transparent; border:none; border-bottom:1px solid var(--divider-color); color:var(--primary-text-color); font-size:1rem; padding:6px 2px; outline:none; color-scheme: dark light; }
      .dfield input:focus { border-bottom-color: var(--primary-color); }
      .dfield .dcreator { color:var(--primary-text-color); font-size:1rem; padding:6px 2px; }
      .dactions { display:flex; gap:12px; padding-top:14px; align-items:center; }
      .dactions .dsave { background:var(--primary-color); color:var(--text-primary-color,#fff); border:none; border-radius:18px; padding:8px 20px; cursor:pointer; font-size:0.95rem; }
      .dactions .ddelete { background:transparent; border:none; color:var(--error-color,#db4437); cursor:pointer; font-size:0.9rem; margin-left:auto; }

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
        const del = document.createElement("button");
        del.className = "mv del"; del.title = "Liste löschen";
        del.innerHTML = `<ha-icon icon="mdi:trash-can-outline"></ha-icon>`;
        del.addEventListener("click", (ev) => { ev.stopPropagation(); this._deleteList(eid); });
        chip.appendChild(left); chip.appendChild(nm); chip.appendChild(del); chip.appendChild(right);
      } else {
        const ic = document.createElement("ha-icon"); ic.setAttribute("icon", this._icon(eid));
        const nm = document.createElement("span"); nm.textContent = this._name(eid);
        const cnt = document.createElement("span"); cnt.className = "cnt"; cnt.textContent = open;
        chip.appendChild(ic); chip.appendChild(nm); chip.appendChild(cnt);
        chip.addEventListener("click", () => this._selectList(eid));
      }
      el.appendChild(chip);
    }
    // Bearbeiten-Umschalter (Reihenfolge ändern + löschen)
    if (this._order.length >= 1) {
      const tool = document.createElement("button");
      tool.className = "tool" + (this._sortMode ? " on" : "");
      tool.innerHTML = this._sortMode
        ? `<ha-icon icon="mdi:check"></ha-icon><span>Fertig</span>`
        : `<ha-icon icon="mdi:pencil"></ha-icon><span>Bearbeiten</span>`;
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
    if (this._detailUid) { this._cur = null; this._renderDetail(eid, this._detailUid); return; }

    const kopf = document.createElement("div");
    kopf.className = "kopf";
    kopf.innerHTML = `<ha-icon icon="${this._icon(eid)}"></ha-icon><span></span>`;
    kopf.querySelector("span").textContent = this._name(eid);
    // Umschalter: Einträge sortieren
    const isortBtn = document.createElement("button");
    isortBtn.className = "itemsort" + (this._itemSort ? " on" : "");
    isortBtn.title = this._itemSort ? "Sortieren beenden" : "Einträge sortieren";
    isortBtn.innerHTML = `<ha-icon icon="${this._itemSort ? "mdi:check" : "mdi:swap-vertical"}"></ha-icon>`;
    isortBtn.addEventListener("click", () => { this._itemSort = !this._itemSort; this._renderSelected(); });
    kopf.appendChild(isortBtn);

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
    summary.innerHTML = `<ha-icon class="chev" icon="mdi:chevron-right"></ha-icon><span class="label">Erledigt</span><button class="clearIcon" title="Alle erledigten löschen"><ha-icon icon="mdi:trash-can-outline"></ha-icon></button>`;
    const clearIcon = summary.querySelector(".clearIcon");
    clearIcon.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); this._clearCompleted(eid); });
    const ulFertig = document.createElement("ul"); ulFertig.className = "erledigt";
    details.appendChild(summary); details.appendChild(ulFertig);

    const doAdd = () => { const v = input.value.trim(); if (v) { this._add(eid, v); input.value = ""; input.focus(); } };
    addBtn.addEventListener("click", doAdd);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });

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
    } else if (this._itemSort) {
      aktiv.forEach((it, idx) => s.ulAktiv.appendChild(this._sortRow(s.eid, it, idx, aktiv.length)));
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
    if (!done) {
      // Fällig-Datum anzeigen (rot wenn überfällig)
      if (item.due) {
        const due = document.createElement("span"); due.className = "duebadge";
        const day = String(item.due).slice(0, 10);
        due.textContent = this._fmtDue(item.due);
        if (day < new Date().toISOString().slice(0, 10)) due.classList.add("overdue");
        li.appendChild(due);
      }
      // Erinnerungs-Icon anzeigen
      const meta = this._parseDesc(item.description || "");
      if (meta.remind) {
        const rem = document.createElement("span"); rem.className = "rembadge";
        rem.title = "Erinnerung: " + this._fmtRemind(meta.remind);
        rem.innerHTML = `<ha-icon icon="mdi:bell-ring-outline"></ha-icon>`;
        li.appendChild(rem);
      }
    }
    // Details-Icon (öffnet Detailseite; verhindert das Abhaken)
    const info = document.createElement("button"); info.className = "info"; info.title = "Details";
    info.innerHTML = `<ha-icon icon="mdi:information-outline"></ha-icon>`;
    info.addEventListener("click", (e) => { e.stopPropagation(); this._openDetail(item.uid); });
    li.appendChild(info);
    li.addEventListener("click", () => this._toggle(eid, item, done));
    return li;
  }

  _sortRow(eid, item, idx, n) {
    const li = document.createElement("li"); li.className = "sortrow";
    const txt = document.createElement("span"); txt.className = "txt"; txt.textContent = item.summary;
    const arrows = document.createElement("span"); arrows.className = "arrows";
    const up = document.createElement("button"); up.className = "mv"; up.textContent = "▲"; up.title = "nach oben";
    up.disabled = idx === 0; up.addEventListener("click", () => this._moveItem(eid, item, -1));
    const dn = document.createElement("button"); dn.className = "mv"; dn.textContent = "▼"; dn.title = "nach unten";
    dn.disabled = idx === n - 1; dn.addEventListener("click", () => this._moveItem(eid, item, 1));
    arrows.appendChild(up); arrows.appendChild(dn);
    li.appendChild(txt); li.appendChild(arrows);
    return li;
  }

  async _moveItem(eid, item, dir) {
    const aktiv = (this._items[eid] || []).filter((x) => x.status !== "completed");
    const i = aktiv.findIndex((x) => x.uid === item.uid);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= aktiv.length) return;
    const msg = { type: "todo/item/move", entity_id: eid, uid: item.uid };
    let prev; // uid des Eintrags, der danach VOR dem verschobenen stehen soll
    if (dir < 0) { if (i >= 2) prev = aktiv[i - 2].uid; }  // sonst an den Anfang
    else { prev = aktiv[i + 1].uid; }
    if (prev) msg.previous_uid = prev;
    try { await this._hass.callWS(msg); } catch (e) { console.error("Listen-Card: Verschieben fehlgeschlagen", e); }
    this._fetchSelected();
  }

  // ---- Detailseite ----
  _openDetail(uid) { this._detailUid = uid; this._renderSelected(); }
  _closeDetail() { this._detailUid = null; this._renderSelected(); }

  _parseDesc(desc) {
    const meta = { creator: null, remind: null, note: "" };
    const noteLines = [];
    for (const ln of (desc || "").split("\n")) {
      const mV = ln.match(/^Von:\s*(.+)$/);
      const mR = ln.match(/^Erinnerung:\s*(.+)$/);
      if (mV) meta.creator = mV[1].trim();
      else if (mR) meta.remind = mR[1].trim();
      else noteLines.push(ln);
    }
    meta.note = noteLines.join("\n").trim();
    return meta;
  }
  _serializeDesc(meta) {
    const parts = [];
    if (meta.creator) parts.push("Von: " + meta.creator);
    if (meta.remind) parts.push("Erinnerung: " + meta.remind);
    if (meta.note) parts.push(meta.note);
    return parts.join("\n");
  }
  _fmtDue(due) {
    const s = String(due).slice(0, 10);
    const p = s.split("-");
    if (p.length !== 3) return s;
    const cur = new Date().getFullYear();
    return p[2] + "." + p[1] + (parseInt(p[0]) !== cur ? "." + p[0] : ".");
  }
  _fmtRemind(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  _renderDetail(eid, uid) {
    const c = this._contentEl;
    const item = (this._items[eid] || []).find((x) => x.uid === uid);
    if (!item) { this._detailUid = null; this._renderSelected(); return; }
    const meta = this._parseDesc(item.description || "");
    const dueVal = item.due ? String(item.due).slice(0, 10) : "";
    let remindVal = "";
    if (meta.remind) { const d = new Date(meta.remind); if (!isNaN(d)) remindVal = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

    const wrap = document.createElement("div"); wrap.className = "detail";
    wrap.innerHTML = `
      <div class="dhead">
        <button class="dback" title="Zurück"><ha-icon icon="mdi:arrow-left"></ha-icon></button>
        <span class="dtitle">Details</span>
      </div>
      <label class="dfield"><span>Titel</span><input type="text" class="dname"></label>
      <div class="dfield"><span>Angelegt von</span><div class="dcreator"></div></div>
      <label class="dfield"><span>Fällig am</span><input type="date" class="ddue"></label>
      <label class="dfield"><span>Erinnerung (Push)</span><input type="datetime-local" class="dremind"></label>
      <div class="dactions">
        <button class="dsave">Speichern</button>
        <button class="ddelete">Eintrag löschen</button>
      </div>`;
    wrap.querySelector(".dname").value = item.summary;
    wrap.querySelector(".dcreator").textContent = meta.creator || "unbekannt";
    wrap.querySelector(".ddue").value = dueVal;
    wrap.querySelector(".dremind").value = remindVal;

    wrap.querySelector(".dback").addEventListener("click", () => this._closeDetail());
    wrap.querySelector(".dsave").addEventListener("click", () => {
      const name = wrap.querySelector(".dname").value.trim();
      const due = wrap.querySelector(".ddue").value;
      const remindLocal = wrap.querySelector(".dremind").value;
      this._saveDetail(eid, item, meta, name, due, remindLocal);
    });
    wrap.querySelector(".ddelete").addEventListener("click", () => {
      if (confirm(`Eintrag „${item.summary}" löschen?`)) {
        this._hass.callService("todo", "remove_item", { item: uid }, { entity_id: eid });
        this._detailUid = null; setTimeout(() => this._fetchSelected(), 300); this._renderSelected();
      }
    });
    c.appendChild(wrap);
  }

  _saveDetail(eid, item, meta, name, due, remindLocal) {
    const data = { item: item.uid };
    if (name && name !== item.summary) data.rename = name;
    data.due_date = due || null; // leer -> löschen
    const newMeta = { creator: meta.creator, note: meta.note, remind: null };
    if (remindLocal) { const d = new Date(remindLocal); if (!isNaN(d)) newMeta.remind = d.toISOString(); }
    data.description = this._serializeDesc(newMeta);
    this._hass.callService("todo", "update_item", data, { entity_id: eid });
    this._detailUid = null;
    this._renderSelected();
    setTimeout(() => this._fetchSelected(), 400);
  }

  // ---- Auswahl / Sortierung ----
  _selectList(eid) { this._selected = eid; this._saveSelected(); this._sortMode = false; this._itemSort = false; this._detailUid = null; this.hass = this._hass; }
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
    const data = { item: summary };
    const sf = (this._hass.states[eid] && this._hass.states[eid].attributes.supported_features) || 0;
    const who = this._hass.user && this._hass.user.name;
    if ((sf & 64) && who) data.description = "Von: " + who; // "angelegt von" automatisch
    this._hass.callService("todo", "add_item", data, { entity_id: eid });
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

  async _deleteList(eid) {
    const name = this._name(eid);
    if (!confirm(`Liste „${name}" wirklich löschen?\nAlle Einträge dieser Liste gehen dabei verloren.`)) return;
    try {
      const reg = await this._hass.callWS({ type: "config/entity_registry/get", entity_id: eid });
      const entryId = reg && reg.config_entry_id;
      if (!entryId) { alert("Diese Liste lässt sich hier nicht löschen."); return; }
      await this._hass.callApi("DELETE", "config/config_entries/entry/" + entryId);
      // Entität verschwindet -> Auto-Modus entfernt den Chip; Auswahl fällt zurück
      if (this._selected === eid) { this._selected = null; this._saveSelected(); }
    } catch (e) {
      console.error("Listen-Card: Liste löschen fehlgeschlagen", e);
      alert("Liste konnte nicht gelöscht werden: " + e);
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
