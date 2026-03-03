# 🚨 PercoGuard - Bot d'Alerte Percepteur (Discord.js)

**PercoGuard** est un bot Discord spécialisé pour la gestion des alertes de défense de Percepteur sur Dofus. Il remplace les commandes classiques par un système de bouton cliquable pour une réactivité maximale et une traçabilité totale.

## ✨ Fonctionnalités
* **Alerte par Bouton** : Un seul clic pour lancer une défense complète.
* **Anti-Troll & Traçabilité** : Chaque alerte affiche publiquement son auteur et enregistre un log privé (ID + Pseudo) pour éviter les pings abusifs.
* **Configuration In-App** : Pas besoin de toucher au code. Utilisez `/configurer` pour modifier les salons et rôles.
* **Maintien en vie (Keep-Alive)** : Serveur Express intégré pour une compatibilité 24h/7 avec des services comme cron-job.org.

## 🛠️ Installation

1.  Clonez le dépôt ou téléchargez les fichiers.
2.  Installez les dépendances :
    ```bash
    npm install
    ```
3.  Configurez le fichier `config.json` avec vos accès (Token, Client ID, Guild ID).
4.  Lancez le bot :
    ```bash
    node index.js
    ```

## ⚙️ Configuration sur Discord
1.  Utilisez la commande `/configurer` pour définir le salon général, le salon de logs et le rôle à pinger.
2.  Allez dans le salon où vous voulez le bouton et tapez `/setup-bouton`.

## 📂 Structure du projet
- `index.js` : Code principal (Express + Discord.js).
- `config.json` : Identifiants secrets (non inclus sur GitHub via .gitignore).
- `settings.json` : Stockage de votre configuration personnalisée.

---
*Projet réalisé dans le cadre de l'optimisation des guildes Dofus - Mars 2026*