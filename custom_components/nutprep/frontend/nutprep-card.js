// Carte Lovelace « custom:nutprep-card » : état de la PrEP ; un appui sur l'en-tête ouvre (ou ferme) le volet
// avec la prise, l'ajout d'un rapport, le lien vers le site et la frise. Prise et rapport se saisissent dans une fenêtre.
// Présentation commune aux cartes maison (charte des cartes Home Assistant, docs/CHARTE-GRAPHIQUE.md § 8, modèle Nutness).
// Sans dépendance : lit les attributs du capteur « Protection » de l'intégration NutPrep. Toute donnée reçue est échappée.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = (v) => (v ? new Date(v).getTime() : null);
const pad = (n) => String(n).padStart(2, '0');
const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const DAY = 864e5;
const startOf = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayShort = (t) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
const dayWord = (t) => ({ 0: 'aujourd’hui', 1: 'demain', [-1]: 'hier' }[Math.round((startOf(t) - startOf(Date.now())) / DAY)] ?? dayShort(t));
const localIso = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`; };
const duration = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${pad(m % 60)}` : ''}`);
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ } },
};
const DURATIONS = [15, 30, 60, 90, 120];
const QUICK = [0, -15, -30, -60];
const ROW = 30; // hauteur d'une ligne des roues (px), comme dans la feuille

const PHASES = {
  active: ['var(--success-color, #43a047)', 'mdi:shield-check', 'Protection active'],
  loading: ['var(--warning-color, #ffa000)', 'mdi:shield-sync', 'Bientôt protégé·e'],
  missed: ['var(--error-color, #e53935)', 'mdi:shield-alert', 'Prise manquée'],
  none: ['var(--disabled-text-color, #9e9e9e)', 'mdi:shield-outline', 'Pas de PrEP en cours'],
};
const ITEMS = {
  PILL: (e) => [e.count === 2 ? 'mdi:pill-multiple' : 'mdi:pill', e.count === 2 ? 'Deux comprimés' : 'Comprimé'],
  PROTECTION_START: () => ['mdi:shield-check', 'Début de la protection'],
  MISSED: () => ['mdi:shield-alert', 'Prise manquée'],
  END: () => ['mdi:shield-outline', 'Fin de la protection'],
  STOP: () => ['mdi:stop-circle-outline', 'Arrêt des prises'],
  INTERCOURSE: (e) => ['mdi:heart', 'Rapport', [...(e.partners ?? []), ...(e.extra ? [`+${e.extra}`] : [])].join(', ')],
};
const STATUS = { protected: 'mdi:shield-check', pending: 'mdi:clock-outline', unprotected: 'mdi:shield-off-outline' };

class NutPrepCard extends HTMLElement {
  setConfig(config) {
    this._config = config ?? {};
    this._key = `nutprep-card:${config?.entity ?? 'auto'}`;
    this._open = store.get(`${this._key}:open`, Boolean(config?.timeline_open));
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card id="card"></ha-card><dialog id="dialog"></dialog>`;
      this._card = this.shadowRoot.getElementById('card');
      this._dialog = this.shadowRoot.getElementById('dialog');
      this._card.addEventListener('click', (e) => this.onCardClick(e));
      this._card.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.act === 'toggle') { e.preventDefault(); this.toggle(); } });
      this._dialog.addEventListener('click', (e) => this.onDialogClick(e));
      this._dialog.addEventListener('submit', (e) => this.onSubmit(e));
      this._dialog.addEventListener('close', () => { this._form = null; });
    }
  }

  getCardSize() { return this._open ? 6 : 1; }
  getGridOptions() { return { columns: 12, min_columns: 6 }; }
  static getStubConfig() { return {}; }

  set hass(hass) {
    this._hass = hass;
    const id = this._config.entity
      ?? Object.keys(hass.states).find((k) => k.startsWith('sensor.') && hass.states[k].attributes?.nutprep_timeline);
    const st = id ? hass.states[id] : null;
    // Pas de rendu si rien n'a changé (la carte reçoit tous les changements de Home Assistant).
    if (st && st === this._state && this._rendered) return;
    this._state = st;
    this.render();
  }

  disconnectedCallback() { if (this._dialog?.open) this._dialog.close(); }

  // ───── Carte ─────

  // Prise imposée : 2 comprimés pour (re)commencer, 1 pendant une suite (le site décide, la carte l'annonce).
  get count() { return this._state?.state === 'active' || this._state?.state === 'loading' ? 1 : 2; }

  render() {
    this._rendered = true;
    const st = this._state;
    if (!st) { this._card.innerHTML = `<div class="empty">Intégration NutPrep introuvable</div>`; return; }
    const a = st.attributes;
    const [color, icon, title] = PHASES[st.state] ?? PHASES.none;
    const now = Date.now();
    const from = ms(a.next_from); const to = ms(a.next_to);
    let line;
    if (from) {
      if (now < from) line = `Prochaine prise ${dayWord(from)} ${hm(from)} – ${hm(to)}`;
      else if (now <= ms(a.next_planned)) line = `Prise à faire, avant ${hm(to)}`;
      else line = `En retard : avant ${hm(to)}`;
    } else if (st.state === 'loading' && a.protected_from) line = `Protection à ${hm(ms(a.protected_from))}`;
    else line = 'Commencer : 2 comprimés';
    const late = from && now > ms(a.next_planned);
    const pending = a.nutprep_pending ?? [];
    this._card.innerHTML = `
      <div class="head" data-act="toggle" role="button" tabindex="0" aria-expanded="${this._open}">
        <div class="badge" style="--c:${color}"><ha-icon icon="${icon}"></ha-icon></div>
        <div class="txt"><div class="primary">${title}${pending.length ? `<span class="count" title="Rapports en attente de prises"><ha-icon icon="mdi:heart"></ha-icon>${pending.length}</span>` : ''}</div>
          <div class="secondary${late ? ' late' : ''}">${esc(line)}</div></div>
        <ha-icon class="chev" icon="${this._open ? 'mdi:chevron-up' : 'mdi:chevron-down'}"></ha-icon>
      </div>
      ${this._open ? `<div class="body">
        ${pending.map((p) => `<div class="pending"><ha-icon icon="mdi:heart"></ha-icon>Rapport ${esc(dayWord(p.at))} ${hm(p.at)} · encore ${p.remaining} prise${p.remaining > 1 ? 's' : ''}</div>`).join('')}
        <div class="bar">
          <button class="btn main" data-act="pill"><ha-icon icon="${this.count === 2 ? 'mdi:pill-multiple' : 'mdi:pill'}"></ha-icon>${this.count === 2 ? '2 comprimés' : 'Prise'}</button>
          <button class="btn" data-act="report"><ha-icon icon="mdi:heart-plus"></ha-icon>Rapport</button>
          <a class="more" href="${esc(a.site)}/?from=ha" target="_blank" rel="noopener" title="Voir plus" aria-label="Voir plus"><ha-icon icon="mdi:open-in-new"></ha-icon></a>
        </div>
        ${this.timeline(a)}
      </div>` : ''}`;
  }

  // Frise : le jour figure dans la colonne de l'heure, sur la première ligne du jour.
  timeline(a) {
    let html = '';
    let d = '';
    for (const e of (a.nutprep_timeline ?? []).slice(0, 60)) {
      const f = ITEMS[e.type];
      if (!f) continue;
      const label = dayShort(e.at);
      const [icon, text, detail] = f(e);
      html += `<div class="item p-${esc(e.period)}"><span class="time">${label !== d ? `<b>${esc(label)}</b>` : ''}${hm(e.at)}</span><span class="dot"></span>
        <ha-icon class="ico t-${esc(e.type)}" icon="${icon}"></ha-icon><span class="text">${esc(text)}${detail ? ` <small>${esc(detail)}</small>` : ''}</span>
        ${e.status ? `<ha-icon class="st s-${esc(e.status)}" icon="${STATUS[e.status]}"></ha-icon>` : ''}</div>`;
      d = label;
    }
    return `<div class="tl">${html || '<div class="empty">Rien sur 30 jours</div>'}</div>`;
  }

  toggle() { this._open = !this._open; store.set(`${this._key}:open`, this._open); this.render(); }

  onCardClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'toggle') this.toggle();
    else this.openForm(b.dataset.act);
  }

  // ───── Fenêtres de saisie ─────

  openForm(kind) {
    this._form = { kind, at: Math.floor(Date.now() / 60e3) * 60e3, dur: 30, chosen: new Set() };
    const all = this._state?.attributes?.nutprep_partners ?? [];
    const pill = kind === 'pill';
    const two = pill && this.count === 2;
    this._dialog.innerHTML = `<form>
      <div class="dhead"><ha-icon icon="${pill ? (two ? 'mdi:pill-multiple' : 'mdi:pill') : 'mdi:heart-plus'}"></ha-icon><span>${pill ? (two ? '2 comprimés' : 'Prise') : 'Rapport'}</span>
        <button type="button" class="icon" data-act="close" title="Fermer" aria-label="Fermer"><ha-icon icon="mdi:close"></ha-icon></button></div>
      ${this.pickerHtml()}
      ${pill ? '' : `<div class="chips" title="Durée"><ha-icon class="lead" icon="mdi:timer-outline"></ha-icon>${DURATIONS.map((m) => `<button type="button" class="chip${m === 30 ? ' on' : ''}" data-dur="${m}">${duration(m)}</button>`).join('')}</div>
        <div class="chips" data-partners>${all.slice(0, 12).map((p) => `<button type="button" class="chip" data-partner="${esc(p)}">${esc(p)}</button>`).join('')}</div>
        <div class="row"><input name="name" list="np-partners" placeholder="Partenaire" autocomplete="off">
          <datalist id="np-partners">${all.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
          <button type="button" class="icon" data-act="add-partner" title="Ajouter" aria-label="Ajouter"><ha-icon icon="mdi:account-plus"></ha-icon></button></div>`}
      <button type="submit" class="btn main grow"><ha-icon icon="mdi:check"></ha-icon><span data-at>${hm(this._form.at)}</span></button>
    </form>`;
    this._dialog.showModal();
    this.syncPicker(false);
  }

  // Sélecteur : jours, roues heure et minutes, raccourcis (même geste que le sélecteur <nl-datetime> du site).
  pickerHtml() {
    const today = startOf(Date.now());
    const days = Array.from({ length: 7 }, (_, i) => today - i * DAY);
    const wheel = (unit, n) => `<div class="wheel" data-unit="${unit}"><div class="wpad"></div>${Array.from({ length: n }, (_, i) => `<div class="wopt" data-v="${i}">${pad(i)}</div>`).join('')}<div class="wpad"></div></div>`;
    return `<div class="picker">
      <div class="days">${days.map((d, i) => `<button type="button" class="chip" data-day="${d}">${['Auj.', 'Hier'][i] ?? dayShort(d)}</button>`).join('')}</div>
      <div class="clock">${wheel('h', 24)}<span class="sep">:</span>${wheel('m', 60)}</div>
      <div class="quick">${QUICK.map((q) => `<button type="button" class="chip" data-q="${q}">${q ? `−${-q % 60 ? `${-q} min` : `${-q / 60} h`}` : 'Maint.'}</button>`).join('')}</div>
    </div>`;
  }

  setAt(t, smooth = true) {
    this._form.at = Math.min(Math.floor(t / 60e3) * 60e3, Date.now() + 5 * 60e3);
    this.syncPicker(smooth);
  }

  syncPicker(smooth) {
    const d = new Date(this._form.at);
    const day = String(startOf(this._form.at));
    this._dialog.querySelectorAll('[data-day]').forEach((b) => b.classList.toggle('on', b.dataset.day === day));
    this._dialog.querySelector('[data-at]').textContent = hm(this._form.at);
    for (const w of this._dialog.querySelectorAll('.wheel')) {
      const v = w.dataset.unit === 'h' ? d.getHours() : d.getMinutes();
      w.querySelectorAll('.wopt').forEach((o) => o.classList.toggle('on', Number(o.dataset.v) === v));
      if (Math.round(w.scrollTop / ROW) !== v) w.scrollTo({ top: v * ROW, behavior: smooth ? 'smooth' : 'instant' });
      if (w._bound) continue;
      w._bound = true;
      let timer;
      // Fin du défilement (doigt, molette) : la ligne au centre devient la valeur.
      w.addEventListener('scroll', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!this._form) return;
          const cur = new Date(this._form.at);
          const n = Math.round(w.scrollTop / ROW);
          if (n === (w.dataset.unit === 'h' ? cur.getHours() : cur.getMinutes())) return;
          if (w.dataset.unit === 'h') cur.setHours(n); else cur.setMinutes(n);
          this.setAt(cur.getTime());
        }, 90);
      }, { passive: true });
    }
  }

  onDialogClick(e) {
    if (e.target === this._dialog) { this._dialog.close(); return; }
    const b = e.target.closest('button, .wopt');
    if (!b || !this._form) return;
    const f = this._form;
    const d = new Date(f.at);
    if (b.dataset.act === 'close') this._dialog.close();
    else if (b.dataset.day) { const n = new Date(Number(b.dataset.day)); n.setHours(d.getHours(), d.getMinutes()); this.setAt(n.getTime()); }
    else if (b.dataset.q) this.setAt(Date.now() + Number(b.dataset.q) * 60e3);
    else if (b.classList.contains('wopt')) { if (b.parentElement.dataset.unit === 'h') d.setHours(Number(b.dataset.v)); else d.setMinutes(Number(b.dataset.v)); this.setAt(d.getTime()); }
    else if (b.dataset.dur) { f.dur = Number(b.dataset.dur); this._dialog.querySelectorAll('[data-dur]').forEach((x) => x.classList.toggle('on', x === b)); }
    else if (b.dataset.partner) { const p = b.dataset.partner; if (f.chosen.has(p)) f.chosen.delete(p); else f.chosen.add(p); b.classList.toggle('on'); }
    else if (b.dataset.act === 'add-partner') this.addPartner();
  }

  addPartner() {
    const input = this._dialog.querySelector('input[name=name]');
    const name = input.value.trim();
    input.value = '';
    if (!name || this._form.chosen.has(name)) return;
    this._form.chosen.add(name);
    const chip = [...this._dialog.querySelectorAll('[data-partner]')].find((c) => c.dataset.partner === name);
    if (chip) chip.classList.add('on');
    else this._dialog.querySelector('[data-partners]').insertAdjacentHTML('afterbegin', `<button type="button" class="chip on" data-partner="${esc(name)}">${esc(name)}</button>`);
  }

  async onSubmit(e) {
    e.preventDefault();
    const f = this._form;
    if (!f || this._busy) return;
    this._busy = true;
    const submit = this._dialog.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      if (f.kind === 'pill') await this._hass.callService('nutprep', 'prendre', { heure: localIso(f.at) });
      else {
        if (this._dialog.querySelector('input[name=name]').value.trim()) this.addPartner();
        await this._hass.callService('nutprep', 'ajouter_rapport', { debut: localIso(f.at), duree: f.dur, partenaires: [...f.chosen] });
      }
      this._dialog.close();
    } catch (err) {
      submit.disabled = false;
      this._hass.callService('persistent_notification', 'create', { title: 'NutPrep', message: String(err.message ?? err) }).catch(() => null);
    } finally { this._busy = false; }
  }
}

