# Prompt Claude Code — Rapport amortissements enrichi + envoi comptable

> **Objet** : enrichir les rapports `amortissements_registre` / `amortissements_dotations` avec une colonne « Justificatif », inclure les PDFs des justifs liés dans le ZIP envoyé au comptable (sous-dossier dédié), et ajouter un bouton « Envoyer au comptable » dans le header de la page Amortissements (pattern miroir Charges Forfaitaires).
>
> **Lecture préalable obligatoire** : `CLAUDE.md` racine du projet.
>
> **Pré-requis** : le prompt **« Annotation immobilisation + visualisation justificatif »** a été appliqué — on s'appuie sur `amortissement_service._get_immo_op_index()`, `amortissement_service.get_linked_op_with_justif(immo_id)`, les champs `has_justif` + `justif_filename` exposés sur le sérialiseur de liste des immobilisations, et le composant partagé `frontend/src/components/shared/JustifPreviewLightbox.tsx`.

---

## 1. Contexte & motivation

Aujourd'hui :
- Les rapports `amortissements_registre` et `amortissements_dotations` sont générés (PDF/CSV/XLSX) et enregistrés dans la GED — mais **aucune mention des justificatifs** rattachés. Le comptable reçoit le registre seul, sans pouvoir vérifier les pièces jointes d'un coup d'œil.
- Le drawer universel « Envoyer au comptable » permet de zipper rapports + justifs, mais l'utilisateur doit **manuellement cocher** les justifs un par un dans le panneau gauche. Pour 7 immobilisations actives = 7 clics + risque d'oubli.
- La page Amortissements n'a pas de bouton header « Envoyer au comptable » contrairement à `ChargesForfaitairesPage` qui pré-remplit le drawer.

Cette feature corrige les 3 trous.

---

## 2. Principes architecturaux (rappels CLAUDE.md)

- **Reuse before building** : on étend `report_service` / `amortissement_report_service` / `email_service` existants. Aucun nouveau service.
- **Pas de re-scan à l'envoi** : la liste des justifs liés est **gelée au moment de la génération du rapport** dans `rapport_meta.linked_justifs`. Si une immo est créée/modifiée après, la liste sera mise à jour à la prochaine régénération du rapport. Cohérence : un rapport envoyé représente l'état des justifs au moment de sa génération, pas au moment de l'envoi.
- **Single source of truth** : la transitivité `immo → op → justif` reste l'unique source. `linked_justifs` est dérivé, pas autoritatif.
- **Déduplication** dans le ZIP : si l'utilisateur a aussi coché manuellement un justif dans le drawer, il n'apparaît **qu'une fois** dans le ZIP (priorité au sous-dossier `Justificatifs_immobilisations/` quand le justif est lié à un rapport amortissements présent dans la sélection).
- `from __future__ import annotations` + `Optional[X]` côté Python ; pas de `any` côté TS ; Lucide uniquement ; CSS variables.
- TanStack Query : invalidation multi-clés sur les régénérations de rapports.

---

## 3. Périmètre

| # | Item | Composant impacté |
|---|------|---|
| A | Colonne « Justificatif » dans les rapports `amortissements_registre` (PDF + CSV + XLSX) | `amortissement_report_service.py` (ou équivalent) |
| B | `linked_justifs: list[str]` ajouté à `rapport_meta` à la génération des rapports `amortissements_registre` ET `amortissements_dotations` | `report_service.py` + `amortissement_report_service.py` |
| C | Sous-dossier `Justificatifs_immobilisations/` dans le ZIP envoyé quand un rapport amortissements est sélectionné | `email_service.py` |
| D | Bouton « Envoyer au comptable » dans le header `AmortissementsPage`, pré-coche les 2 rapports de l'année + tous leurs justifs liés (auto-génération si manquants) | `AmortissementsPage.tsx` + `useAmortissements.ts` |

---

## 4. Implémentation (ordre strict)

### 4.1 Backend — colonne « Justificatif » dans les rapports registre

Localiser la fonction `render_registre(year, path, format, filters)` (probablement `backend/services/amortissement_report_service.py` ou `backend/services/report_service.py` — voir CLAUDE.md section Rapports V2). Elle dispatche sur 3 helpers privés `_render_registre_pdf` / `_render_registre_csv` / `_render_registre_xlsx`.

