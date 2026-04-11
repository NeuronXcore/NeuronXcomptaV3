"""
One-shot : répare les fac-similés Ibis Hotel cassés.

Contexte
--------
Le template `tpl_1c526a22` ("ibis hotel") a été créé avec `fields: []`, et son
`source_justificatif` référence un fichier qui a été renommé lors de la migration
virgule→point (`clinique-pont-de-chaumes_20250324_126,24_2.pdf`). Résultat :
`generate_reconstitue()` a produit deux PDFs de 1736 octets (en-tête ReportLab
nu, aucune donnée), et leurs `.ocr.json` ont `best_date: ""` et
`best_amount: null`. Ces deux fichiers sont associés à 4 opérations d'hébergement
remplaçant (Ibis/Accor mai-juin 2025) et n'ont jamais pu migrer vers le format
canonique `_fs` car le scan-rename les skippe (skipped_no_date_amount).

Ce script :
  1. Répare le template `tpl_1c526a22` :
     - ajoute 3 champs (date, montant_ttc sourcés de l'op, fournisseur fixe)
     - pointe `source_justificatif` vers la vraie facture Ibis (après migration)
     - détecte les coordonnées de date/montant dans le PDF via pdfplumber
  2. Supprime les associations cassées ET les 4 fac-similés ReportLab sobres
     précédemment générés (ibis-hotel_*_fs.pdf)
  3. Regénère 4 fac-similés en mode IMAGE (reprise du layout de la vraie facture
     Ibis + overlay date/montant aux bonnes coordonnées)
  4. Chaque nouveau fichier est canonique : `ibis-hotel_YYYYMMDD_XX.XX_fs.pdf`

Idempotent : si relancé après réparation, les renames canoniques existeront
déjà et seront dédupliqués en `_2.pdf`.

Usage :
    python3 scripts/fix_ibis_reconstitue.py
    python3 scripts/fix_ibis_reconstitue.py --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

# Ajouter la racine du repo au PYTHONPATH
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.core.config import (  # noqa: E402
    GED_METADATA_FILE,
    GED_THUMBNAILS_DIR,
    JUSTIFICATIFS_EN_ATTENTE_DIR,
    JUSTIFICATIFS_TRAITES_DIR,
)
from backend.models.template import (  # noqa: E402
    FieldCoordinates,
    GenerateRequest,
    TemplateField,
)
from backend.services import operation_service, template_service  # noqa: E402


TEMPLATE_ID = "tpl_1c526a22"

# Vraie facture Ibis Montauban utilisée comme template visuel
# (le fichier en_attente/ est libre — pas associé à une opération existante
# puisque l'op DU190325 pointe vers traites/clinique-pont-de-chaumes_20250324_126.24.pdf)
SOURCE_PDF_CANDIDATES = [
    "clinique-pont-de-chaumes_20250324_126.24_2.pdf",  # en_attente
    "clinique-pont-de-chaumes_20250324_126.24.pdf",    # traites (fallback)
]

# Les valeurs présentes dans le PDF source (pour localiser les coordonnées)
# Facture Ibis du 22-24/03/2025, total 126,24 €.
SOURCE_DATE = "2025-03-24"
SOURCE_AMOUNT = 126.24

BROKEN_OPS: list[tuple[str, int]] = [
    ("operations_20260402_163338_38dd0f42.json", 38),  # DU220525 Accor*Ibis 76,42
    ("operations_20260402_163338_38dd0f42.json", 46),  # DU270525 Le Castel Ibis 33,00
    ("operations_20260402_163812_41fcd232.json", 38),  # DU190625 Accor*Ibis 63,12
    ("operations_20260402_163812_41fcd232.json", 44),  # DU230625 Le Castel Ibis 23,00
]

# Fichiers à supprimer avant régénération :
# - les 2 PDFs vides d'origine (run initial du batch)
# - les 4 fac-similés ReportLab sobres générés par la première itération du fix
BROKEN_LEGACY: list[str] = [
    "reconstitue_20260409_204623_ibis_hotel.pdf",
    "reconstitue_20260409_204624_ibis_hotel.pdf",
]
BROKEN_SOBER_FACSIMILES: list[str] = [
    "ibis-hotel_20250522_76.42_fs.pdf",
    "ibis-hotel_20250527_33.00_fs.pdf",
    "ibis-hotel_20250619_63.12_fs.pdf",
    "ibis-hotel_20250623_23.00_fs.pdf",
]


def step(msg: str) -> None:
    print(f"\n=== {msg} ===")


def info(msg: str) -> None:
    print(f"  {msg}")


def find_source_pdf() -> Path:
    for name in SOURCE_PDF_CANDIDATES:
        for d in (JUSTIFICATIFS_EN_ATTENTE_DIR, JUSTIFICATIFS_TRAITES_DIR):
            p = d / name
            if p.exists():
                return p
    raise FileNotFoundError(
        f"Aucun PDF source candidat trouvé : {SOURCE_PDF_CANDIDATES}"
    )


def detect_coordinates(pdf_path: Path) -> dict[str, FieldCoordinates]:
    """Cherche les positions de la date SOURCE_DATE et du montant SOURCE_AMOUNT
    dans le PDF via pdfplumber (réutilise la logique de _match_value_in_words)."""
    fields_draft = [
        {"key": "date", "value": SOURCE_DATE},
        {"key": "montant_ttc", "value": f"{SOURCE_AMOUNT:.2f}"},
    ]
    template_service._enrich_field_coordinates(fields_draft, pdf_path)
    out: dict[str, FieldCoordinates] = {}
    for f in fields_draft:
        c = f.get("coordinates")
        if c:
            out[f["key"]] = FieldCoordinates(**c)
    return out


def fix_template(dry_run: bool) -> None:
    step("1. Réparation du template tpl_1c526a22")
    source_pdf = find_source_pdf()
    info(f"PDF source : {source_pdf.relative_to(REPO_ROOT)}")

    coords = detect_coordinates(source_pdf)
    info(f"Coordonnées détectées : {list(coords.keys())}")
    for k, c in coords.items():
        info(f"  {k}: x={c.x:.1f} y={c.y:.1f} w={c.w:.1f} h={c.h:.1f} page={c.page}")

    if "date" not in coords or "montant_ttc" not in coords:
        print("ERREUR : coordonnées date ou montant_ttc introuvables dans le PDF source")
        sys.exit(1)

    store = template_service.load_templates()
    tpl = None
    for t in store.templates:
        if t.id == TEMPLATE_ID:
            tpl = t
            break
    if tpl is None:
        print(f"ERREUR: template {TEMPLATE_ID} introuvable")
        sys.exit(1)

    info(f"État actuel : fields={len(tpl.fields)}, source={tpl.source_justificatif!r}, usage_count={tpl.usage_count}")

    tpl.fields = [
        TemplateField(
            key="date",
            label="Date",
            type="date",
            source="operation",
            required=True,
            coordinates=coords["date"],
        ),
        TemplateField(
            key="montant_ttc",
            label="Montant TTC",
            type="currency",
            source="operation",
            required=True,
            coordinates=coords["montant_ttc"],
        ),
        TemplateField(
            key="fournisseur",
            label="Fournisseur",
            type="text",
            source="fixed",
            default=None,
        ),
    ]
    # Référencer le nom du fichier (pas le chemin) — _find_justificatif() cherche
    # dans en_attente puis traites.
    tpl.source_justificatif = source_pdf.name
    tpl.usage_count = 0

    if dry_run:
        info("[DRY-RUN] save_templates() skippé")
    else:
        template_service.save_templates(store)
        info(f"Template sauvegardé : 3 champs (date, montant_ttc, fournisseur) + source={source_pdf.name}")


def dissociate_ops_and_delete(dry_run: bool) -> None:
    step("2. Dissociation des 4 opérations + suppression des fac-similés existants")
    for op_file, op_idx in BROKEN_OPS:
        ops = operation_service.load_operations(op_file)
        if not (0 <= op_idx < len(ops)):
            continue
        op = ops[op_idx]
        libelle = (op.get("Libellé") or "")[:40]
        lien = op.get("Lien justificatif", "")
        info(f"{op_file}[{op_idx}] «{libelle}» → lien={lien}")
        if dry_run:
            continue
        op["Justificatif"] = False
        op["Lien justificatif"] = ""
        operation_service.save_operations(ops, filename=op_file)

    # Supprimer les fichiers legacy (PDFs vides initiaux) + fac-similés sobres
    for pdf_name in BROKEN_LEGACY + BROKEN_SOBER_FACSIMILES:
        pdf_path = JUSTIFICATIFS_TRAITES_DIR / pdf_name
        ocr_path = pdf_path.with_suffix(".ocr.json")
        doc_id = f"data/justificatifs/traites/{pdf_name}"
        thumb_hash = hashlib.md5(doc_id.encode()).hexdigest()
        thumb_path = GED_THUMBNAILS_DIR / f"{thumb_hash}.png"

        if not pdf_path.exists() and not ocr_path.exists() and not thumb_path.exists():
            continue
        info(f"Supprime : {pdf_name} (+.ocr.json, +thumb)")
        if dry_run:
            continue
        for p in (pdf_path, ocr_path, thumb_path):
            if p.exists():
                p.unlink()

    # Nettoyer ged_metadata.json
    if GED_METADATA_FILE.exists():
        with open(GED_METADATA_FILE, "r", encoding="utf-8") as f:
            meta = json.load(f)
        documents = meta.get("documents") if isinstance(meta, dict) else None
        removed_keys: list[str] = []
        if isinstance(documents, dict):
            for pdf_name in BROKEN_LEGACY + BROKEN_SOBER_FACSIMILES:
                key = f"data/justificatifs/traites/{pdf_name}"
                if key in documents:
                    removed_keys.append(key)
                    if not dry_run:
                        documents.pop(key, None)
            if removed_keys and not dry_run:
                with open(GED_METADATA_FILE, "w", encoding="utf-8") as f:
                    json.dump(meta, f, ensure_ascii=False, indent=2)
        info(f"GED metadata : {len(removed_keys)} entrées retirées")


def regenerate_facsimiles(dry_run: bool) -> None:
    step("3. Regénération de 4 fac-similés (mode image)")
    if dry_run:
        info("[DRY-RUN] generate_reconstitue() skippé")
        return

    for op_file, op_idx in BROKEN_OPS:
        try:
            result = template_service.generate_reconstitue(
                GenerateRequest(
                    template_id=TEMPLATE_ID,
                    operation_file=op_file,
                    operation_index=op_idx,
                    field_values={"fournisseur": "ibis hotel"},
                    auto_associate=True,
                )
            )
            pdf_name = result.get("filename", "?")
            assoc = result.get("associated", False)
            size = 0
            p = JUSTIFICATIFS_TRAITES_DIR / pdf_name
            if p.exists():
                size = p.stat().st_size
            info(f"OK  {op_file}[{op_idx}] → {pdf_name} ({size} o, associé={assoc})")
        except Exception as e:
            print(f"ERREUR {op_file}[{op_idx}] : {e}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Simulation sans modification")
    args = parser.parse_args()

    if args.dry_run:
        print("*** DRY-RUN : aucune modification effectuée ***")

    fix_template(args.dry_run)
    dissociate_ops_and_delete(args.dry_run)
    regenerate_facsimiles(args.dry_run)

    print("\n=== Terminé ===")
    if args.dry_run:
        print("Relance sans --dry-run pour appliquer les modifications.")


if __name__ == "__main__":
    main()
