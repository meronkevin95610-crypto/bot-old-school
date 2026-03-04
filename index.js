const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const http = require('http');
const sqlite3 = require('sqlite3').verbose();

// --- 1. SERVEUR DE MAINTIEN (Pour Render plus tard) ---
http.createServer((req, res) => {
    res.writeHead(200); res.end("Bots Dofus Connectés");
}).listen(process.env.PORT || 3000);

// --- 2. CONFIGURATION DES BOTS ---
const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent];
const botGestion = new Client({ intents });
const botPerco = new Client({ intents });

// Base de données pour les points
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT, joueur_nom TEXT, points REAL, date TEXT)`);
});

// --- 3. LOGIQUE BOT GESTION (Classement & Points) ---
botGestion.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    // Voir le classement (Ouvert à tous)
    if (m.content === '!top') {
        db.all(`SELECT joueur_nom, SUM(points) as p FROM attaques GROUP BY joueur_nom ORDER BY p DESC LIMIT 15`, (err, rows) => {
            if (err || !rows || rows.length === 0) return m.reply("🏆 Aucun score enregistré pour le moment.");
            let txt = "🏆 **CLASSEMENT DE LA GUILDE**\n```\n";
            rows.forEach(r => txt += `${(r.joueur_nom || "Inconnu").padEnd(15)} | ${(r.p || 0).toFixed(1)} pts\n`);
            m.reply(txt + "```");
        });
    }

    // Ajouter des points (UNIQUEMENT TOI)
    if (m.content.startsWith('!add')) {
        if (m.author.id !== "1364693403971092520") return; // Ton ID configuré
        
        const args = m.content.split(' ');
        const user = m.mentions.users.first();
        const pts = parseFloat(args[2]);

        if (!user || isNaN(pts)) return m.reply("❌ Usage: `!add @joueur 10` (Exemple)");

        db.run(`INSERT INTO attaques (joueur_nom, points, date) VALUES (?, ?, ?)`, [user.username, pts, new Date().toISOString()], (err) => {
            if (err) return m.reply("Erreur base de données.");
            m.reply(`✅ **${pts} points** ajoutés à **${user.username}** !`);
        });
    }
});

botGestion.once('ready', () => console.log(`🚀 BOT GESTION EN LIGNE : ${botGestion.user.tag}`));

// --- 4. LOGIQUE BOT PERCO (Alerte via Bouton) ---
botPerco.on('messageCreate', async (m) => {
    // Installer le bouton d'alerte (UNIQUEMENT TOI)
    if (m.content === '!setup-perco' && m.author.id === "1364693403971092520") {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('alerte_perco')
                .setLabel('ALERTE PERCO')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🚨')
        );
        
        m.reply({ 
            content: "📌 **Panneau d'Alerte de Guilde**\nCliquez sur le bouton pour lancer un appel à la défense.", 
            components: [row] 
        });
    }
});

botPerco.on('interactionCreate', async (i) => {
    if (!i.isButton()) return;
    if (i.customId === 'alerte_perco') {
        try {
            await i.channel.send(`🚨 **ALERTE PERCO !** @everyone GO DEF 🔥\nDéclenchée par <@${i.user.id}>`);
            await i.reply({ content: "✅ Alerte transmise !", ephemeral: true });
        } catch (e) {
            console.error("Erreur alerte:", e);
        }
    }
});

botPerco.once('ready', () => console.log(`✅ BOT PERCO EN LIGNE : ${botPerco.user.tag}`));

// --- 5. CONNEXION AVEC TES TOKENS ---
const G_TOKEN = "MTQ3NjYzMjQ1NTY2OTc0MzY2Ng.GnPfDz.n4YlJ2tSAWat-n8HS1vUBvv2uAx3TdUEFMlWqc";
const P_TOKEN = "MTQ3ODU1NDcxMTYwNTkwNzYzMA.GEUFhN.RBzrMxpQaXZmJVhxxYttgYaaB_ijn0QRPplC80";

botGestion.login(G_TOKEN).catch(e => console.error("Erreur GESTION:", e.message));
botPerco.login(P_TOKEN).catch(e => console.error("Erreur PERCO:", e.message));