#### Source de données enrichie

Avant de boucler sur les immos pour le rendu, charger la liste enrichie via le sérialiseur existant qui expose déjà `has_justif: bool` + `justif_filename: Optional[str]` (issus du prompt précédent).

```python
def _enriched_immos_for_report(year: int, filters: dict) -> list[dict]:
    """
    Retourne la liste des immobilisations enrichies (avec has_justif + justif_filename),
    filtrées selon les critères du rapport. Réutilise list_immobilisations_with_source()
    introduit dans le prompt précédent.
    """
    return amortissement_service.list_immobilisations_with_source(
        statut=filters.get("statut"),
        poste=filters.get("poste"),
        year=year,
    )
```

(Adapter au nom exact de la fonction de listing — sinon, l'index `_get_immo_op_index()` permet la même résolution en O(1) par immo.)

#### Rendu PDF (paysage A4)

Ajouter une colonne **« Justificatif »** entre `Poste` (dernière colonne actuelle) et la fin. Largeur ~28% de la largeur restante après les colonnes numériques (truncation centrale si nom > 30 chars : `apple_20240312_2599.00.pdf` → `apple_20240312_2…00.pdf`).

Pour chaque immo :
- Si `immo.has_justif` → cellule = icône ✓ violette (`#3C3489`) suivie du nom de fichier tronqué (police 8pt regular, couleur `#666`).
- Si pas de justif → cellule = icône ✗ grise (`#999`) seule, pas de texte.

Helper local :

```python
def _format_justif_cell(immo: dict) -> tuple[str, bool]:
    """Retourne (texte_affiché, has_justif) pour la cellule justificatif du registre."""
    if not immo.get("has_justif"):
        return ("✗", False)
    fn = immo.get("justif_filename") or ""
    base = Path(fn).name
    if len(base) > 30:
        base = base[:14] + "…" + base[-13:]
    return (f"✓ {base}", True)
```

Style cellule via Paragraph ReportLab : couleur conditionnelle `colors.HexColor("#3C3489")` si `has_justif` sinon `colors.HexColor("#999999")`.

**Ligne TOTAL** : la cellule Justificatif affiche le compteur `{n_avec_justif} / {n_total}` (ex `5 / 7`) avec couleur warning ambre (`#F59E0B`) si `n_avec_justif < n_total`, success vert sinon.

#### Rendu CSV

Ajouter colonne `Justificatif` en dernière position. Valeur = nom de fichier complet ou chaîne vide. Pas d'icône.

```
Désignation;Origine;Acquis le;Statut;Durée;Base;Cumul amort.;VNC actuelle;Poste;Justificatif
"MacBook Pro M3";NeuronX;12/03/2024;En cours;3;2 599,00;1 507,42;1 091,58;Matériel informatique;apple_20240312_2599.00.pdf
```

Ligne TOTAL : `Justificatif` = `5 / 7 immobilisations justifiées`.

#### Rendu XLSX

Idem CSV pour la colonne. Bonus : appliquer un format conditionnel via `openpyxl` :
- Si la cellule contient un nom de fichier → fond `#EEEDFE` (primary tint) + texte `#3C3489` bold.
- Si vide → fond `#FEF3C7` (warning soft) + texte `#854F0B`.

Largeur colonne `Justificatif` : 32 unités (auto-fit OK).

### 4.2 Backend — `linked_justifs` dans `rapport_meta`

Au moment de la génération d'un rapport `amortissements_registre` ou `amortissements_dotations`, calculer la liste des basenames de justifs liés et la stocker dans la metadata GED.

Dans `report_service.generate_report()` (ou la fonction qui appelle `register_rapport`), pour les templates concernés :

```python
def _compute_linked_justifs(template_id: str, filters: dict, year: int) -> list[str]:
    """Liste les basenames des justifs liés aux immobilisations en scope du rapport."""
    if template_id not in ("amortissements_registre", "amortissements_dotations"):
        return []
    
    immos = amortissement_service.list_immobilisations_with_source(
        statut=filters.get("statut"),
        poste=filters.get("poste"),
        year=year,
    )
    
    if template_id == "amortissements_dotations":
        # Restreindre aux immos avec dotation > 0 sur l'exercice
        dotations = amortissement_service.get_dotations(year)
        active_ids = {d["immobilisation_id"] for d in dotations.get("detail", []) if d.get("dotation_brute", 0) > 0}
        immos = [i for i in immos if i.get("id") in active_ids]
    
    seen: set[str] = set()
    out: list[str] = []
    for immo in immos:
        fn = immo.get("justif_filename") or ""
        if fn:
            base = Path(fn).name
            if base not in seen:
                seen.add(base)
                out.append(base)
    return out
```

Puis enrichir l'appel à `register_rapport` :

```python
linked_justifs = _compute_linked_justifs(template_id, filters, year)

ged_service.register_rapport(
    filename=output_filename,
    title=title,
    description=description,
    rapport_meta={
        "title": title,
        "description": description,
        "filters": filters,
        "format": format,
        "favorite": False,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "linked_justifs": linked_justifs,  # ← nouveau champ
    },
    ...
)
```

**Backward compat** : les rapports existants n'auront pas `linked_justifs` dans leur metadata — les consommateurs (étape 4.3) doivent traiter l'absence comme `[]`.

### 4.3 Backend — sous-dossier `Justificatifs_immobilisations/` dans le ZIP

Dans `backend/services/email_service.py`, fonction `_create_zip()` (ou équivalent qui assemble le ZIP), modifier la résolution :

#### Pseudocode

```python
def _create_zip(documents: list[DocumentRef], dest: Path) -> Path:
    immo_justif_basenames: set[str] = set()  # collecté en passe 1
    
    # Passe 1 : pour chaque rapport amortissements, lire linked_justifs depuis rapport_meta GED
    for doc in documents:
        if doc.type != "rapport":
            continue
        meta = ged_service.get_document_meta(doc.id)  # ou équivalent
        rapport_meta = (meta or {}).get("rapport_meta") or {}
        linked = rapport_meta.get("linked_justifs") or []
        immo_justif_basenames.update(linked)
    
    # Passe 2 : construction du ZIP
    with ZipFile(dest, "w", ZIP_DEFLATED) as zf:
        for doc in documents:
            path = _resolve_document_path(doc)
            if not path or not path.exists():
                continue
            
            # Justif explicitement coché par l'utilisateur :
            # → si déjà collecté comme linked_justif d'un rapport, skip (apparaîtra dans Justificatifs_immobilisations/)
            # → sinon, le mettre dans justificatifs/ comme avant
            if doc.type == "justificatif":
                if path.name in immo_justif_basenames:
                    continue  # priorité au sous-dossier dédié
                arcname = f"justificatifs/{path.name}"
            elif doc.type == "rapport":
                arcname = f"rapports/{path.name}"
            elif doc.type == "export":
                arcname = f"exports/{path.name}"
            elif doc.type == "releve":
                arcname = f"releves/{path.name}"
            else:
                arcname = f"documents/{path.name}"
            
            zf.write(path, arcname)
        
        # Passe 3 : ajouter les justifs liés aux rapports amortissements dans le sous-dossier dédié
        for basename in immo_justif_basenames:
            justif_path = justificatif_service.get_justificatif_path(basename, include_reports=False)
            if justif_path and justif_path.exists():
                zf.write(justif_path, f"Justificatifs_immobilisations/{basename}")
            else:
                # Justif manquant — log warning, ne pas crasher
                logger.warning(f"Justif lié manquant : {basename}")
    
    return dest
```

Le sous-dossier final dans le ZIP devient :

```
Documents_Comptables_{timestamp}.zip
├── exports/
├── rapports/
├── releves/
├── justificatifs/                          ← ceux explicitement cochés (hors immo)
├── Justificatifs_immobilisations/          ← ceux liés à un rapport amortissements présent
└── documents/
```

#### Email body templates

Mettre à jour `_build_zip_tree()` et `_build_doc_tree()` pour afficher le nouveau sous-dossier dans l'arborescence affichée dans l'email HTML brandé. Le sous-dossier hérite des règles d'affichage existantes (icône folder + compteur).

Mettre à jour `generate_email_body_plain()` pour mentionner le sous-dossier en mode texte.

#### Endpoint preview

`POST /api/email/preview` doit refléter cette logique (sinon la preview montre une arborescence fausse). Le preview lit déjà `rapport_meta` via `_build_doc_tree()` ; ajouter le branchement sur `linked_justifs`.

### 4.4 Frontend — types

Dans `frontend/src/types/index.ts` (ou `types.ts`), étendre `RapportMeta` :

```ts
export interface RapportMeta {
  title: string;
  description: string;
  filters: Record<string, unknown>;
  format: string;
  favorite: boolean;
  generated_at: string;
  linked_justifs?: string[];  // ← nouveau, optionnel pour rétrocompat
}
```

### 4.5 Frontend — bouton header `AmortissementsPage`

Pattern miroir de `ChargesForfaitairesPage` qui a déjà un bouton « Envoyer au comptable » avec pré-remplissage via `sendDrawerStore`.

#### 4.5a — Hook helper

Dans `frontend/src/hooks/useAmortissements.ts`, ajouter :

```ts
export function usePrepareAmortissementsEnvoi(year: number) {
  const generateReport = useGenerateReport();  // hook existant
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (): Promise<{
      rapports: GedDocument[];
      linkedJustifs: string[];
    }> => {
      // 1. Vérifier que les 2 rapports existent pour l'année
      const existingDocs = queryClient.getQueryData<GedTreeResponse>(['ged', 'tree']);
      const findReport = (templateId: string) =>
        existingDocs?.documents?.find(
          d => d.type === 'rapport'
            && d.rapport_meta?.template_id === templateId
            && d.rapport_meta?.filters?.year === year
        );
      
      let registre = findReport('amortissements_registre');
      let dotations = findReport('amortissements_dotations');
      
      // 2. Régénérer si manquant
      if (!registre) {
        await generateReport.mutateAsync({
          template_id: 'amortissements_registre',
          filters: { year, statut: 'all', poste: 'all' },
          format: 'pdf',
        });
      }
      if (!dotations) {
        await generateReport.mutateAsync({
          template_id: 'amortissements_dotations',
          filters: { year, poste: 'all' },
          format: 'pdf',
        });
      }
      
      // 3. Re-fetch tree pour récupérer les rapports + leur linked_justifs metadata
      await queryClient.invalidateQueries({ queryKey: ['ged', 'tree'] });
      const fresh = await queryClient.fetchQuery<GedTreeResponse>({
        queryKey: ['ged', 'tree'],
      });
      
      registre = fresh.documents.find(/* … */);
      dotations = fresh.documents.find(/* … */);
      
      const linked = new Set<string>([
        ...(registre?.rapport_meta?.linked_justifs ?? []),
        ...(dotations?.rapport_meta?.linked_justifs ?? []),
      ]);
      
      return {
        rapports: [registre!, dotations!].filter(Boolean),
        linkedJustifs: Array.from(linked),
      };
    },
  });
}
```

(Adapter aux noms exacts des hooks existants `useGenerateReport`, `useGedTree` etc.)

#### 4.5b — Composant bouton

Dans `frontend/src/pages/AmortissementsPage.tsx` (ou `components/amortissements/AmortissementsPage.tsx`), ajouter dans le `PageHeader` à droite :

```tsx
<button
  className="btn btn-secondary"
  onClick={handleEnvoiComptable}
  disabled={prepareEnvoi.isPending}
>
  {prepareEnvoi.isPending ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
  Envoyer au comptable
</button>
```

Handler :

```tsx
const selectedYear = useFiscalYearStore((s) => s.selectedYear);
const prepareEnvoi = usePrepareAmortissementsEnvoi(selectedYear);
const sendDrawer = useSendDrawerStore();

const handleEnvoiComptable = async () => {
  try {
    const { rapports, linkedJustifs } = await prepareEnvoi.mutateAsync();
    
    sendDrawer.open({
      defaultSubject: `Amortissements — Exercice ${selectedYear}`,
      defaultIntro: `Bonjour, ci-joint le registre des immobilisations et la dotation aux amortissements pour l'exercice ${selectedYear}, accompagnés des justificatifs correspondants.`,
      preselectedDocs: [
        ...rapports.map(r => ({ type: 'rapport' as const, id: r.id })),
        ...linkedJustifs.map(fn => ({ type: 'justificatif' as const, id: fn })),
      ],
      activeFilters: ['rapport', 'justificatif'],  // pour activer les chips de filtre dans le drawer
    });
    toast.success(`Drawer pré-rempli : 2 rapports + ${linkedJustifs.length} justificatifs`);
  } catch (err) {
    toast.error('Erreur lors de la préparation de l\'envoi');
    console.error(err);
  }
};
```

(Adapter à l'API exacte de `sendDrawerStore.open()` — pattern aligné sur `ChargesForfaitairesPage`. Si certains champs comme `defaultIntro` ou `activeFilters` n'existent pas, les ajouter au store en suivant le pattern existant.)

#### 4.5c — Toast post-action

Si la génération de rapports a été nécessaire (rapports manquants), afficher un toast intermédiaire :

```tsx
toast.loading('Génération des rapports amortissements...', { id: 'amort-gen' });
// ...
toast.success(`Drawer pré-rempli`, { id: 'amort-gen' });
```

### 4.6 Mise à jour CLAUDE.md

Ajouter dans la section Amortissements de `CLAUDE.md` un bullet récapitulatif :

```markdown
- **Envoi comptable enrichi (Session XX)** : les rapports `amortissements_registre`
  et `amortissements_dotations` portent désormais `rapport_meta.linked_justifs:
  list[str]` calculé à la génération (basenames des justifs liés via transitivité
  immo → op → justif). Le ZIP envoyé via le drawer comptable inclut un sous-dossier
  `Justificatifs_immobilisations/` dédupliqué contre la sélection manuelle de
  justifs (priorité au sous-dossier dédié). Bouton « Envoyer au comptable » dans
  le header `AmortissementsPage` qui auto-génère les rapports manquants pour
  l'année courante puis pré-coche les 2 rapports + tous leurs justifs liés via
  `sendDrawerStore.open({preselectedDocs, defaultSubject, activeFilters})`.
