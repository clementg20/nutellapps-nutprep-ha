"""Client de l'API NutPrep (https://nutprep.cgrand.fr/ha/v1)."""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from .const import API_BASE, VERSION

TIMEOUT = aiohttp.ClientTimeout(total=30)
HEADERS = {"User-Agent": f"HomeAssistant-NutPrep/{VERSION}"}


class NutPrepError(Exception):
    """Erreur renvoyée par l'API (le message est celui du serveur)."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class NutPrepAuthError(NutPrepError):
    """Clé révoquée ou compte retiré : il faut reconnecter l'intégration."""


async def _request(
    session: aiohttp.ClientSession,
    method: str,
    path: str,
    *,
    token: str | None = None,
    params: dict[str, Any] | None = None,
    json: dict[str, Any] | None = None,
) -> Any:
    headers = dict(HEADERS)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with session.request(
            method, f"{API_BASE}{path}", headers=headers, params=params, json=json, timeout=TIMEOUT
        ) as resp:
            if resp.status == 204:
                return None
            try:
                body = await resp.json(content_type=None)
            except (aiohttp.ContentTypeError, ValueError):
                body = None
            detail = body.get("detail") if isinstance(body, dict) else None
            if resp.status == 401:
                raise NutPrepAuthError(detail or "Clé refusée", resp.status)
            if resp.status >= 400 and resp.status not in (202, 410):
                raise NutPrepError(detail or f"HTTP {resp.status}", resp.status)
            return body
    except (aiohttp.ClientError, asyncio.TimeoutError) as err:
        raise NutPrepError(f"Serveur NutPrep injoignable ({type(err).__name__})") from err


async def start_link(session: aiohttp.ClientSession, name: str) -> dict[str, Any]:
    """Demande un code de liaison (sans clé)."""
    return await _request(session, "POST", "/link", json={"name": name})


async def poll_link(session: aiohttp.ClientSession, device_code: str) -> dict[str, Any]:
    """État de la demande : pending, approved (avec la clé), denied, expired ou invalid."""
    return await _request(session, "POST", "/link/token", json={"device_code": device_code})


class NutPrepApi:
    """Appels authentifiés d'une entrée de configuration."""

    def __init__(self, session: aiohttp.ClientSession, token: str) -> None:
        self._session = session
        self._token = token

    async def _call(self, method: str, path: str, **kwargs: Any) -> Any:
        return await _request(self._session, method, path, token=self._token, **kwargs)

    async def me(self) -> dict[str, Any]:
        return await self._call("GET", "/me")

    async def state(self) -> dict[str, Any]:
        return await self._call("GET", "/state")

    async def take(self, count: int | None = None, at: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if count:
            body["count"] = count
        if at:
            body["at"] = at
        return await self._call("POST", "/pills", json=body)

    async def stop(self) -> dict[str, Any]:
        return await self._call("POST", "/stop", json={})

    async def intercourse(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._call("POST", "/intercourses", json=body)

    async def revoke(self) -> None:
        await self._call("DELETE", "/token")
