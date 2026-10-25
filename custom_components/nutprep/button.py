"""Bouton « Prise » : note la prise de maintenant (2 comprimés si la suite est à recommencer)."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import NutPrepError
from .entity import NutPrepEntity


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([NutPrepTakeButton(entry.runtime_data, "take")])


class NutPrepTakeButton(NutPrepEntity, ButtonEntity):
    _attr_icon = "mdi:pill"

    async def async_press(self) -> None:
        try:
            r = await self.coordinator.api.take()
        except NutPrepError as err:
            raise HomeAssistantError(str(err)) from err
        self.coordinator.set_state(r["state"])
