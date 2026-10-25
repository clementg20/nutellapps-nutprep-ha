"""Constantes de l'intégration NutPrep."""

from datetime import timedelta

DOMAIN = "nutprep"
SITE = "https://nutprep.cgrand.fr"
API_BASE = f"{SITE}/ha/v1"
AUTHORIZE_URL = f"{SITE}/autoriser"
VERSION = "1.1.1"

SCAN_INTERVAL = timedelta(minutes=5)
TICK = timedelta(seconds=30)
CONF_TOKEN = "token"

# Options : rappels de prise (2 h avant l'heure prévue, puis toutes les 30 min dès l'heure prévue).
CONF_NOTIFY = "notify"
CONF_REMINDERS = "reminders"
CONF_LEAD = "lead"
CONF_EVERY = "every"
DEFAULT_LEAD = 120
DEFAULT_EVERY = 30

# Déclencheurs (événement du bus `nutprep_event`, déclencheurs d'appareil, entité événement).
TRIGGERS = ["pill_before", "pill_due", "pill_late", "pill_missed", "pill_taken", "protection_started"]
BUS_EVENT = "nutprep_event"
STATIC_URL = "/nutprep_static"
CARD_URL = f"{STATIC_URL}/nutprep-card.js?v={VERSION}"
