const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 1. SERVEUR POUR RENDER (Maintien en ligne)
http.createServer((req, res) => {
    res.writeHead(200); 
    res.end("Bots Dofus Online - Connectés");
}).listen(process.env.PORT || 3000);

// 2. CONFIGURATION DES BOTS
const intents = [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
];

const botGestion = new Client({ intents });
const botPerco = new Client({ intents });

// 3. BASE DE DONNÉES (Configuration pour le DISK Render)
// On utilise /data/ si on est sur Render, sinon le dossier local
const dbPath = process.env.RENDER ? '/data/stats.db' : './stats.db';
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT, joueur_nom TEXT, points REAL, date TEXT)`);
});

const MON_ID = "1364693403971092520";

// 4. LOGIQUE BOT GESTION
botGestion.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!top') {
        db.all(`SELECT joueur_nom, SUM(points) as p FROM attaques GROUP BY joueur_nom ORDER BY p DESC LIMIT 15`, (err, rows) => {
            if (err || !rows || rows.length === 0) return m.reply("🏆 Aucun score.");
            let txt = "🏆 **CLASSEMENT**\n```\n";
            rows.forEach(r => txt += `${(r.joueur_nom || "???").padEnd(15)} | ${(r.p || 0).toFixed(1)} pts\n`);
            m.reply(txt + "```");
        });
    }

    if (m.content.startsWith('!add')) {
        if (m.author.id !== MON_ID) return;
        const args = m.content.split(' ');
        const user = m.mentions.users.first();
        const pts = parseFloat(args[2]);
        if (!user || isNaN(pts)) return m.reply("Usage: `!add @joueur 10`.");
        db.run(`INSERT INTO attaques (joueur_nom, points, date) VALUES (?, ?, ?)`, [user.username, pts, new Date().toISOString()], () => {
            m.reply(`✅ **${pts} pts** ajoutés à **${user.username}** !`);
        });
    }
});

// 5. LOGIQUE BOT PERCO
botPerco.on('messageCreate', async (m) => {
    if (m.content === '!setup-perco' && m.author.id === MON_ID) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('alerte_perco').setLabel('ALERTE PERCO').setStyle(ButtonStyle.Danger).setEmoji('🚨')
        );
        m.reply({ content: "📌 **Panneau d'Alerte**", components: [row] });
    }
});

botPerco.on('interactionCreate', async (i) => {
    if (!i.isButton()) return;
    if (i.customId === 'alerte_perco') {
        try {
            await i.channel.send(`🚨 **ALERTE PERCO !** @everyone GO DEF 🔥\nPar <@${i.user.id}>`);
            await i.reply({ content: "Envoyé !", ephemeral: true });
        } catch (e) {
            console.error("Erreur alerte:", e);
        }
    }
});

botGestion.once('ready', () => console.log("🚀 GESTION OK"));
botPerco.once('ready', () => console.log("✅ PERCO OK"));

// 6. CONNEXION SÉCURISÉE
botGestion.login(process.env.tokenGestion).catch(e => console.error("Erreur GESTION:", e.message));
botPerco.login(process.env.tokenPerco).catch(e => console.error("Erreur PERCO:", e.message));
