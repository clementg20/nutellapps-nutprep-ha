"""Entité « événement » : chaque déclencheur (rappel, prise manquée, prise notée, début de protection)."""

from __future__ import annotations

from homeassistant.components.event import EventEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import TRIGGERS
from .entity import NutPrepEntity


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([NutPrepEventEntity(entry.runtime_data, "pill_event")])


class NutPrepEventEntity(NutPrepEntity, EventEntity):
    _attr_event_types = TRIGGERS
    _attr_icon = "mdi:pill"

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self.coordinator.on_event(self._handle))

    @callback
    def _handle(self, kind: str, data: dict) -> None:
        self._trigger_event(kind, {k: v for k, v in data.items() if k in ("at", "planned", "from", "to")})
        self.async_write_ha_state()