```

---

## 5. Vérification

1. **Génération registre PDF** (page Rapports → template `amortissements_registre` → year 2026 → format PDF) → ouvrir le PDF → la colonne « Justificatif » est présente, avec ✓ + filename pour les immos justifiées et ✗ pour les autres. Ligne TOTAL affiche `5 / 7` (ou similaire) avec couleur ambre si incomplet.
2. **Génération registre CSV** : la colonne `Justificatif` existe, valeur = filename complet ou vide. Ligne TOTAL OK.
3. **Génération registre XLSX** : la colonne `Justificatif` existe avec mise en forme conditionnelle (fond violet soft pour présent, fond ambre soft pour absent).
4. **Génération dotations** : pas de colonne justif (le rapport dotations affiche les colonnes OD), mais `rapport_meta.linked_justifs` est bien rempli (vérifiable via `cat data/ged/ged_metadata.json`).
5. **Metadata GED** : ouvrir `data/ged/ged_metadata.json` après génération → entrée pour le rapport contient `rapport_meta.linked_justifs: ["apple_20240312_2599.00.pdf", ...]`.
6. **ZIP enrichi** : drawer envoi → cocher uniquement le rapport `amortissements_registre` 2026 → preview email → arborescence montre `Justificatifs_immobilisations/` avec N fichiers. Envoi (mode manuel pour tester sans SMTP) → ouvrir le ZIP → le sous-dossier existe avec les bons PDFs.
7. **Déduplication** : drawer envoi → cocher rapport amortissements_registre 2026 + cocher manuellement le justif `apple_20240312_2599.00.pdf` dans le panneau gauche → le ZIP final contient ce fichier UNIQUEMENT dans `Justificatifs_immobilisations/`, pas dans `justificatifs/`.
8. **Justif manquant** : créer une immo dont le justif a été supprimé physiquement de `data/justificatifs/traites/` (mais référencé dans une op), regénérer le rapport → `linked_justifs` contient quand même le filename → à l'envoi, log warning « Justif lié manquant : X » mais pas de crash, le ZIP est généré sans ce fichier.
9. **Bouton header AmortissementsPage** : ouvrir la page, year 2026 → bouton « Envoyer au comptable » visible dans le header. Clic → toast loading « Génération des rapports... » si nécessaire → drawer s'ouvre pré-rempli avec les 2 rapports cochés + tous les justifs liés cochés + filtres `Rapports` et `Justificatifs` actifs + objet `Amortissements — Exercice 2026`.
10. **Bouton header — rapports déjà existants** : si les 2 rapports de l'année existent déjà dans la GED → pas de génération, le drawer s'ouvre immédiatement (pas de toast loading).
11. **Régénération invalide les caches** : régénérer le rapport `amortissements_registre` 2026 → `useGedTree` invalidé, le bouton header de la page Amortissements voit la nouvelle metadata `linked_justifs` au prochain clic.
12. **Régression Charges Forfaitaires** : son bouton « Envoyer au comptable » fonctionne toujours, pas de conflit dans `sendDrawerStore`.
13. **Régression drawer universel** : ouverture depuis sidebar / GED / Exports → comportement inchangé (pas de pré-sélection involontaire).
14. **Backward compat metadata** : un rapport généré avant cette session (sans `linked_justifs` dans rapport_meta) ne crashe pas l'envoi — `linked_justifs ?? []` partout.
15. **TypeScript** : `npx tsc -p tsconfig.app.json --noEmit` → 0 erreur.
16. **CLAUDE.md** : section Amortissements mise à jour avec le nouveau bullet.

---

## 6. Hors scope (évolutions futures)

- Pas de bouton « Envoyer au comptable » dans le header des pages **Compta Analytique** ou **Dashboard** — ce prompt se concentre sur Amortissements.
- Pas d'autre rapport enrichi avec `linked_justifs` (ex : Repas, Blanchissage). Les forfaits ont leur propre PDF rapport mais pas de notion de justif lié au sens immo. Évolution possible mais pas dans ce prompt.
- Pas de cellule cliquable sur la colonne « Justificatif » du PDF (impossible nativement — on peut éventuellement ajouter un lien `internal://` dans le PDF qui ouvre le justif si le ZIP est extrait, mais c'est fragile et hors scope).
- Pas de personnalisation par utilisateur du chemin de sous-dossier (`Justificatifs_immobilisations/` est en dur — cohérent avec les autres sous-dossiers).
- Pas d'option « inclure les justifs » à décocher au moment de l'envoi. Si l'utilisateur ne veut pas les justifs, il dé-coche le rapport amortissements puis re-coche uniquement le rapport (mais sans `linked_justifs` resolu).

