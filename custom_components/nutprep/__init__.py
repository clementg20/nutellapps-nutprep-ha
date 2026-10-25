"""NutPrep : suivi de la PrEP depuis Home Assistant (prise, rapports, rappels, déclencheurs, carte)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote

import voluptuous as vol

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

from .api import NutPrepApi, NutPrepAuthError, NutPrepError
from .const import CARD_URL, CONF_TOKEN, DOMAIN, STATIC_URL
from .coordinator import NutPrepCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR, Platform.EVENT, Platform.BUTTON]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type NutPrepConfigEntry = ConfigEntry[NutPrepCoordinator]

BASE = {vol.Optional("config_entry_id"): cv.string}
TAKE_SCHEMA = vol.Schema({**BASE, vol.Optional("heure"): cv.datetime})
STOP_SCHEMA = vol.Schema(BASE)
REPORT_SCHEMA = vol.Schema(
    {
        **BASE,
        vol.Optional("debut"): cv.datetime,
        vol.Optional("duree", default=30): vol.All(vol.Coerce(int), vol.Range(min=0, max=2880)),
        vol.Optional("partenaires", default=[]): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional("anonymes", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=99)),
        vol.Optional("etiquettes", default=[]): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional("risque", default=False): cv.boolean,
        vol.Optional("notes"): cv.string,
    }
)


LOADER_JS = """
const url = location.origin + '%s';
let n = 0, busy = false;
const load = () => {
  if (busy || customElements.get('nutprep-card')) return;
  busy = true;
  import(n ? url + '&r=' + n : url).then(() => { busy = false; }, () => {
    busy = false; n += 1;
    setTimeout(load, Math.min(30000, 1000 * 2 ** Math.min(n, 5)));
  });
};
load();
addEventListener('online', load);
addEventListener('pageshow', load);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
"""



def iso(value: datetime) -> str:
    """Date de l'action (heure locale de Home Assistant si sans fuseau) → ISO UTC."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt_util.get_default_time_zone())
    return dt_util.as_utc(value).isoformat()


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Actions et carte : enregistrées une fois pour toutes les entrées."""
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "frontend"), cache_headers=True)]
    )
    add_extra_js_url(hass, "data:text/javascript," + quote(LOADER_JS % CARD_URL))

    def coordinator_for(call: ServiceCall) -> NutPrepCoordinator:
        entry_id = call.data.get("config_entry_id")
        entries = [e for e in hass.config_entries.async_entries(DOMAIN) if e.state is ConfigEntryState.LOADED]
        if entry_id:
            entries = [e for e in entries if e.entry_id == entry_id]
        if not entries:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="no_entry")
        if len(entries) > 1:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="several_entries")
        return entries[0].runtime_data

    async def run(c: NutPrepCoordinator, coro, what: str) -> dict[str, Any]:
        try:
            r = await coro
        except NutPrepAuthError as err:
            c.config_entry.async_start_reauth(hass)
            raise HomeAssistantError(str(err)) from err
        except NutPrepError as err:
            _LOGGER.warning("%s : échec (%s)", what, err)
            raise HomeAssistantError(str(err)) from err
        c.set_state(r["state"])
        return {"event": r["event"]}

    async def take(call: ServiceCall) -> ServiceResponse:
        c = coordinator_for(call)
        at = call.data.get("heure")
        return await run(c, c.api.take(iso(at) if at else None), "Prise")

    async def stop(call: ServiceCall) -> ServiceResponse:
        c = coordinator_for(call)
        return await run(c, c.api.stop(), "Arrêt")

    async def report(call: ServiceCall) -> ServiceResponse:
        c = coordinator_for(call)
        start = call.data.get("debut") or dt_util.now()
        if start.tzinfo is None:
            start = start.replace(tzinfo=dt_util.get_default_time_zone())
        end = start + timedelta(minutes=call.data["duree"])
        body = {
            "at": iso(start),
            "end": iso(end),
            "newPartners": call.data["partenaires"],
            "extra": call.data["anonymes"],
            "tags": call.data["etiquettes"],
            "risky": call.data["risque"],
        }
        if call.data.get("notes"):
            body["notes"] = call.data["notes"]
        return await run(c, c.api.intercourse(body), "Rapport")

    hass.services.async_register(DOMAIN, "prendre", take, TAKE_SCHEMA, SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "arreter", stop, STOP_SCHEMA, SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "ajouter_rapport", report, REPORT_SCHEMA, SupportsResponse.OPTIONAL)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: NutPrepConfigEntry) -> bool:
    api = NutPrepApi(async_get_clientsession(hass), entry.data[CONF_TOKEN])
    coordinator = NutPrepCoordinator(hass, entry, api)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    # Les options (rappels) sont relues à chaque passage : rien à recharger quand elles changent.
    return True


async def async_unload_entry(hass: HomeAssistant, entry: NutPrepConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: NutPrepConfigEntry) -> None:
    """Intégration supprimée : la clé est révoquée côté serveur."""
    try:
        await NutPrepApi(async_get_clientsession(hass), entry.data[CONF_TOKEN]).revoke()
    except NutPrepError as err:
        _LOGGER.info("Révocation de la clé impossible (%s) : elle peut être révoquée dans les réglages de NutPrep", err)
