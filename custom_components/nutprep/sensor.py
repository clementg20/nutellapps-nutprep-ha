"""Capteurs : protection (état), prochaine prise et dernière prise (dates). La carte lit tout en attributs du premier."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import SITE
from .entity import NutPrepEntity

PHASES = ["active", "loading", "missed", "none"]


def ts(ms: int | None) -> datetime | None:
    return datetime.fromtimestamp(ms / 1000, dt_util.UTC) if ms else None


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    c = entry.runtime_data
    async_add_entities([ProtectionSensor(c, "protection"), NextPillSensor(c, "next_pill"), LastPillSensor(c, "last_pill")])


class ProtectionSensor(NutPrepEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = PHASES
    _attr_icon = "mdi:shield-check"
    # Frise et partenaires : pour la carte seulement, pas dans l'historique.
    _unrecorded_attributes = frozenset({"nutprep_timeline", "nutprep_partners", "nutprep_pending"})

    @property
    def native_value(self) -> str | None:
        s = self.state_data
        if s.get("phase") == "loading" and s.get("protectedFrom") and dt_util.utcnow() >= ts(s["protectedFrom"]):
            return "active"
        return s.get("phase")

    @property
    def icon(self) -> str:
        return {"active": "mdi:shield-check", "loading": "mdi:shield-sync", "missed": "mdi:shield-alert"}.get(self.native_value, "mdi:shield-off-outline")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        s = self.state_data
        nxt = s.get("next") or {}
        return {
            "protected_from": ts(s.get("protectedFrom")),
            "pending_from": ts(s.get("pendingFrom")),
            "pill": s.get("pill"),
            "next_from": ts(nxt.get("from")),
            "next_planned": ts(nxt.get("planned")),
            "next_to": ts(nxt.get("to")),
            "missed_at": ts(s.get("missedAt")),
            "nutprep_pending": s.get("pending", []),
            "nutprep_timeline": s.get("timeline", []),
            "nutprep_partners": [p["name"] for p in s.get("partners", [])],
            "site": SITE,
        }


class NextPillSensor(NutPrepEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:pill"

    @property
    def native_value(self) -> datetime | None:
        return ts((self.state_data.get("next") or {}).get("planned"))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        nxt = self.state_data.get("next") or {}
        return {"from": ts(nxt.get("from")), "to": ts(nxt.get("to"))}


class LastPillSensor(NutPrepEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:pill-multiple"

    @property
    def native_value(self) -> datetime | None:
        return ts(self.state_data.get("lastPill"))