const CSS = `
  ha-card { padding: 8px 12px; overflow: hidden; }
  .empty { padding: 8px 0; color: var(--secondary-text-color); font-size: 13px; }
  button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
  .head { display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 4px 0; outline: none; }
  .badge { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; flex: none;
    color: var(--c); background: color-mix(in srgb, var(--c) 20%, transparent); }
  .txt { min-width: 0; flex: 1; }
  .primary { font-weight: 500; font-size: 14px; color: var(--primary-text-color); display: flex; align-items: center; gap: 8px; }
  .secondary { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .secondary.late { color: var(--warning-color, #ffa000); font-weight: 500; }
  .count { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; color: var(--primary-color); }
  .count ha-icon { --mdc-icon-size: 14px; }
  .chev { --mdc-icon-size: 20px; color: var(--secondary-text-color); flex: none; }
  .body { margin-top: 4px; border-top: 1px solid var(--divider-color); padding-top: 8px; }
  .pending { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--primary-color); margin-bottom: 6px; }
  .pending ha-icon { --mdc-icon-size: 14px; }
  .bar { display: flex; align-items: center; gap: 8px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 16px;
    background: var(--secondary-background-color); color: var(--primary-text-color); font-size: 13px; font-weight: 500; }
  .btn ha-icon { --mdc-icon-size: 18px; }
  .btn.main { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .btn:disabled { opacity: .5; }
  .more { margin-left: auto; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; color: var(--secondary-text-color); }
  .more:hover { background: var(--secondary-background-color); }
  .more ha-icon { --mdc-icon-size: 16px; }
  .tl { margin-top: 8px; max-height: 320px; overflow-y: auto; }
  .item { position: relative; display: flex; align-items: center; gap: 6px; min-height: 26px; font-size: 13px; }
  .item::before { content: ""; position: absolute; left: 44px; top: 0; bottom: 0; border-left: 2px solid var(--disabled-text-color, #666); }
  .item.p-protected::before { border-left-color: var(--success-color, #43a047); }
  .item.p-pending::before { border-left: 2px dashed var(--primary-color); }
  .time { width: 38px; flex: none; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.15; font-size: 11px;
    color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .time b { color: var(--primary-text-color); font-size: 10px; font-weight: 600; white-space: nowrap; }
  .dot { position: relative; z-index: 1; width: 8px; height: 8px; margin: 0 2px 0 1px; border-radius: 50%; background: var(--disabled-text-color, #666); flex: none; }
  .p-protected .dot { background: var(--success-color, #43a047); }
  .p-pending .dot { background: var(--primary-color); }
  .ico { --mdc-icon-size: 16px; color: var(--primary-color); flex: none; }
  .t-INTERCOURSE { color: #ff6b8a; }
  .t-PROTECTION_START { color: var(--success-color, #43a047); }
  .t-MISSED { color: var(--error-color, #e53935); }
  .t-END, .t-STOP { color: var(--secondary-text-color); }
  .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .text small { color: var(--secondary-text-color); font-size: 12px; }
  .st { --mdc-icon-size: 14px; flex: none; }
  .s-protected { color: var(--success-color, #43a047); }
  .s-pending { color: var(--primary-color); }
  .s-unprotected { color: var(--error-color, #e53935); }
  dialog { padding: 0; border: none; border-radius: var(--ha-dialog-border-radius, 24px); width: min(420px, calc(100vw - 16px));
    max-height: min(88vh, 900px); background: var(--card-background-color, var(--ha-card-background, #1c1c1c));
    color: var(--primary-text-color); box-shadow: 0 8px 32px rgba(0, 0, 0, .45); }
  dialog::backdrop { background: rgba(0, 0, 0, .55); }
  dialog form { display: flex; flex-direction: column; gap: 10px; padding: 8px 16px 16px; }
  .dhead { display: flex; align-items: center; gap: 8px; font-weight: 500; font-size: 15px; }
  .dhead > ha-icon { --mdc-icon-size: 20px; color: var(--primary-color); }
  .dhead span { flex: 1; }
  button.icon { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--secondary-text-color); flex: none; }
  button.icon:hover { background: var(--secondary-background-color); }
  .chips, .days, .quick { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .days { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .chips .lead { --mdc-icon-size: 16px; color: var(--secondary-text-color); }
  .chip { flex: none; height: 28px; padding: 0 10px; border-radius: 14px; border: 1px solid var(--divider-color); font-size: 12px; white-space: nowrap; color: var(--secondary-text-color); }
  .chip.on { border-color: var(--primary-color); background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .picker { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; align-items: center; }
  .days { grid-column: 1 / -1; }
  .clock { position: relative; display: flex; align-items: center; padding: 0 6px; border-radius: 12px; background: var(--secondary-background-color); }
  .clock::before { content: ""; position: absolute; left: 4px; right: 4px; top: 50%; height: ${ROW}px; transform: translateY(-50%); border-radius: 8px;
    background: color-mix(in srgb, var(--primary-color) 20%, transparent); pointer-events: none; }
  .wheel { position: relative; width: 38px; height: ${ROW * 3}px; overflow-y: auto; scroll-snap-type: y mandatory; scrollbar-width: none; overscroll-behavior: contain;
    -webkit-mask-image: linear-gradient(transparent, #000 35%, #000 65%, transparent); mask-image: linear-gradient(transparent, #000 35%, #000 65%, transparent); }
  .wheel::-webkit-scrollbar, .days::-webkit-scrollbar { display: none; }
  .wpad, .wopt { height: ${ROW}px; line-height: ${ROW}px; text-align: center; }
  .wopt { scroll-snap-align: center; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--secondary-text-color); cursor: pointer; user-select: none; }
  .wopt.on { color: var(--primary-text-color); }
  .sep { position: relative; font-size: 18px; font-weight: 600; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row input { flex: 1; min-width: 0; height: 36px; padding: 0 10px; border: 1px solid var(--divider-color); border-radius: 10px;
    background: var(--card-background-color); color: var(--primary-text-color); font: inherit; }
  .grow { height: 36px; border-radius: 18px; }
  @media (max-width: 600px) { dialog { width: 100vw; max-width: 100vw; border-radius: 16px 16px 0 0; margin: auto auto 0; }
    dialog form { padding-bottom: max(16px, env(safe-area-inset-bottom)); } }
`;

if (!customElements.get('nutprep-card')) {
  customElements.define('nutprep-card', NutPrepCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: 'nutprep-card', name: 'NutPrep', description: 'PrEP : protection, prise, rapport, historique', preview: false });
}
