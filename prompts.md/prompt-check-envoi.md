# Prompt — Module « Check d'envoi »

## Contexte

NeuronXcompta dispose déjà du Pipeline (workflow séquentiel), du Kanban tâches (actions ad-hoc) et du Cockpit dashboard (vue globale annuelle). Le **Check d'envoi** est une **liste de pré-vol récurrente** : même rituel à chaque clôture mensuelle/annuelle, items audités, gate souple sur le drawer Email Comptable, commentaires libres injectés dans le mail au comptable.

Lis `CLAUDE.md` avant de commencer.

## Objectif

Créer une page `/check-envoi` (groupe **CLÔTURE**, juste avant l'item Envoi comptable) avec :

1. Toggle `Mois | Année` dans le header (sync `useFiscalYearStore` + sélecteur mois local).
2. 8 sections accordéon **par vue** (mensuelle ou annuelle), chaque section contenant 2 à 4 sous-items.
3. 4 statuts par item : `auto_ok`, `auto_warning`, `manual_ok`, `blocking`.
4. Champ commentaire libre **optionnel** par item, **obligatoire** pour les items bloquants compte d'attente.
5. Reminders **in-app uniquement** : toast au montage de l'app, 1×/jour, dismissable, niveau N1 (J+10) → N2 (J+15) → N3 (J+20).
6. Indicateurs passifs permanents : badge sidebar coloré sur l'item Check d'envoi + couleur du sous-titre du header de la page.
7. Gate **souple** : le drawer Email s'ouvre toujours ; bannière warning sticky en tête du drawer si `ready_for_send=false`. Les commentaires renseignés s'injectent en section *Notes pour {période}* dans le corps du mail.

## Scope explicitement HORS périmètre

- Les **reminders fiscaux** (URSSAF/CARMF/ODM/liasse 2035/OD décembre) restent dans le widget *Échéances fiscales* du dashboard. Ne pas les dupliquer.
- Pas de notification macOS native, pas de self-email.
- Pas de drag & drop.

---

## Modèles Pydantic — `backend/models/check_envoi.py`

```python
from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Optional, Literal
from pydantic import BaseModel, Field


class CheckSource(str, Enum):
    AUTO = "auto"      # statut dérivé d'un endpoint existant
    MANUAL = "manual"  # case à cocher utilisateur


class CheckStatus(str, Enum):
    AUTO_OK = "auto_ok"
    AUTO_WARNING = "auto_warning"
    MANUAL_OK = "manual_ok"
    BLOCKING = "blocking"
    PENDING = "pending"  # auto non encore évalué OU manual non coché


class CheckPeriod(str, Enum):
    MONTH = "month"
    YEAR = "year"


class CheckEnvoiItem(BaseModel):
    """Un sous-item dans une section (ex. 'Relevé Boursorama importé')."""
    key: str                              # stable, ex. "donnees_brutes.releve_importe"
    label: str
    source: CheckSource
    status: CheckStatus = CheckStatus.PENDING
    detail: Optional[str] = None          # 'meta' affiché sous le label (ex. '124 ops · 03/02')
    comment: Optional[str] = None         # commentaire libre injecté dans le mail
    requires_comment: bool = False        # True pour items bloquants compte d'attente
    last_evaluated_at: Optional[datetime] = None


class CheckEnvoiSection(BaseModel):
    """Une section de la check-list (8 sections par vue)."""
    key: str                              # stable, ex. "donnees_brutes"
    label: str
    items: list[CheckEnvoiItem]


class CheckEnvoiInstance(BaseModel):
    """Une instance de check (un mois OU l'année entière)."""
    period: CheckPeriod
    year: int
    month: Optional[int] = None           # None pour period=year
    sections: list[CheckEnvoiSection]
    validated_at: Optional[datetime] = None
    validated_by: str = "user"
    ready_for_send: bool = False          # calculé : aucun blocking restant
    counts: dict[str, int] = Field(default_factory=dict)  # {ok, warning, blocking, pending}


class ReminderState(BaseModel):
    """Persisté côté backend pour gérer snooze/dismiss/niveau."""
    period_key: str                       # "2026-01" ou "2026-annual"
    level: Literal[1, 2, 3]               # N1 / N2 / N3
    last_shown_at: Optional[datetime] = None
    snoozed_until: Optional[datetime] = None
    dismissed_for_period: bool = False    # remis à False si re-validation cassée


class CheckEnvoiSettings(BaseModel):
    """Ajouté à AppSettings."""
    check_envoi_reminder_n1_offset: int = 10
    check_envoi_reminder_n2_offset: int = 15
    check_envoi_reminder_n3_offset: int = 20
    check_envoi_vacances_jusquau: Optional[str] = None  # "YYYY-MM-DD"
```

## Stockage

- `data/check_envoi/{year}.json` — clé `"01"`–`"12"` pour les mois + `"annual"` pour l'année. Une instance par clé.
- `data/check_envoi/reminders.json` — dict `{period_key: ReminderState}`.

Les **items auto** sont **recalculés à chaque GET** (jamais persistés sur disque, sauf `last_evaluated_at`). Seuls `comment`, `validated_at`, et le statut des items `manual` sont persistés.

---

## Service — `backend/services/check_envoi_service.py`

### Catalogue statique des sections + items

Définis un dict `MONTHLY_SECTIONS: list[dict]` et `ANNUAL_SECTIONS: list[dict]` qui décrivent exhaustivement chaque section et ses items, avec pour chaque item auto une fonction d'évaluation.

#### Sections mensuelles (8)

| # | Section key | Items |
|---|---|---|
| 1 | `donnees_brutes` | `releve_importe` (auto), `sandbox_vide` (auto), `ocr_pending_associes` (auto), `facsimiles_attribues` (auto) |
| 2 | `categorisation` | `taux_100` (auto), `aucune_a_revoir` (auto), `aucune_non_classee` (auto) |
| 3 | `justificatifs` | `taux_100` (auto), `ops_verrouillees` (auto), `aucun_orphelin` (auto) |
| 4 | `lettrage` | `taux_100` (auto), `auto_pointage_actif` (auto) |
| 5 | `compte_attente` | `vide_ou_commente` (auto+manual hybrid, requires_comment), `alertes_resolues` (auto) |
| 6 | `coherences` | `debits_credits_equilibres` (auto), `bnc_plausible_vs_n1` (auto) |
| 7 | `specifique_mois` | `urssaf_trimestrielle` (auto, conditionnel mois ∈ {3,6,9,12}), `od_decembre_passees` (auto, conditionnel mois=12) |
| 8 | `avant_envoi` | `snapshot_pre_envoi_cree` (manual), `taches_kanban_fermees` (auto), `export_a_jour` (auto) |

#### Sections annuelles (8)

| # | Section key | Items |
|---|---|---|
| 1 | `liasse_scp` | `ca_saisi` (auto), `liasse_pdf_dans_ged` (auto) |
| 2 | `charges_forfaitaires` | `blanchissage_genere` (auto), `repas_genere` (auto), `vehicule_applique` (auto) |
| 3 | `amortissements` | `registre_a_jour` (manual), `dotation_n_appliquee` (auto) |
| 4 | `mois_valides` | `12_mois_validated` (auto, agrège `validated_at` des 12 instances mensuelles) |
| 5 | `coherences_annuelles` | `somme_bnc` (auto), `somme_recettes_vs_liasse` (auto), `charges_sociales_provisoire` (auto) |
| 6 | `documents_annuels` | `attestation_carmf` (manual), `attestation_urssaf` (manual), `avis_ir_n_moins_1` (manual), `convention_scp` (manual) |
| 7 | `snapshot_annuel` | `bilan_pre_envoi_cree` (manual) |
| 8 | `regularisations` | `od_decembre_passees` (auto), `compte_attente_decembre_traite` (auto+manual hybrid) |

### Fonctions d'évaluation auto

Implémente un mapping `{item_key: callable(year, month?) -> (CheckStatus, detail_str)}`. Chaque évaluateur consomme des **endpoints/services existants** — ne pas réimplémenter de logique.

| Item | Source de vérité | Règle |
|---|---|---|
| `donnees_brutes.releve_importe` | `operation_service.list_operation_files()` | OK si ≥1 fichier non-`manual` pour year+month |
| `donnees_brutes.sandbox_vide` | `sandbox_service` (list dir) | OK si 0 fichier dans `data/justificatifs/sandbox/` |
| `donnees_brutes.ocr_pending_associes` | `ocr_service.get_history()` | OK si 0 item `associated=False` daté du mois |
| `donnees_brutes.facsimiles_attribues` | scan `data/justificatifs/en_attente/` préfixe `reconstitue_` | OK si 0 fac-similé orphelin pour le mois |
| `categorisation.taux_100` | `operation_service.read_operations(filename)` | OK si toutes les ops ont une catégorie non-vide non-`Autres` |
| `categorisation.aucune_a_revoir` | idem | OK si 0 op avec flag `À revoir` |
| `categorisation.aucune_non_classee` | idem | OK si 0 op `Catégorie ∈ {None, "", "?", "Autres", "Non catégorisé"}` |
| `justificatifs.taux_100` | `cloture_service.get_annual_status(year)` | OK si `taux_justificatifs == 1.0` pour ce mois |
| `justificatifs.ops_verrouillees` | scan ops associées | OK si toutes les ops avec `Lien justificatif` non vide ont `locked=True` |
| `justificatifs.aucun_orphelin` | `justificatif_service.scan_link_issues()` | OK si 0 issue concernant le mois |
| `lettrage.taux_100` | `cloture_service.get_annual_status(year)` | OK si `taux_lettrage == 1.0` |
| `lettrage.auto_pointage_actif` | `settings.auto_pointage_enabled` | OK si True |
| `compte_attente.vide_ou_commente` | `alerte_export_service._collect_attente_operations(year, month)` | OK si liste vide. Sinon **chaque op** devient un sous-item bloquant `requires_comment=True` jusqu'à saisie d'un commentaire (statut `BLOCKING` → `MANUAL_OK` une fois rempli) |
| `compte_attente.alertes_resolues` | `GET /api/alertes/summary?year=&month=` | OK si toutes les alertes sont résolues |
| `coherences.debits_credits_equilibres` | sommes ops | warning si écart > 1€ (peut être un arrondi banque) |
| `coherences.bnc_plausible_vs_n1` | calcul `bnc_recettes_pro - bnc_charges_pro` | warning si écart > 25% vs moyenne(N-1, N-2). Toujours OK si pas d'historique |
| `specifique_mois.urssaf_trimestrielle` | `previsionnel_service` échéances URSSAF du mois | OK si toutes ont un document lié. Skipped si mois ∉ {3,6,9,12} |
| `specifique_mois.od_decembre_passees` | scan ops `source ∈ {amortissement, blanchissage, repas}` mois=12 | OK si ≥1 OD pour chaque type concerné. Skipped si mois≠12 |
| `avant_envoi.taches_kanban_fermees` | `task_service.get_tasks(year)` | OK si toutes les tâches du mois (auto+manual) sont `done` ou `dismissed` |
| `avant_envoi.export_a_jour` | `data/exports/exports_history.json` | OK si dernier export pour year+month timestamp > dernière modification du fichier d'ops |
| `liasse_scp.ca_saisi` | `liasse_scp_service.get(year)` | OK si fichier existe |
| `liasse_scp.liasse_pdf_dans_ged` | `ged_service.search(type="liasse_fiscale_scp", year=year)` | OK si ≥1 doc |
| `charges_forfaitaires.*` | `charges_forfaitaires_service.get_genere(year, type)` | OK si entrée existe |
| `amortissements.dotation_n_appliquee` | `GET /api/amortissements/dotation-genere?year=` | OK si non-null |
| `mois_valides.12_mois_validated` | scan `data/check_envoi/{year}.json` | détail: "8/12 validés" |
| `coherences_annuelles.somme_bnc` | agrégation `analytics.year_overview` | OK si Σ mensuels == annuel ±0.01€ |
| `coherences_annuelles.somme_recettes_vs_liasse` | comparateur existant | warning si écart >5% |
| `regularisations.od_decembre_passees` | `cloture_service` mois=12 | OK si toutes les OD attendues sont passées |

### Fonctions principales

```python
def get_instance(year: int, period: CheckPeriod, month: Optional[int]) -> CheckEnvoiInstance:
    """Charge depuis disque, recalcule les items auto, persiste les manual + comments."""
    
def update_item(year: int, period: CheckPeriod, month: Optional[int], 
                item_key: str, *, comment: Optional[str] = None, 
                manual_ok: Optional[bool] = None) -> CheckEnvoiInstance:
    """Met à jour un item (commentaire libre ou toggle manuel). Recalcule ready_for_send."""
    
def validate_instance(year: int, period: CheckPeriod, month: Optional[int]) -> CheckEnvoiInstance:
    """Marque validated_at = now() si ready_for_send. Sinon HTTPException 400."""
    
def unvalidate_instance(year: int, period: CheckPeriod, month: Optional[int]) -> CheckEnvoiInstance:
    """Annule la validation (validated_at = None) — utile si l'utilisateur change d'avis."""
    
def get_notes_for_email(year: int, month: int) -> str:
    """Retourne le bloc texte 'Notes pour {Mois} {Year}' formaté pour injection email.
    Retourne '' si aucun commentaire renseigné. Format: '- {Section} / {item} : {comment}'."""
    
def get_active_reminder(now: datetime) -> Optional[ReminderState]:
    """Retourne le reminder actif (le plus haut niveau non-snoozé non-dismissé)
    parmi tous les mois clôturés et non validés. None si rien à afficher.
    Respecte settings.check_envoi_vacances_jusquau."""
```

### Helper privé — calcul du niveau de reminder

```python
def _compute_level(period_key: str, now: datetime, settings: CheckEnvoiSettings) -> Optional[int]:
    """
    Pour un mois M de l'année Y :
    - delta = (now - date(Y, M+1, 1)).days  # jours depuis fin de période
    - delta < n1_offset → None
    - n1_offset ≤ delta < n2_offset → 1
    - n2_offset ≤ delta < n3_offset → 2
    - delta ≥ n3_offset → 3
    
    Pour la vue annuelle : delta calculé depuis le 31 janvier de Y+1.
    """
```

---

## Router — `backend/routers/check_envoi.py` (prefix `/api/check-envoi`)

| Méthode | Route | Description |
|---|---|---|
| GET | `/{year}/{period}` | `period ∈ {month, year}`. Si `month`, query param `month=1..12` requis. Retourne `CheckEnvoiInstance` avec items auto recalculés. |
| GET | `/{year}/coverage` | Retourne `{ "01": ready_for_send_bool, ..., "12": bool, "annual": bool }`. Utilisé par la sidebar pour le badge agrégé. |
| PATCH | `/{year}/{period}/items/{item_key}` | Body `{ comment?: str, manual_ok?: bool }`. Met à jour 1 item. Pour les items bloquants compte d'attente, `item_key` inclut le hash de l'op (ex: `compte_attente.vide_ou_commente.{op_hash}`). |
| POST | `/{year}/{period}/validate` | Marque `validated_at`. 400 si `ready_for_send=false`. |
| POST | `/{year}/{period}/unvalidate` | Annule. |
| GET | `/notes/{year}/{month}` | Retourne `{ "notes": "<bloc texte>" }` — utilisé par le drawer Email pour pré-injecter. |
| GET | `/reminders/state` | Retourne `{ should_show: bool, level: 1\|2\|3, period_key: str, message: str }` ou `{ should_show: false }`. |
| POST | `/reminders/snooze` | Body `{ period_key, until_iso }`. |
| POST | `/reminders/dismiss` | Body `{ period_key }`. |

Inclure le router dans `main.py`.

---

## Job APScheduler — calcul quotidien des reminders

Dans `backend/services/check_envoi_scheduler.py`, ajouter un job au scheduler existant (cherche le pattern dans `previsionnel_service` — APScheduler / asyncio loop, **NE JAMAIS écrire `while True: await asyncio.sleep(N)` nu**, suivre le contrat `shutdown_event`).

```python
async def _check_envoi_reminder_loop():
    """Job quotidien à 9h00 :
    1. Pour chaque (year, month) entre N-1 mois et N+0 :
       - Si non validé : calcule level via _compute_level()
       - Met à jour reminders.json (level, last_shown_at non touché)
       - Si validé : supprime l'entrée de reminders.json
    2. Pareil pour la vue annuelle de N-1.
    """
```

À démarrer dans `lifespan()` de `main.py`. Coopératif `shutdown_event`.

---

## Settings — `backend/models/settings.py`

Ajouter à `AppSettings` :

```python
check_envoi_reminder_n1_offset: int = 10
check_envoi_reminder_n2_offset: int = 15
check_envoi_reminder_n3_offset: int = 20
check_envoi_vacances_jusquau: Optional[str] = None
```

---

## Frontend — Types `frontend/src/types/index.ts`

```typescript
export type CheckSource = 'auto' | 'manual';
export type CheckStatus = 'auto_ok' | 'auto_warning' | 'manual_ok' | 'blocking' | 'pending';
export type CheckPeriod = 'month' | 'year';

export interface CheckEnvoiItem {
  key: string;
  label: string;
  source: CheckSource;
  status: CheckStatus;
  detail: string | null;
  comment: string | null;
  requires_comment: boolean;
  last_evaluated_at: string | null;
}

export interface CheckEnvoiSection {
  key: string;
  label: string;
  items: CheckEnvoiItem[];
}

export interface CheckEnvoiInstance {
  period: CheckPeriod;
  year: number;
  month: number | null;
  sections: CheckEnvoiSection[];
  validated_at: string | null;
  validated_by: string;
  ready_for_send: boolean;
  counts: { ok: number; warning: number; blocking: number; pending: number };
}

export interface CheckReminderState {
  should_show: boolean;
  level?: 1 | 2 | 3;
  period_key?: string;
  message?: string;
}
```

---

## Hooks — `frontend/src/hooks/useCheckEnvoi.ts`

8 hooks TanStack Query :

```typescript
useCheckInstance(year, period, month?)         // GET /api/check-envoi/{year}/{period}
useCheckCoverage(year)                          // GET /api/check-envoi/{year}/coverage
useUpdateCheckItem()                            // PATCH item, invalide instance + coverage
useValidateCheck()                              // POST validate
useUnvalidateCheck()                            // POST unvalidate
useCheckReminderState()                         // GET reminders/state, refetchInterval: false
useSnoozeReminder()                             // POST snooze
useDismissReminder()                            // POST dismiss
```

Toutes les mutations invalident **`['check-envoi']` + `['check-coverage']` + `['cloture']`** (cette dernière car `validate` peut influencer le statut clôture).

Hook auxiliaire pour l'email :
```typescript
useCheckNotesForEmail(year, month)              // GET /api/check-envoi/notes/{year}/{month}
```

---

## Composants — `frontend/src/components/check-envoi/`

| Fichier | Responsabilité |
|---|---|
| `CheckEnvoiPage.tsx` | Page principale. Header avec titre + sous-titre coloré (J+N) + toggle Mois/Année. Bannière warning souple en haut si `!ready_for_send`. Stats row 4 metric cards. Liste des 8 sections via `CheckSection`. Bouton flottant « Préparer l'envoi → » qui appelle `useSendDrawerStore.open(year, month)` (drawer Email Comptable existant). |
| `CheckSection.tsx` | Section accordéon : header (chevron + numéro + nom + pastille statut résumée) + body (liste `CheckItem`). État `open` local. La pastille à droite : `1 BLOQUANT` (rouge) > `N à revoir` (warning) > `N/M` (warning si <100%) > `100%` (success) > `OK` (success). Bloquants gagnent toujours en priorité d'affichage. |
| `CheckItem.tsx` | Ligne item : icône statut (Check vert / AlertTriangle ambre / SquareCheck bleu / OctagonX rouge / Circle gris) + label + detail meta + bouton « + Note » (devient « Note ✓ » coloré quand `comment` non vide). Pour les items `requires_comment` non remplis : textarea bloc rouge sticky inline. Pour les items `manual` : checkbox toggle qui appelle `useUpdateCheckItem({manual_ok: !current})`. |
| `CommentBox.tsx` | Bloc commentaire libre, rendu sous l'item. Textarea avec debounce 500ms qui appelle `useUpdateCheckItem({comment})`. Affiche en mode preview *« Visible dans l'email : "{comment}" »*. |
| `MonthYearToggle.tsx` | Pill segmented control `Mois | Année`. Synchronisé via state local de la page. La vue Année affiche les 8 sections annuelles ; la vue Mois affiche les 8 sections mensuelles + un sélecteur mois compact (1..12) à côté du titre. |
| `CheckReminderToast.tsx` | Composant toast monté dans `AppLayout`. Au mount, appelle `useCheckReminderState()`. Si `should_show` : affiche un `react-hot-toast.custom` persistant (`duration: Infinity`) avec niveau coloré (N1 amber, N2 orange, N3 red), 3 boutons : *Voir* (navigate `/check-envoi?period=...`), *Plus tard* (snooze 24h), X (dismiss for period). 1×/session : utilise `sessionStorage.checkReminderShownAt` pour ne pas re-tenter au remount intra-session. |

### Wording des toasts (3 niveaux)

| Niveau | Délai | Wording |
|---|---|---|
| N1 | J+10 | « Check janvier en attente — pense à valider quand tu peux. » |
| N2 | J+15 | « Check janvier toujours pas validé — il vaut mieux s'y mettre. » |
| N3 | J+20 | « Check janvier en retard — l'envoi au comptable n'a pas eu lieu. » |

---

## Intégration sidebar — `frontend/src/components/layout/Sidebar.tsx`

Ajouter dans le groupe **CLÔTURE**, juste **avant** l'item Envoi comptable :

```
{ to: '/check-envoi', icon: ListChecks, label: "Check d'envoi", badge: <CheckEnvoiBadge /> }
```

Composant `CheckEnvoiBadge` :
- Lit `useCheckReminderState()` et `useCheckCoverage(currentYear)`.
- Niveau de couleur :
  - rouge si reminder N3 actif
  - orange si N2
  - amber si N1
  - vert si tous les mois clôturés sont validés
  - aucun badge sinon (mois courant pas encore clôturable)
- Compteur : `N en attente` ou `✓` si tout validé.

---

## Intégration drawer Email — `frontend/src/components/email/SendToAccountantDrawer.tsx`

Quand le drawer s'ouvre avec une période sélectionnée (mois précis) :

1. Lire `useCheckInstance(year, 'month', month)` et `useCheckNotesForEmail(year, month)`.
2. Si `instance.ready_for_send === false` : afficher en haut du drawer une **bannière warning** (fond `bg-warning/10`, texte `text-warning`, icône `AlertTriangle`) :
   ```
   Check d'envoi incomplet — N bloquant(s), N warning(s).
   [Voir le check ↗]   [Envoyer quand même]
   ```
   *Voir le check* navigate vers `/check-envoi?year={year}&month={month}`. *Envoyer quand même* dismiss la bannière sans bloquer.
3. Si `notes` non vide : pré-injecter dans le textarea du corps du mail au-dessus de la signature, sous une section :
   ```
   
   Notes pour {Mois} {Year}
   {notes}
   
   ```
   L'utilisateur peut éditer comme le reste du corps (déjà éditable). En mode HTML, le bloc Notes est rendu via une div stylée dans le template `email_template.html`.

4. Côté backend `email_service.generate_email_body_plain()` et `generate_email_html()` : si une seule période est détectée dans la sélection des documents (ex. tous les docs sont datés janvier 2026), appeler `check_envoi_service.get_notes_for_email(year, month)` et insérer la section. Si multi-périodes, ne rien injecter (l'utilisateur peut le faire à la main).

---

## Toast de reminder — montage dans `AppLayout`

Dans `frontend/src/components/layout/AppLayout.tsx`, ajouter `<CheckReminderToast />` au même niveau que `<MLRetrainToast />` (déjà présent — pattern identique).

---

## Ordre d'implémentation

1. **Backend models** : `check_envoi.py` + extension de `AppSettings`.
2. **Backend service** : catalogue statique + 4 fonctions principales + helper niveau reminder. Évalue toutes les fonctions auto en consommant les services existants — **zéro endpoint nouveau côté backend autre que `/api/check-envoi/*`**.
3. **Backend router** : 9 endpoints sous `/api/check-envoi`. Inclure dans `main.py`.
4. **Backend scheduler** : job quotidien dans `lifespan()`. Suivre le contrat `shutdown_event`.
5. **Données** : créer répertoire `data/check_envoi/` au boot si absent.
6. **Tests rapides backend** : démarrer uvicorn, hit `GET /api/check-envoi/2026/month?month=1` → instance avec items auto évalués. Hit `PATCH .../items/donnees_brutes.releve_importe` body `{ "comment": "test" }` → persisté. Hit `POST .../validate` → 400 si bloquants, 200 sinon.
7. **Frontend types** dans `index.ts`.
8. **Frontend hooks** dans `useCheckEnvoi.ts`.
9. **Frontend composants** : ordre `CheckItem` → `CommentBox` → `CheckSection` → `MonthYearToggle` → `CheckEnvoiPage` → `CheckReminderToast`.
10. **Sidebar badge** + entrée de menu groupe CLÔTURE.
11. **Drawer Email** : bannière + injection notes (frontend + backend `generate_email_*`).
12. **Toast de reminder** : monté dans `AppLayout`.
13. **`CLAUDE.md`** : ajouter une entrée dans la liste des modules + une note sur le pattern « gate souple + injection notes email ».
14. **`CHANGELOG.md`** : entrée Added avec les fichiers créés.

---

## Checklist de vérification

### Backend
- [ ] `data/check_envoi/{year}.json` créé au premier GET, structure clé-mois `"01"`–`"12"` + `"annual"`.
- [ ] `data/check_envoi/reminders.json` géré par le scheduler.
- [ ] Items auto **non persistés** sur disque (recalculés à chaque GET).
- [ ] `PATCH item` accepte `{comment}`, `{manual_ok}`, ou les deux ensemble.
- [ ] `POST validate` retourne 400 si `ready_for_send=false` avec message explicite.
- [ ] `_compute_level` respecte `settings.check_envoi_vacances_jusquau` (retourne `None` pendant la période vacances).
- [ ] Le scheduler suit le contrat `shutdown_event` (pas de `while True: asyncio.sleep` nu).
- [ ] Les évaluateurs auto **ne réimplémentent rien** : ils appellent uniquement les services existants (`cloture_service`, `alerte_export_service`, `task_service`, `liasse_scp_service`, `charges_forfaitaires_service`, `amortissement_service`, `analytics_service`, `ged_service`, `operation_service`, `justificatif_service`, `previsionnel_service`).
- [ ] `get_notes_for_email` formate exactement `- {Section.label} / {item.label} : {item.comment}` une ligne par commentaire non vide.

### Frontend
- [ ] Toggle Mois/Année swap entre 8 sections mensuelles et 8 sections annuelles. État `useState<CheckPeriod>` local à la page.
- [ ] Sélecteur mois local visible uniquement en vue Mois.
- [ ] Pastille statut de section : règle de priorité bloquant > warning > N/M > OK respectée.
- [ ] Bouton « + Note » affiche `Note ✓` violet quand `comment` non vide.
- [ ] Items `requires_comment` bloquants : textarea rouge inline, item passe `BLOCKING → MANUAL_OK` dès que comment non vide (debounce 500ms).
- [ ] Items `manual` : checkbox toggle qui patch `{manual_ok: !current}`.
- [ ] Bannière souple sur le drawer Email s'affiche si `ready_for_send=false`, jamais bloquante.
- [ ] Notes injectées dans le corps du mail (textarea éditable) ET dans le HTML de preview.
- [ ] Toast de reminder monté dans `AppLayout`, affiché 1×/session via `sessionStorage`.
- [ ] Badge sidebar coloré selon reminder actif.
- [ ] Pas de `display: none` ou `tabs` dans le mockup de page (cf. règle système).
- [ ] Aucun `any`. Tout typé via `CheckEnvoiInstance` & co.
- [ ] Lucide React icons uniquement (`ListChecks` pour la page, `Check`, `AlertTriangle`, `SquareCheck`, `OctagonX`, `Circle`).

### Intégration
- [ ] Cache invalidation : `useUpdateCheckItem` invalide `['check-envoi']` + `['check-coverage']`.
- [ ] `useValidateCheck` invalide en plus `['cloture', year]` (pour rafraîchir les `useCloture` consommateurs).
- [ ] L'ouverture du drawer Email **n'est jamais bloquée**, conformément à la décision 2B.
- [ ] Reminders fiscaux **PAS dupliqués** dans ce module (URSSAF/CARMF/ODM/liasse/OD restent dans le widget Échéances du dashboard).

### Documentation
- [ ] `CLAUDE.md` enrichi avec une entrée Module Check d'envoi sous la liste des modules + note sur le pattern gate souple.
- [ ] `architecture.md` ajout d'un schéma textuel sous une nouvelle section `### Check d'envoi`.
- [ ] `api-reference.md` ajout d'une section `## Check d'envoi (`/api/check-envoi`)` listant les 9 endpoints.
- [ ] `CHANGELOG.md` entrée Added datée avec liste des fichiers.

---

## Notes finales

- La règle `1 op = 1 unité` (cf. CLAUDE.md, Pipeline ↔ Justificatifs) doit être respectée par tous les évaluateurs auto qui touchent aux compteurs justificatifs/verrouillage.
- Le pattern « items auto recalculés à chaque GET, items manuels persistés » est inspiré de la déduplication `auto_key` du module Tasks — même philosophie, scope différent (vérification récurrente vs action one-shot).
- Pour les items du compte d'attente bloquants : chaque op en compte d'attente devient un sous-item dynamique avec `key = "compte_attente.vide_ou_commente.{md5(op_filename + op_index)}"`. Le commentaire saisi est **aussi propagé** vers `op["compte_attente_commentaire"]` pour qu'il apparaisse dans l'export compte d'attente CSV/PDF.
- Wording français informel cohérent avec le ton de l'app.
