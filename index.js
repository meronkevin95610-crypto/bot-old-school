const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- 1. SÉCURITÉ ANTI-DOUBLON D'INSTANCE ---
// Si Render ou ton PC essaie de fermer l'ancien bot, on s'assure qu'il libère la DB
process.on('SIGTERM', () => {
    console.log("Fermeture propre de l'instance...");
    db.close();
    process.exit(0);
});

// --- CONFIGURATION ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V5.3.3 - Operationnel");
});

// Gestion d'erreur de port pour éviter le crash si doublon
server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.log('⚠️ Port occupé. Tentative de reconnexion...');
        setTimeout(() => {
            server.close();
            server.listen(process.env.PORT || 3000);
        }, 1000);
    }
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- BASE DE DONNÉES (Mode WAL pour éviter les blocages) ---
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;"); 
    db.run(`CREATE TABLE IF NOT EXISTS attaques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        joueur_id TEXT,
        joueur_nom TEXT,
        points REAL,
        issue TEXT,
        cote TEXT,
        nb_ennemis INTEGER,
        date TEXT,
        session_token TEXT UNIQUE
    )`);
});

const sessions = new Map();

// --- CALCULS ---
function calculerPoints(cote, issue, ennemis) {
    if (issue === "Défaite") return (cote === "Défense") ? 1.0 : 0.0; 
    if (ennemis === 0) return 0.25; 
    if (cote === "Attaque") return (ennemis === 4) ? 5.0 : 3.0;
    return (ennemis === 4) ? 4.0 : 2.0;
}

// --- LEADERBOARD SÉCURISÉ ---
async function getLeaderboard(limit = 15) {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, SUM(points) as p FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT ${limit}`;
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("Aucune donnée enregistrée.");
            let txt = "```\nNom            | Pts\n--------------------\n";
            rows.forEach(r => {
                txt += `${(r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14)} | ${(r.p || 0).toFixed(1)}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- LOGIQUE DU BOT ---
client.on('ready', () => {
    console.log(`🚀 Bot Perco V5.3.3 connecté | ${client.user.tag}`);
});

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!classement') {
        const board = await getLeaderboard(15);
        return m.reply(`🏆 **CLASSEMENT ACTUEL**\n${board}`);
    }

    if (m.content === '!resultat') {
        // Nettoyage de l'ancienne session si elle existe pour cet utilisateur
        sessions.delete(m.author.id);

        const token = `ST-${Date.now()}-${m.author.id}`;
        sessions.set(m.author.id, { 
            participants: [], 
            cote: null, 
            nb_ennemis: 4, 
            processing: false,
            token: token 
        });
        
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4)
        );
        await m.reply({ content: "⚔️ **Nouvelle saisie lancée.**", components: [menu] });
    }
});

client.on('interactionCreate', async (i) => {
    const s = sessions.get(i.user.id);
    if (!s) return;

    try {
        // Sélection des joueurs
        if (i.isUserSelectMenu()) {
            s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
            const r = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('cote').setPlaceholder('Attaque ou Défense ?')
                .addOptions([{ label: 'Attaque', value: 'att' }, { label: 'Défense', value: 'def' }])
            );
            return await i.update({ content: "✅ Joueurs enregistrés. 👉 **Côté ?**", components: [r] });
        }

        // Sélection Côté
