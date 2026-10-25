# NutPrep

> **Intégration privée.** Elle ne fonctionne qu'avec un compte sur [nutprep.cgrand.fr](https://nutprep.cgrand.fr).
> Pas de support public.

Suivi de la PrEP depuis Home Assistant : état de la protection, prochaine prise, prise en un appui,
ajout d'un rapport, historique des 30 derniers jours, rappels et déclencheurs pour les automatisations.

## Installation

1. **HACS** :

   [![Ouvrir dans HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=clementg20&repository=nutellapps-nutprep-ha&category=integration)

   Télécharger, puis redémarrer Home Assistant.

2. **Ajouter l'intégration** :

   [![Ajouter l'intégration](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=nutprep)

   Une page NutPrep s'ouvre : se connecter (code reçu par mail), puis **Autoriser**. Home Assistant termine tout seul.

3. **Carte** : modifier un tableau de bord → Ajouter une carte → **NutPrep** (`type: custom:nutprep-card`,
   option `timeline_open: true` pour l'ouvrir dépliée la première fois).

4. **Rappels** : Paramètres → Appareils et services → NutPrep → Configurer : destinataires (application mobile…),
   premier rappel avant l'heure prévue (2 h par défaut), puis intervalle (30 min par défaut) jusqu'à la fin de la fenêtre de ± 2 h.

## Ce que l'intégration apporte

| Élément | Rôle |
|---|---|
| Carte `custom:nutprep-card` | État et prochaine prise ; un appui sur l'en-tête déplie la prise, l'ajout d'un rapport (chacun dans sa fenêtre : jour, heure, raccourcis), l'historique et « Voir plus » vers le site |
| `sensor.…_protection` | `active`, `loading` (dans les 2 h après les 2 premiers comprimés), `missed` (un rapport n'a pas eu ses 2 prises), `none` ; fenêtre de la prochaine prise en attributs |
| `sensor.…_prochaine_prise`, `sensor.…_derniere_prise` | Dates |
| `button.…_prise` | Note la prise de maintenant (2 comprimés imposés si la suite est à recommencer, 1 sinon) |
| `event.…_prep` | Rappel avant, heure de prise, retard, prise manquée, prise notée, début de la protection |
| Déclencheurs d'appareil | Les mêmes, dans l'éditeur d'automatisations (Appareil → NutPrep) |
| Événement `nutprep_event` | Le même, sur le bus (`type`, `at`, `planned`, `from`, `to`) |

**Actions** : `nutprep.prendre` (heure ; nombre de comprimés imposé), `nutprep.arreter`, `nutprep.ajouter_rapport`
(début, durée, partenaires, anonymes, étiquettes, risque, notes).

Exemple : allumer une lampe à l'heure de la prise.

```yaml
triggers:
  - trigger: device
    domain: nutprep
    device_id: <appareil NutPrep>
    type: pill_due
actions:
  - action: light.turn_on
    target: { entity_id: light.entree }
```

## Confidentialité

L'intégration n'ouvre aucune entrée dans Home Assistant et n'appelle que `https://nutprep.cgrand.fr/ha/v1`
avec une clé propre à ce Home Assistant (révocable dans les réglages du site). Les dépistages ne sont jamais transmis.
Supprimer l'intégration révoque la clé.
