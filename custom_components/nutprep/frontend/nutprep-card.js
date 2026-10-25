// Carte Lovelace « custom:nutprep-card » : état de la PrEP, prise, ajout d'un rapport, frise en volet, lien vers le site.
// Sans dépendance : lit les attributs du capteur « Protection » de l'intégration NutPrep. Toute donnée reçue est échappée.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = (v) => (v ? new Date(v).getTime() : null);
const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const day = (t) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
const startOf = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayWord = (t) => ({ 0: 'aujourd’hui', 1: 'demain', [-1]: 'hier' }[Math.round((startOf(t) - startOf(Date.now())) / 864e5)] ?? day(t));
const pad = (n) => String(n).padStart(2, '0');
const localInput = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const duration = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${pad(m % 60)}` : ''}`);
const DURATIONS = [15, 30, 60, 90, 120];

const PHASES = {
  active: ['ok', 'mdi:shield-check', 'Protection active'],
  loading: ['warn', 'mdi:shield-sync', 'Bientôt protégé·e'],
  missed: ['bad', 'mdi:shield-alert', 'Prise manquée'],
  none: ['off', 'mdi:shield-off-outline', 'Pas de PrEP en cours'],
};
const ITEMS = {
  PILL: (e) => [e.count === 2 ? 'mdi:pill-multiple' : 'mdi:pill', e.count === 2 ? 'Deux comprimés' : 'Comprimé'],
  PROTECTION_START: () => ['mdi:shield-check', 'Début de la protection'],
  MISSED: () => ['mdi:shield-alert', 'Prise manquée'],
  INTERCOURSE: (e) => ['mdi:heart', ['Rapport', [...(e.partners ?? []), ...(e.extra ? [`+${e.extra}`] : [])].join(', ')].filter(Boolean).join(' · ')],
};
const STATUS = { protected: 'mdi:shield-check', pending: 'mdi:clock-outline', unprotected: 'mdi:shield-off-outline' };

class NutPrepCard extends HTMLElement {
  setConfig(config) {
    this._config = config ?? {};
    this._open = config?.timeline_open ? 'timeline' : null;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
  }

