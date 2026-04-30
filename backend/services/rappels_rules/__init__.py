"""Package des règles de rappel — chaque règle est un module dédié."""
from __future__ import annotations

from backend.services.rappels_rules._base import RappelContext, RappelRule
from backend.services.rappels_rules.bnc_baisse_significative import BncBaisseSignificativeRule
from backend.services.rappels_rules.charges_forfaitaires_non_generees import ChargesForfaitairesNonGenereesRule
from backend.services.rappels_rules.compte_attente_satur import CompteAttenteSaturRule
from backend.services.rappels_rules.declaration_2035 import Declaration2035Rule
from backend.services.rappels_rules.dotation_amort_manquante import DotationAmortManquanteRule
from backend.services.rappels_rules.justificatifs_manquants import JustificatifsManquantsRule
from backend.services.rappels_rules.lettrage_retard_cloture import LettrageRetardClotureRule
from backend.services.rappels_rules.liasse_scp_incoherente import LiasseScpIncoherenteRule
from backend.services.rappels_rules.liasse_scp_manquante import LiasseScpManquanteRule
from backend.services.rappels_rules.mois_non_cloture import MoisNonClotureRule
from backend.services.rappels_rules.urssaf_regul_anticipee import UrssafRegulAnticipeeRule

# Liste des règles actives. Désactivation par utilisateur via Settings
# (`rappels_disabled_rules`) — l'engine skip à l'évaluation. Pour retirer
# durablement une règle, commenter la ligne correspondante.
ALL_RULES: list[RappelRule] = [
    JustificatifsManquantsRule(),
    MoisNonClotureRule(),
    Declaration2035Rule(),
    LiasseScpManquanteRule(),
    CompteAttenteSaturRule(),
    UrssafRegulAnticipeeRule(),
    LettrageRetardClotureRule(),
    DotationAmortManquanteRule(),
    ChargesForfaitairesNonGenereesRule(),
    LiasseScpIncoherenteRule(),
    BncBaisseSignificativeRule(),
]

__all__ = ["ALL_RULES", "RappelContext", "RappelRule"]
