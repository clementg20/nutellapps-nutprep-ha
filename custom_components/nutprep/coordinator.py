"""État de la PrEP (lu toutes les 5 min, et après chaque action), déclencheurs et rappels de prise."""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import NutPrepApi, NutPrepAuthError, NutPrepError
from .const import (
    BUS_EVENT, CONF_EVERY, CONF_LEAD, CONF_NOTIFY, CONF_REMINDERS, DEFAULT_EVERY, DEFAULT_LEAD, DOMAIN, SCAN_INTERVAL, TICK,
)

_LOGGER = logging.getLogger(__name__)

# Un rappel en retard de plus de 10 min (Home Assistant redémarré) n'est plus envoyé.
STALE_MS = 10 * 60_000


def hm(ms: int | None) -> str:
    return dt_util.as_local(datetime.fromtimestamp(ms / 1000, dt_util.UTC)).strftime("%H:%M") if ms else ""


def reminder_slots(nxt: dict[str, Any] | None, lead: int, every: int) -> list[dict[str, Any]]:
    """Mêmes rappels que le site (prep-lib.js reminderSlots) : `lead` min avant, puis toutes les `every` min dès l'heure prévue."""
    if not nxt:
        return []
    slots = []
    if lead > 0:
        slots.append({"at": nxt["planned"] - lead * 60_000, "kind": "pill_before"})
    step = max(5, every) * 60_000
    t = nxt["planned"]
    while t <= nxt["to"]:
        slots.append({"at": t, "kind": "pill_due" if t == nxt["planned"] else "pill_late"})
        t += step
    slots.append({"at": nxt["to"] + 1, "kind": "pill_missed"})
    return [{**s, "key": f"{nxt['last']}:{s['kind']}:{s['at']}"} for s in slots]


def message(kind: str, data: dict[str, Any]) -> tuple[str, str] | None:
    """(titre, texte) de la notification d'un déclencheur, ou None."""
    nxt = data.get("next") or {}
    if kind == "pill_before":
        minutes = round((nxt["planned"] - data["at"]) / 60_000)
        lead = f"{minutes // 60} h" if minutes % 60 == 0 else f"{minutes} min"
        return f"💊 PrEP dans {lead}", f"Prochaine prise entre {hm(nxt['from'])} et {hm(nxt['to'])}."
    if kind == "pill_due":
        return "💊 C'est l'heure de la PrEP", f"À prendre avant {hm(nxt['to'])}."
    if kind == "pill_late":
        return "⏰ PrEP pas encore prise", f"Il reste jusqu'à {hm(nxt['to'])} pour rester protégé·e."
    if kind == "pill_missed":
        return "⚠️ Prise de PrEP manquée", "La protection est interrompue : reprendre avec 2 comprimés."
    return None


class NutPrepCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Données : l'état renvoyé par /ha/v1/state (phase, prochaine prise, frise des 30 jours, partenaires)."""

    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, api: NutPrepApi) -> None:
        super().__init__(hass, _LOGGER, config_entry=entry, name=DOMAIN, update_interval=SCAN_INTERVAL)
        self.api = api
        self.me: dict[str, Any] = {}
        self._fired: set[str] = set()
        self._listeners_events: list = []
        self._last_pill: int | None = None
        self._phase: str | None = None

    def on_event(self, listener) -> callable:
        self._listeners_events.append(listener)
        return lambda: self._listeners_events.remove(listener)

    async def _async_setup(self) -> None:
        try:
            self.me = await self.api.me()
        except NutPrepAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except NutPrepError as err:
            raise UpdateFailed(str(err)) from err
        self.config_entry.async_on_unload(async_track_time_interval(self.hass, self._tick, TICK))

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            state = await self.api.state()
        except NutPrepAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except NutPrepError as err:
            raise UpdateFailed(str(err)) from err
        self._watch(state)
        return state

    def set_state(self, state: dict[str, Any]) -> None:
        """État renvoyé par une action (prise, rapport) : appliqué sans attendre la prochaine lecture."""
        self._watch(state)
        self.async_set_updated_data(state)

    def _watch(self, state: dict[str, Any]) -> None:
        last = state.get("lastPill")
        if self._last_pill is not None and last and last > self._last_pill:
            self._fire("pill_taken", {"at": last})
        self._last_pill = last

    @property
    def device_id(self) -> str | None:
        device = dr.async_get(self.hass).async_get_device(identifiers={(DOMAIN, self.config_entry.entry_id)})
        return device.id if device else None

    # ───── Déclencheurs et rappels ─────

    @callback
    def _tick(self, _now=None) -> None:
        state = self.data or {}
        now = int(time.time() * 1000)
        # Début de la protection (2 h après les 2 premiers comprimés).
        phase = "active" if state.get("phase") == "loading" and state.get("protectedFrom") and now >= state["protectedFrom"] else state.get("phase")
        if self._phase == "loading" and phase == "active":
            self._fire("protection_started", {"at": state.get("protectedFrom")})
        self._phase = phase
        options = self.config_entry.options
        lead = int(options.get(CONF_LEAD, DEFAULT_LEAD))
        every = int(options.get(CONF_EVERY, DEFAULT_EVERY))
        for slot in reminder_slots(state.get("next"), lead, every):
            if slot["at"] <= now < slot["at"] + STALE_MS and slot["key"] not in self._fired:
                self._fired.add(slot["key"])
                self._fire(slot["kind"], {"at": slot["at"], "next": state.get("next")})
        if len(self._fired) > 200:
            self._fired = set(list(self._fired)[-50:])

    def _fire(self, kind: str, data: dict[str, Any]) -> None:
        nxt = data.get("next") or (self.data or {}).get("next")
        payload = {
            "type": kind,
            "device_id": self.device_id,
            "config_entry_id": self.config_entry.entry_id,
            "at": data.get("at"),
            "planned": nxt.get("planned") if nxt else None,
            "from": nxt.get("from") if nxt else None,
            "to": nxt.get("to") if nxt else None,
        }
        self.hass.bus.async_fire(BUS_EVENT, payload)
        for listener in list(self._listeners_events):
            listener(kind, payload)
        self._notify(kind, {**data, "next": nxt})

    def _notify(self, kind: str, data: dict[str, Any]) -> None:
        options = self.config_entry.options
        targets = options.get(CONF_NOTIFY, [])
        if not options.get(CONF_REMINDERS, True) or not targets:
            return
        text = message(kind, data)
        if text is None:
            return
        title, body = text
        for target in targets:
            if target == "persistent_notification":
                self.hass.async_create_task(self.hass.services.async_call(
                    "persistent_notification", "create", {"title": title, "message": body, "notification_id": "nutprep_pill"}))
            elif self.hass.services.has_service("notify", target):
                self.hass.async_create_task(self.hass.services.async_call(
                    "notify", target, {"title": title, "message": body, "data": {"tag": "nutprep-pill", "group": "nutprep", "url": "/"}}))
