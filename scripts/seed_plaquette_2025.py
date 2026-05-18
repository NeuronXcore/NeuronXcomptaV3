"""Pré-remplit data/plaquette_check/2025.json avec les valeurs de la plaquette
Sygnatures Marenco 2025 et les statuts/commentaires des anomalies discutées
dans la session de comparaison du 2026-05-18.

Usage : python3 scripts/seed_plaquette_2025.py
"""
from __future__ import annotations

import sys
import requests

API = "http://localhost:8000/api/plaquette"
YEAR = 2025

# Montants plaquette comptable 2025 (Sygnatures Marenco) + N-1
# Source : data/ged/2025/12/PLAQUETTE CECCOLI 2025.pdf (pages 7-8 "Détail de la 2035")
MONTANTS = {
    # PCG    : (montant 2025, montant 2024, statut, commentaire)
    "60630000": (11433.00, 12326.00, "a_challenger",
                 "Écart probable : Amazon Marketplace (1 922 €) + Boulanger 5 ops (1 987 €) refusés faute de description pro explicite. 100 % des 92 factures sont disponibles dans NeuronX. À fournir au comptable pour réintégration."),
    "60640000": (977.00, 468.00, "ok", ""),
    "60641000": (None, 22.00, "non_revu", ""),
    "60650000": (1190.00, 2819.00, "ok",
                 "Quote-part véhicule 51 % bien appliquée (NeuronX brut Véhicule>Essence 2 162 € × 51 % ≈ 1 103 €, écart marginal +87 €)."),
    "61210000": (8816.00, 30832.00, "ok",
                 "Crédit-bail Ford Ranger 17 286 € × 51 % = 8 816 € — quote-part véhicule correctement appliquée."),
    "61550000": (229.00, 843.00, "ok", "QP véhicule 51 % OK"),
    "61560000": (3989.00, 0.00, "a_challenger",
                 "Aucune correspondance NeuronX. Probablement reclassement Logiciel + Abonnements (Claude/OpenAI/Microsoft = 3 507 €) ou facture de maintenance externe. Demander pièce justificative au comptable."),
    "61620000": (378.00, 686.00, "ok", "QP véhicule 51 % OK"),
    "61680000": (151.00, 681.00, "non_revu", ""),
    "61830000": (7958.00, 0.00, "ok",
                 "Le comptable a +223 € de plus que NeuronX (7 734 €). Probablement formation hors flux bancaire ou ajustement. À confirmer."),
    "61850000": (None, 552.00, "non_revu", ""),
    "61860000": (2367.00, 4485.00, "ok",
                 "Forfait blanchissage BOI-BNC-BASE-40-20 — match parfait avec NeuronX."),
    "62210000": (1302.00, 2633.00, "ok", "Match parfait NeuronX."),
    "62265000": (38793.00, 35800.00, "a_challenger",
                 "Écart +6 500 € côté comptable (NeuronX 32 293 €). Aucune piste évidente — demander le détail des bénéficiaires/dates pour identifier les rétrocessions manquantes côté NeuronX (compensations directes en SCP ? OD comptables ?)."),
    "62510000": (884.00, 1057.00, "non_revu", ""),
    "62511000": (1673.00, 922.00, "a_challenger",
                 "⚠️ ANOMALIE MAJEURE : Forfait repas BOI-BNC-BASE-40-60 NON déduit. Calcul théorique 178 jours × 14,85 € = 2 643 €. Manque ~660 € IR + 770 € URSSAF. Demander régularisation via OD compte 62511000."),
    "62600000": (14.00, 8.00, "ok", "Match parfait."),
    "62610000": (2051.00, 1135.00, "ok", "Match parfait."),
    "62700000": (798.00, 876.00, "ok",
                 "Écart +275 € côté comptable (NeuronX 523 €) probablement frais BNP du nouveau compte non tracés. À vérifier."),
    "62810000": (364.00, 360.00, "ok", "Match parfait."),
    "63330000": (118.00, 116.00, "ok", "Participation formation pro — petit montant OK."),
    "63781000": (28390.00, 11645.00, "en_discussion",
                 "Divergence méthodologique URSSAF/CSG : comptable applique 2,9 % × CA brut (= 11 962 €+) sur la ventilation réelle des bulletins. NeuronX calcule réforme 2025 (BNC × 0,74). Récupérer les bulletins URSSAF 2025 pour aligner."),
    "63782000": (236.00, 232.00, "non_revu", "Contribution unions régionales — petit montant"),
    "64610000": (15951.00, 3898.00, "en_discussion",
                 "Idem CSG — méthode différente. URSSAF total 56 803 € se décompose chez le comptable en : 15 951 € (cotisations) + 28 390 € (CSG déduc) + 12 462 € (CSG ND + CRDS non déduc)."),
    "64630000": (26660.00, 27248.00, "ok",
                 "Match parfait CARMF — montant identique NeuronX."),
    "67120000": (None, 32.00, "non_revu", ""),

    # Bilan matériel info (variation 2024 → 2025)
    "21831000": (16379.00, 16380.00, "a_challenger",
                 "⚠️ ANOMALIE MAJEURE : 5 408 € d'acquisitions 2025 (LDLC 2 600 €, Amazon 790 €, PayPal 1 479 €, LDLC 540 €) NON immobilisées (variation actif = -1 € seulement). Probablement noyées dans 60630000 Petit outillage. La LDLC 2 600 € (serveur) doit être immobilisée selon PCG (seuil 500 €)."),

    # Dotation aux amortissements
    "28183100": (5468.00, 3317.00, "en_discussion",
                 "NeuronX 6 630 € (avec reprise historique matériel info pré-2025 base 16 380 €) vs comptable 5 468 €. Écart méthodologique acceptable (durées proches). À aligner si registre N-1 complet fourni par le comptable."),
}

