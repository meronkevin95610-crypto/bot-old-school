require('dotenv').config();
const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- 1. SERVEUR POUR RENDER (Keep-Alive) ---
http.createServer((req, res) => {
    res.writeHead(200); res.end("Système Multi-Bot Connecté");
}).listen(process.env.PORT || 3000);

// --- 2. INITIALISATION DES DEUX BOTS ---
// Ajout de GuildMembers pour être sûr de bien voir les pseudos
const botGestion = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const botPerco = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT, joueur_nom TEXT, points REAL, date TEXT)`);
});

// --- 3. LOGIQUE BOT GESTION (Classement) ---
botGestion.on('messageCreate', async (m) => {
    if (m.author.bot) return;
    
    if (m.content === '!top') {
        db.all(`SELECT joueur_nom, SUM(points) as p FROM attaques GROUP BY joueur_nom ORDER BY p DESC LIMIT 15`, (err, rows) => {
            if (err || !rows || rows.length === 0) return m.reply("🏆 Aucun score pour le moment.");
            let txt = "🏆 **CLASSEMENT GUILDE**\n```\n";
            rows.forEach(r => {
                const nom = (r.joueur_nom || "Inconnu").padEnd(15);
                const pts = (r.p || 0).toFixed(1);
                txt += `${nom} | ${pts} pts\n`;
            });
            m.reply(txt + "```");
        });
    }
});

botGestion.once('ready', () => {
    console.log(`🚀 BOT GESTION CONNECTÉ : ${botGestion.user.tag}`);
});

// --- 4. LOGIQUE BOT PERCO (Alerte) ---
botPerco.on('messageCreate', async (m) => {
    // Seul toi (ADMIN_ID) peux configurer le panneau
    if (m.content === '!setup-perco' && m.author.id === "1476632455669743666") {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('alerte_perco').setLabel('ALERTE PERCO').setStyle(ButtonStyle.Danger).setEmoji('🚨')
        );
        m.reply({ 
            content: "📌 **Panneau d'Alerte Perco**\nCliquez sur le bouton ci-dessous pour prévenir la guilde immédiatement.", 
            components: [row] 
        });
    }
});

botPerco.on('interactionCreate', async (i) => {
    if (!i.isButton()) return;
    
    if (i.customId === 'alerte_perco') {
        try {
            // Envoie l'alerte dans le salon actuel avec mention @everyone
            await i.channel.send(`🚨 **ALERTE PERCO !** @everyone GO DEF 🔥\nDéclenchée par <@${i.user.id}>`);
            // Réponse discrète à celui qui a cliqué
            await i.reply({ content: "✅ Alerte envoyée avec succès !", ephemeral: true });
        } catch (error) {
            console.error("Erreur lors de l'envoi de l'alerte:", error);
            await i.reply({ content: "❌ Erreur : Je n'ai pas la permission d'écrire ici.", ephemeral: true });
        }
    }
});

botPerco.once('ready', () => {
    console.log(`✅ BOT PERCO CONNECTÉ : ${botPerco.user.tag}`);
});

// --- 5. CONNEXION SÉCURISÉE DES DEUX BOTS ---
const startBots = async () => {
    console.log("Démarrage de la connexion...");

    // Connexion du bot GESTION
    if (process.env.tokenGestion) {
        botGestion.login(process.env.tokenGestion).catch(e => {
            console.error("❌ Erreur de Token pour GESTION (tokenGestion):", e.message);
        });
    } else {
        console.log("⚠️ Variable 'tokenGestion' manquante dans l'environnement.");
    }

    // Connexion du bot PERCO
    if (process.env.tokenPerco) {
        botPerco.login(process.env.tokenPerco).catch(e => {
            console.error("❌ Erreur de Token pour PERCO (tokenPerco):", e.message);
        });
    } else {
        console.log("⚠️ Variable 'tokenPerco' manquante dans l'environnement.");
    }
};

startBots();
