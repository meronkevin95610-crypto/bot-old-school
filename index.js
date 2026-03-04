require('dotenv').config(); // <--- AJOUTÉ : Pour lire ton fichier .env
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const http = require('http');
const sqlite3 = require('sqlite3').verbose();

// --- SERVEUR POUR RENDER (Évite le mode veille) ---
http.createServer((req, res) => {
    res.writeHead(200); 
    res.end("Bots Online");
}).listen(process.env.PORT || 3000, () => {
    console.log(`📡 Serveur de monitoring actif sur le port ${process.env.PORT || 3000}`);
});

// --- CONFIGURATION DES BOTS ---
const intents = [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
];

const botGestion = new Client({ intents });
const botPerco = new Client({ intents });

// --- BASE DE DONNÉES (Stats Percepteur) ---
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS attaques (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        joueur_nom TEXT, 
        points REAL, 
        date TEXT
    )`);
});

const MON_ID = "1364693403971092520";

// --- LOGIQUE BOT GESTION (Classement & Points) ---
botGestion.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    // Commande !top
    if (m.content === '!top') {
        db.all(`SELECT joueur_nom, SUM(points) as p FROM attaques GROUP BY joueur_nom ORDER BY p DESC LIMIT 15`, (err, rows) => {
            if (err || !rows || rows.length === 0) return m.reply("🏆 Aucun score enregistré pour le moment.");
            
            let txt = "🏆 **CLASSEMENT DES DÉFENSEURS**\n```\n";
            rows.forEach(r => {
                const nom = (r.joueur_nom || "???").padEnd(15);
                const pts = (r.p || 0).toFixed(1);
                txt += `${nom} | ${pts} pts\n`;
            });
            m.reply(txt + "```");
        });
    }

    // Commande !add @joueur points
    if (m.content.startsWith('!add')) {
        if (m.author.id !== MON_ID) return m.reply("❌ Tu n'as pas la permission.");
        
        const args = m.content.split(' ');
        const user = m.mentions.users.first();
        const pts = parseFloat(args[2]);

        if (!user || isNaN(pts)) return m.reply("⚠️ Usage: `!add @joueur 10`.");

        db.run(`INSERT INTO attaques (joueur_nom, points, date) VALUES (?, ?, ?)`, 
            [user.username, pts, new Date().toISOString()], 
            (err) => {
                if (err) return console.error(err.message);
                m.reply(`✅ **${pts} pts** ajoutés à **${user.username}** !`);
            }
        );
    }
});

// --- LOGIQUE BOT PERCO (Bouton d'alerte) ---
botPerco.on('messageCreate', async (m) => {
    if (m.content === '!setup-perco' && m.author.id === MON_ID) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('alerte_perco')
                .setLabel('ALERTE PERCO')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🚨')
        );
        m.reply({ content: "📌 **Panneau d'Alerte Percepteur**\nCliquez sur le bouton pour prévenir la guilde !", components: [row] });
    }
});

botPerco.on('interactionCreate', async (i) => {
    if (!i.isButton()) return;

    if (i.customId === 'alerte_perco') {
        try {
            // Envoi de l'alerte publique
            await i.channel.send(`🚨 **ALERTE PERCO !** @everyone GO DEF 🔥\nSignalé par : <@${i.user.id}>`);
            
            // Réponse confirmée uniquement à celui qui a cliqué
            await i.reply({ content: "L'alerte a été envoyée avec succès !", ephemeral: true });
        } catch (e) { 
            console.error("Erreur lors de l'alerte :", e); 
        }
    }
});

// --- DÉMARRAGE ---
botGestion.once('ready', () => console.log(`🚀 [BOT GESTION] Connecté en tant que ${botGestion.user.tag}`));
botPerco.once('ready', () => console.log(`✅ [BOT PERCO] Connecté en tant que ${botPerco.user.tag}`));

// Lancement avec les tokens du fichier .env
botGestion.login(process.env.tokenGestion).catch(err => console.error("Erreur Login Gestion:", err));
botPerco.login(process.env.tokenPerco).catch(err => console.error("Erreur Login Perco:", err));