# Totaux 2035 (cadre haut)
TOTAUX = {
    "recettes": 412470.00,
    "depenses": 154722.00,
    "benefice": 252279.00,
    "recettes_n1": 409784.00,
    "depenses_n1": 139676.00,
    "benefice_n1": 288817.00,
}


def main() -> int:
    # 1. Récupérer le PlaquetteCheck (créé si absent) — ça va charger les 28 items via le mapping
    print(f"GET {API}/{YEAR}…")
    resp = requests.get(f"{API}/{YEAR}", timeout=30)
    resp.raise_for_status()
    data = resp.json()
    items = {i["compte_pcg"]: i for i in data["items"]}
    print(f"  → {len(items)} items chargés")

    # 2. PATCH chaque item avec montant + statut + commentaire
    n_patched = 0
    n_skipped = 0
    for pcg, (mp, mp_n1, statut, commentaire) in MONTANTS.items():
        if pcg not in items:
            print(f"  ⚠ Compte {pcg} absent du mapping — skip")
            n_skipped += 1
            continue
        item = items[pcg]
        patch = {
            "montant_plaquette": mp,
            "montant_plaquette_n1": mp_n1,
            "statut": statut,
            "commentaire": commentaire,
        }
        r = requests.patch(
            f"{API}/{YEAR}/items/{item['item_id']}",
            json=patch,
            timeout=15,
        )
        if r.ok:
            n_patched += 1
        else:
            print(f"  ✗ {pcg} échec : {r.status_code} {r.text[:150]}")

    print(f"  → {n_patched} items patchés / {n_skipped} skip")

    # 3. PATCH totaux (cadre haut 2035)
    print(f"PATCH totaux…")
    r = requests.patch(f"{API}/{YEAR}/totaux", json=TOTAUX, timeout=15)
    if r.ok:
        print(f"  → totaux enregistrés : {r.json()['totaux_plaquette']}")
    else:
        print(f"  ✗ échec totaux : {r.status_code} {r.text[:150]}")

    # 4. Lier au doc GED
    ged_doc_id = "data/ged/2025/12/PLAQUETTE CECCOLI 2025.pdf"
    print(f"POST set-ged-ref…")
    r = requests.post(
        f"{API}/{YEAR}/set-ged-ref",
        json={"ged_doc_id": ged_doc_id, "cabinet_template": "sygnatures_marenco"},
        timeout=15,
    )
    if r.ok:
        print(f"  → lié au doc GED {ged_doc_id}")
    else:
        print(f"  ✗ échec set-ged-ref : {r.status_code} {r.text[:150]}")

    # 5. Final check
    print(f"\nGET final…")
    final = requests.get(f"{API}/{YEAR}").json()
    statuts = {}
    for it in final["items"]:
        s = it["statut"]
        statuts[s] = statuts.get(s, 0) + 1
    print(f"  Items: {len(final['items'])}")
    print(f"  Statuts: {statuts}")
    print(f"  Totaux: {final['totaux_plaquette']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