  getCardSize() { return this._open ? 6 : 3; }
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
    // Saisie d'un rapport en cours : pas de rendu qui effacerait le formulaire.
    if (!this._busy && this._open !== 'report') this.render();
  }

  render() {
    this._rendered = true;
    const st = this._state;
    if (!st) { this.shadowRoot.innerHTML = `<ha-card><div class="empty">Intégration NutPrep introuvable</div></ha-card>`; return; }
    const a = st.attributes;
    const [kind, icon, title] = PHASES[st.state] ?? PHASES.none;
    const now = Date.now();
    let line = '';
    const from = ms(a.next_from); const to = ms(a.next_to);
    if (from) {
      if (now < from) line = `Prochaine prise ${dayWord(from)} ${hm(from)} – ${hm(to)}`;
      else if (now <= ms(a.next_planned)) line = `Prise à faire maintenant, avant ${hm(to)}`;
      else line = `En retard : avant ${hm(to)}`;
    } else if (st.state === 'loading' && a.protected_from) line = `Protection à ${hm(ms(a.protected_from))}`;
    else if (st.state === 'missed' || st.state === 'none') line = 'Commencer : 2 comprimés';
    const late = from && now > ms(a.next_planned);
    const pending = (a.nutprep_pending ?? []).map((p) => `<div class="pending"><ha-icon icon="mdi:heart"></ha-icon>Rapport ${esc(dayWord(p.at))} ${hm(p.at)} · encore ${p.remaining} prise${p.remaining > 1 ? 's' : ''}</div>`).join('');
    const count = st.state === 'active' || st.state === 'loading' ? 1 : 2;
    this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card>
      <div class="head ${kind}">
        <ha-icon icon="${icon}"></ha-icon>
        <div class="txt"><div class="title">${title}</div><div class="line${late ? ' late' : ''}">${esc(line)}</div></div>
      </div>
      ${pending}
      <div class="actions">
        <button class="act main${this._armed ? ' armed' : ''}" data-act="take" title="${count === 2 ? '2 comprimés pris' : 'C’est pris'}"><ha-icon icon="${count === 2 ? 'mdi:pill-multiple' : 'mdi:pill'}"></ha-icon><span>${this._armed ? 'Confirmer' : count === 2 ? '× 2' : 'Pris'}</span></button>
        <button class="act${this._open === 'report' ? ' on' : ''}" data-act="report" title="Ajouter un rapport"><ha-icon icon="mdi:heart-plus"></ha-icon></button>
        <button class="act${this._open === 'timeline' ? ' on' : ''}" data-act="timeline" title="Historique"><ha-icon icon="mdi:timeline-text-outline"></ha-icon></button>
        <a class="act" href="${esc(a.site)}/?from=ha" target="_blank" rel="noopener" title="Voir plus"><ha-icon icon="mdi:open-in-new"></ha-icon></a>
      </div>
      ${this._open === 'report' ? this.reportForm(a) : ''}
      ${this._open === 'timeline' ? this.timeline(a) : ''}
    </ha-card>`;
    this.shadowRoot.querySelector('ha-card').addEventListener('click', (e) => this.onClick(e));
    this.shadowRoot.querySelector('form')?.addEventListener('submit', (e) => this.onReport(e));
  }

  reportForm(a) {
    const partners = (a.nutprep_partners ?? []);
    const chosen = this._chosen ?? (this._chosen = new Set());
    const shown = [...new Set([...chosen, ...partners.slice(0, 8)])];
    return `<form class="panel">
      <div class="row"><input type="datetime-local" name="at" value="${localInput(Date.now())}">
        <select name="dur">${DURATIONS.map((m) => `<option value="${m}"${m === 30 ? ' selected' : ''}>${duration(m)}</option>`).join('')}</select></div>
      <div class="chips">${shown.map((p) => `<button type="button" class="chip${chosen.has(p) ? ' on' : ''}" data-partner="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <div class="row"><input name="name" list="np-partners" placeholder="Partenaire" autocomplete="off">
        <datalist id="np-partners">${partners.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
        <button type="button" class="act" data-act="add-partner" title="Ajouter"><ha-icon icon="mdi:account-plus"></ha-icon></button>
        <button type="submit" class="act main" title="Enregistrer"><ha-icon icon="mdi:check"></ha-icon></button></div>
    </form>`;
  }

  timeline(a) {
    let html = '';
    let d = '';
    for (const e of (a.nutprep_timeline ?? []).slice(0, 60)) {
      const f = ITEMS[e.type];
      if (!f) continue;
      const label = day(e.at);
      if (label !== d) { html += `<div class="day">${esc(label)}</div>`; d = label; }
      const [icon, text] = f(e);
      html += `<div class="item p-${esc(e.period)}"><span class="time">${hm(e.at)}</span><span class="dot"></span>
        <ha-icon class="ico t-${esc(e.type)}" icon="${icon}"></ha-icon><span class="text">${esc(text)}</span>
        ${e.status ? `<ha-icon class="st s-${esc(e.status)}" icon="${STATUS[e.status]}"></ha-icon>` : ''}</div>`;
    }
    return `<div class="panel tl">${html || '<div class="empty">Rien sur 30 jours</div>'}</div>`;
  }

  async call(service, data) {
    this._busy = true;
    try { await this._hass.callService('nutprep', service, data); } catch (err) {
      this._hass.callService('persistent_notification', 'create', { title: 'NutPrep', message: String(err.message ?? err) }).catch(() => null);
    } finally { this._busy = false; }
  }

  async onClick(e) {
    const b = e.target.closest('[data-act], [data-partner]');
    if (!b) return;
    const act = b.dataset.act;
    if (b.dataset.partner) {
      const p = b.dataset.partner;
      if (this._chosen.has(p)) this._chosen.delete(p); else this._chosen.add(p);
      b.classList.toggle('on');
      return;
    }
    if (act === 'take') {
      // Deux appuis : évite une prise notée par mégarde depuis un tableau de bord.
      if (!this._armed) { this._armed = true; this.render(); clearTimeout(this._armTimer); this._armTimer = setTimeout(() => { this._armed = false; this.render(); }, 3000); return; }
      this._armed = false;
      clearTimeout(this._armTimer);
      await this.call('prendre', {});
      this.render();
    } else if (act === 'report' || act === 'timeline') {
      this._open = this._open === act ? null : act;
      if (act === 'report') this._chosen = new Set();
      this.render();
    } else if (act === 'add-partner') {
      const input = this.shadowRoot.querySelector('input[name=name]');
      const name = input.value.trim();
      if (!name) return;
      this._chosen.add(name);
      const form = this.shadowRoot.querySelector('form');
      const at = form.at.value; const dur = form.dur.value;
      this.render();
      const f2 = this.shadowRoot.querySelector('form');
      f2.at.value = at; f2.dur.value = dur;
    }
  }

  async onReport(e) {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim();
    if (name) this._chosen.add(name);
    await this.call('ajouter_rapport', {
      debut: `${f.at.value}:00`,
      duree: Number(f.dur.value),
      partenaires: [...this._chosen],
    });
    this._open = null;
    this._chosen = new Set();
    this.render();
  }
}

const CSS = `
  ha-card { padding: 12px; }
  .empty { padding: 12px; color: var(--secondary-text-color); }
  .head { display: flex; align-items: center; gap: 12px; }
  .head > ha-icon { --mdc-icon-size: 30px; width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; flex: none; }
  .ok > ha-icon { color: var(--success-color, #46d369); background: rgba(70, 211, 105, .14); }
  .warn > ha-icon { color: var(--warning-color, #e5a00d); background: rgba(229, 160, 13, .14); }
  .bad > ha-icon { color: var(--error-color, #e50914); background: rgba(229, 9, 20, .14); }
  .off > ha-icon { color: var(--secondary-text-color); background: var(--secondary-background-color); }
  .txt { min-width: 0; }
  .title { font-weight: 700; font-size: 16px; }
  .line { color: var(--secondary-text-color); font-size: 14px; }
  .line.late { color: var(--warning-color, #e5a00d); font-weight: 600; }
  .pending { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 13px; color: var(--primary-color); }
  .pending ha-icon { --mdc-icon-size: 16px; }
  .actions { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 8px; margin-top: 12px; }
  .act { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 0 10px; border: 1px solid var(--divider-color);
    border-radius: 10px; background: var(--secondary-background-color); color: var(--primary-text-color); font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
  .act.on { border-color: var(--primary-color); color: var(--primary-color); }
  .act.main { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .act.armed { background: var(--warning-color, #e5a00d); border-color: var(--warning-color, #e5a00d); }
  .panel { margin-top: 12px; border-top: 1px solid var(--divider-color); padding-top: 10px; }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .row input, .row select { flex: 1; min-width: 0; min-height: 38px; padding: 0 10px; border: 1px solid var(--divider-color); border-radius: 10px;
    background: var(--card-background-color); color: var(--primary-text-color); font: inherit; }
  .row .act { flex: none; width: 44px; padding: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .chip { padding: 5px 10px; border: 1px solid var(--divider-color); border-radius: 999px; background: none; color: var(--primary-text-color); font: inherit; font-size: 13px; cursor: pointer; }
  .chip.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .tl { max-height: 360px; overflow-y: auto; }
  .day { font-weight: 700; font-size: 13px; padding: 8px 0 4px 56px; text-transform: capitalize; }
  .item { position: relative; display: flex; align-items: center; gap: 8px; min-height: 30px; font-size: 14px; }
  .item::before { content: ""; position: absolute; left: 47px; top: 0; bottom: 0; border-left: 3px solid var(--disabled-text-color, #666); }
  .item.p-protected::before { border-left-color: var(--success-color, #46d369); }
  .item.p-pending::before { border-left: 3px dashed var(--primary-color); }
  .time { width: 38px; flex: none; text-align: right; font-size: 12px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .dot { position: relative; z-index: 1; width: 9px; height: 9px; margin: 0 4px 0 1px; border-radius: 50%; background: var(--disabled-text-color, #666); flex: none; }
  .p-protected .dot { background: var(--success-color, #46d369); }
  .p-pending .dot { background: var(--primary-color); }
  .ico { --mdc-icon-size: 18px; color: var(--primary-color); flex: none; }
  .t-INTERCOURSE { color: #ff6b8a; }
  .t-PROTECTION_START { color: var(--success-color, #46d369); }
  .t-MISSED { color: var(--error-color, #e50914); }
  .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .st { --mdc-icon-size: 16px; flex: none; }
  .s-protected { color: var(--success-color, #46d369); }
  .s-pending { color: var(--primary-color); }
  .s-unprotected { color: var(--error-color, #e50914); }
`;

customElements.define('nutprep-card', NutPrepCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'nutprep-card', name: 'NutPrep', description: 'PrEP : protection, prise, rapport, historique', preview: false });
