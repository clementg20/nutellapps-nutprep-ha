"""Base commune des entités : un appareil « service » par compte relié."""

from __future__ import annotations

from typing import Any

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, SITE, VERSION
from .coordinator import NutPrepCoordinator


class NutPrepEntity(CoordinatorEntity[NutPrepCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, coordinator: NutPrepCoordinator, key: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_translation_key = key
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer="NutPrep",
            model="PrEP",
            sw_version=VERSION,
            entry_type=DeviceEntryType.SERVICE,
            configuration_url=f"{SITE}/?from=ha",
        )

    @property
    def state_data(self) -> dict[str, Any]:
        return self.coordinator.data or {}
