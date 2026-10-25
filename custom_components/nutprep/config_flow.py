"""Connexion de Home Assistant à NutPrep (code d'appareil, validé sur nutprep.cgrand.fr)."""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import NutPrepError, poll_link, start_link
from .const import (
    AUTHORIZE_URL, CONF_EVERY, CONF_LEAD, CONF_NOTIFY, CONF_REMINDERS, CONF_TOKEN, DEFAULT_EVERY, DEFAULT_LEAD, DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

# Réponses du serveur acceptées telles quelles : rien d'autre n'est ouvert ni enregistré.
USER_CODE = re.compile(r"^[A-Z0-9]{4}-[A-Z0-9]{4}$")
TOKEN = re.compile(r"^npp_[A-Za-z0-9_-]{20,100}$")


class NutPrepConfigFlow(ConfigFlow, domain=DOMAIN):
    """Ajout de l'intégration : page NutPrep ouverte, puis attente de l'autorisation."""

    VERSION = 1

    def __init__(self) -> None:
        self._link: dict[str, Any] | None = None
        self._poll_task: asyncio.Task | None = None
        self._result: dict[str, Any] | None = None
        self._failure = "denied"

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return NutPrepOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        session = async_get_clientsession(self.hass)
        try:
            self._link = await start_link(session, self.hass.config.location_name or "Home Assistant")
        except NutPrepError as err:
            _LOGGER.warning("Demande de liaison refusée : %s", err)
            return self.async_abort(reason="cannot_connect")
        if not isinstance(self._link, dict) or not USER_CODE.match(str(self._link.get("user_code", ""))):
            return self.async_abort(reason="cannot_connect")
        self._poll_task = self.hass.async_create_background_task(self._async_poll(), "nutprep_link_poll")
        return self.async_external_step(
            step_id="authorize",
            url=f"{AUTHORIZE_URL}?code={self._link['user_code']}",
            description_placeholders={"code": self._link["user_code"]},
        )

    async def _async_poll(self) -> None:
        """Interroge le serveur jusqu'à la décision, puis fait avancer l'assistant."""
        session = async_get_clientsession(self.hass)
        link = self._link
        deadline = asyncio.get_running_loop().time() + link["expires_in"]
        outcome: dict[str, Any] = {"status": "expired"}
        while asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(link.get("interval", 3))
            try:
                r = await poll_link(session, link["device_code"])
            except NutPrepError as err:
                _LOGGER.debug("Attente de l'autorisation : %s", err)
                continue
            if r and r.get("status") != "pending":
                outcome = r
                break
        await self.hass.config_entries.flow.async_configure(flow_id=self.flow_id, user_input=outcome)

    async def async_step_authorize(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input and user_input.get("status") == "approved" and TOKEN.match(str(user_input.get("token", ""))):
            self._result = user_input
            return self.async_external_step_done(next_step_id="finish")
        self._failure = "expired" if (user_input or {}).get("status") in ("expired", "invalid") else "denied"
        return self.async_external_step_done(next_step_id="failed")

    async def async_step_failed(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return self.async_abort(reason=self._failure)

    async def async_step_finish(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        account = self._result.get("account") or {}
        token = self._result["token"]
        unique_id = (account.get("email") or "").lower() or None
        if self.source == "reauth":
            entry = self._get_reauth_entry()
            if unique_id and entry.unique_id and unique_id != entry.unique_id:
                return self.async_abort(reason="wrong_account")
            return self.async_update_reload_and_abort(entry, data_updates={CONF_TOKEN: token})
        if unique_id:
            await self.async_set_unique_id(unique_id)
            self._abort_if_unique_id_configured(updates={CONF_TOKEN: token})
        title = f"NutPrep · {account['first_name']}" if account.get("first_name") else "NutPrep"
        return self.async_create_entry(title=title, data={CONF_TOKEN: token, "email": account.get("email")})

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is None:
            return self.async_show_form(step_id="reauth_confirm")
        return await self.async_step_user()

    @callback
    def async_remove(self) -> None:
        """Assistant fermé avant la fin : l'attente s'arrête."""
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()


class NutPrepOptionsFlow(OptionsFlow):
    """Rappels de prise : destinataires, délai avant l'heure prévue, intervalle ensuite."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        services = sorted(self.hass.services.async_services().get("notify", {}))
        targets = [s for s in services if s not in ("send_message", "notify", "persistent_notification")]
        options = self.config_entry.options
        minutes = lambda lo, hi, step: selector.NumberSelector(  # noqa: E731
            selector.NumberSelectorConfig(min=lo, max=hi, step=step, unit_of_measurement="min", mode=selector.NumberSelectorMode.BOX)
        )
        schema = vol.Schema(
            {
                vol.Optional(CONF_REMINDERS, default=options.get(CONF_REMINDERS, True)): selector.BooleanSelector(),
                vol.Optional(CONF_NOTIFY, default=options.get(CONF_NOTIFY, [])): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=["persistent_notification", *targets],
                        multiple=True,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                        translation_key="notify_target",
                        custom_value=False,
                    )
                ),
                vol.Optional(CONF_LEAD, default=options.get(CONF_LEAD, DEFAULT_LEAD)): minutes(0, 360, 5),
                vol.Optional(CONF_EVERY, default=options.get(CONF_EVERY, DEFAULT_EVERY)): minutes(5, 240, 5),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