> **Note évolution possible** : si le pattern « décocher les justifs liés sans décocher le rapport » est demandé plus tard, ajouter un toggle dans le drawer pour ce sous-dossier spécifiquement.

---

## 7. Fichiers attendus modifiés / créés

### Modifiés (backend)
- `backend/services/amortissement_report_service.py` (ou `report_service.py` selon localisation actuelle de `render_registre`) — colonne Justificatif PDF/CSV/XLSX + helper `_format_justif_cell` + ligne TOTAL enrichie
- `backend/services/report_service.py` — `_compute_linked_justifs()` + injection dans `register_rapport(rapport_meta=...)`
- `backend/services/email_service.py` — `_create_zip` étendu (passes 1/2/3) + `_build_zip_tree` / `_build_doc_tree` enrichis pour afficher le nouveau sous-dossier dans l'arbre email
- `backend/services/email_service.py` — `generate_email_body_plain()` mentionne le sous-dossier en mode texte

### Modifiés (frontend)
- `frontend/src/types/index.ts` — `RapportMeta.linked_justifs?: string[]`
- `frontend/src/hooks/useAmortissements.ts` — `usePrepareAmortissementsEnvoi(year)`
- `frontend/src/pages/AmortissementsPage.tsx` — bouton header + handler + toast
- `frontend/src/stores/sendDrawerStore.ts` — éventuels champs ajoutés (`preselectedDocs`, `activeFilters`, `defaultIntro`) si pas déjà présents

### Modifiés (docs)
- `CLAUDE.md` — section Amortissements

---

**Fin du prompt.** À exécuter **après** que le prompt « Annotation immobilisation + visualisation justificatif » soit complètement appliqué et vérifié.
