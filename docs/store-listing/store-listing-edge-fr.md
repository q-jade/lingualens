Traduisez le web avec les fournisseurs de votre choix

LinguaLens est une extension de traduction pour navigateur conçue pour la flexibilité. Contrairement aux outils liés à un seul fournisseur cloud, LinguaLens vous permet de décider où chaque traduction s'exécute : sur votre propre machine avec des LLM locaux, via les principales API cloud, par n'importe quelle passerelle compatible OpenAI, ou via un modèle d'API HTTP personnalisable. Définissez un fournisseur par défaut, ajoutez une chaîne de secours optionnelle, et la traduction continue même quand votre service principal est indisponible.

POURQUOI LINGUALENS

• Apportez votre propre backend — Aucune dépendance à un seul service de traduction.
• Local d'abord — Utilisez Ollama ou LM Studio pour que le texte sensible reste sur votre machine.
• Le cloud quand vous en avez besoin — OpenAI, DeepSeek, DeepL, Google Cloud Translation et plus encore.
• Points de terminaison compatibles OpenAI — Fonctionne avec toute passerelle ou proxy exposant /v1/chat/completions.
• API HTTP personnalisée — Configurez la méthode, les en-têtes, le modèle de corps JSON et le chemin de réponse pour les stacks propriétaires.
• Flux de travail résilient — Fournisseurs de secours ordonnés si le défaut échoue en cours de session.
• Modèle de confidentialité honnête — LinguaLens n'exploite aucun serveur de traduction ; vous choisissez qui reçoit votre texte.
• Interface multilingue — 9 langues d'interface : English, 中文 (simplifié/traditionnel), 日本語, 한국어, Français, Deutsch, Español, Русский.

FOURNISSEURS DE TRADUCTION

Local
• Ollama (préréglage par défaut) — s'exécute sur localhost:11434
• LM Studio — Utilise l'API locale native de LM Studio

Préréglages cloud
• OpenAI, DeepSeek, DeepL (gratuit & Pro), Google Cloud Translation

Avancé
• Compatible OpenAI — Toute URL de base fournie par l'utilisateur exposant /v1/chat/completions
• API personnalisée — Modèle de requête HTTP entièrement configurable

Vérifiez la connectivité de chaque fournisseur depuis les Paramètres avant d'enregistrer. Les clés API (si nécessaires) sont stockées localement dans le stockage du navigateur.

FONCTIONNALITÉS

Traduction de sélection
Sélectionnez du texte sur n'importe quelle page web — y compris les documents PDF ouverts dans le navigateur. Choisissez parmi quatre modes de déclenchement : une icône flottante près de votre sélection (par défaut), traduction instantanée à la sélection, maintenir une touche modificatrice pour déclencher, ou désactiver le déclenchement. Ouvrez le panneau pour voir les résultats, réessayer en cas d'échec, copier la traduction ou la fermer. Épinglez le panneau pour le garder ouvert pendant plusieurs sélections. Également disponible via le menu contextuel, ou appuyez sur Alt+T pour traduire la sélection en une étape. Changez le fournisseur de traduction actif à tout moment depuis l'en-tête du panneau. Sur les pages où les scripts de contenu ne peuvent pas s'exécuter (pages internes du navigateur, boutiques d'extensions), le clic droit sur Traduire achemine la sélection vers le panneau latéral, qui s'ouvre automatiquement.

Traduction bilingue de page entière
Convertissez des articles, documents et longues pages en lecture bilingue ou en remplacement intégré sans quitter le site. Basculez entre les modes à tout moment depuis la barre d'état. Lancez depuis la popup (« Traduire cette page »), le menu contextuel de la page, ou Alt+Shift+T. Une barre d'état affiche la progression et permet d'arrêter la traduction, de restaurer le texte original ou de changer le mode d'affichage.

Modes de traduction de page
• Qualité — Segments plus grands, meilleur contexte pour la traduction LLM
• Vitesse — Segments plus petits, mises à jour progressives plus rapides

Traducteur popup
Cliquez sur l'icône de la barre d'outils pour coller ou taper du texte, choisir une langue cible et traduire instantanément. Accédez aux Paramètres ou lancez la traduction complète de la page sur l'onglet actif.

Panneau latéral
Ouvrez un espace de travail de traduction dédié depuis la popup. Définissez les langues source et cible, échangez-les, consultez les résultats et parcourez l'historique des traductions récentes stocké localement sur votre appareil. Nécessite Chromium 114 ou version ultérieure.

Paramètres et intégration
Lors de la première installation, les Paramètres s'ouvrent automatiquement avec un court guide de configuration. Configurez les langues, le fournisseur par défaut, l'ordre de secours, le modèle de prompt LLM et les options par fournisseur telles que la désactivation de la sortie « thinking » sur les modèles compatibles pour des traductions plus rapides et plus propres.

Performance
Le cache de traduction intégré réduit les appels API répétés pour un texte identique pendant la navigation.

RACCOURCIS CLAVIER

Alt+T — Traduire la sélection
Alt+Shift+T — Traduire la page entière
Alt+M — Changer le mode de déclenchement de sélection (icône → instantané → touche mod. → désactivé)

Si les raccourcis entrent en conflit avec d'autres extensions, réassignez-les dans les paramètres de raccourcis des extensions de votre navigateur.

POUR COMMENCER

1. Installez LinguaLens. Les Paramètres s'ouvrent au premier lancement.
2. Faites défiler jusqu'à Fournisseurs de traduction. Activez au moins un backend.
3. Définissez l'URL de base, le modèle et la clé API si nécessaire. Cliquez sur Vérifier, puis Enregistrer les paramètres.
4. Ouvrez une page https normale et essayez la traduction de sélection ou de page entière.

Astuce Ollama : exécutez `ollama pull llama3` et démarrez Ollama avec la variable d'environnement OLLAMA_ORIGINS définie sur l'origine de votre extension si le navigateur ne peut pas se connecter localement.

CONFIDENTIALITÉ

LinguaLens n'exploite pas ses propres serveurs de traduction. Le texte que vous traduisez est envoyé uniquement aux fournisseurs que vous activez. Les paramètres et les clés API restent sur votre appareil. Consultez l'URL de la politique de confidentialité sur cette fiche. Examinez les politiques tierces pour toute API cloud que vous utilisez.

LIMITATIONS

• La traduction de page entière ne fonctionne pas sur les pages restreintes (pages internes du navigateur, boutique d'extensions, etc.) ; la traduction de sélection y est acheminée vers le panneau latéral (Chromium 114+)
• Nécessite au moins un fournisseur configuré et fonctionnel pour traduire
• Le panneau latéral nécessite Chromium 114+
• Les très longues pages peuvent prendre du temps et nécessiter plusieurs appels API

ASSISTANCE

Problèmes et retours : https://github.com/q-jade/lingualens/issues
Page d'accueil du projet : https://github.com/q-jade/lingualens

Lisez les actualités étrangères, la documentation technique, la recherche et les forums avec le flux de traduction que vous contrôlez.
