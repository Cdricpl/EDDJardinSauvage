# Note de confidentialité & politique de rétention

_EDD Jardin Sauvage — application de gestion des horaires, prestations et présences._

Ce document décrit les données traitées par l'application, leur finalité, qui y a
accès, et combien de temps elles sont conservées. Il vaut information au sens du
**RGPD** (Règlement (UE) 2016/679). Adaptez les champs entre crochets à votre réalité.

## 1. Responsable du traitement
- **Organisation :** [École des devoirs « Jardin Sauvage », adresse]
- **Contact :** [nom du·de la responsable] — [email de contact]

## 2. Données traitées et finalités

| Catégorie | Données | Finalité | Base légale |
|---|---|---|---|
| **Personnel (RH)** | Nom, email, rôle, horaires prévus/réels, prestations, écarts, justifications | Suivi du temps de travail, gestion des heures et des soldes | Obligation légale / exécution du contrat de travail |
| **Enfants** | Prénom, nom, présences journalières | Suivi de la fréquentation, encadrement, statistiques agrégées | Intérêt légitime / mission de l'établissement |
| **Compte** | Email, mot de passe (géré par Supabase Auth, jamais stocké en clair par l'app) | Authentification | Exécution du service |

Aucune donnée n'est vendue ni transmise à des tiers à des fins commerciales.

## 3. Hébergement et sécurité
- Données stockées chez **Supabase** (PostgreSQL, UE selon le projet).
- Accès protégé par mot de passe, chiffrement en transit (HTTPS).
- **Cloisonnement (Row Level Security)** :
  - Les **prestations** d'une employée ne sont lisibles que **par elle-même et par
    l'administrateur** (une employée ne voit pas les heures de sa collègue).
  - La **liste des enfants et leurs présences** est accessible à l'équipe encadrante
    (administrateur + employées), car elle est nécessaire à l'encadrement quotidien.
  - Seul l'**administrateur** peut créer/archiver des comptes et valider les mois.

## 4. Durées de conservation (rétention)
- **Prestations / données RH :** conservées le temps requis par les obligations
  sociales et comptables (généralement plusieurs années — [préciser selon la
  législation applicable]).
- **Présences des enfants :** conservées pour l'**année scolaire** en cours, puis
  **purgées ou anonymisées** au-delà (par défaut : purge annuelle des présences des
  années antérieures via l'outil intégré).
- **Comptes archivés :** conservés en lecture seule tant que des prestations liées
  doivent l'être, puis supprimés.

L'onglet **Utilisateurs → « Données »** (administrateur) permet d'**exporter** une
sauvegarde complète et de **purger/anonymiser** les données au-delà de leur durée utile.

## 5. Droits des personnes
Toute personne concernée (ou son représentant légal pour un enfant) peut demander
l'**accès**, la **rectification**, l'**effacement** ou la **limitation** de ses données,
en écrivant au contact ci-dessus. Une réponse est apportée dans les meilleurs délais.

## 6. Sauvegarde
Une sauvegarde manuelle (export JSON/CSV) peut être réalisée à tout moment par
l'administrateur depuis l'onglet **Utilisateurs → « Données »**. Il est recommandé de
l'effectuer régulièrement et de la conserver dans un endroit sûr.

---
_Dernière mise à jour : [date]. Ce modèle est fourni à titre indicatif et ne constitue
pas un conseil juridique ; faites-le valider si nécessaire._
