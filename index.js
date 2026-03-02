const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ARCHIVE_CHANNEL_ID = "TON_ID_DE_SALON_ICI"; // ⚠️ REMPLACE PAR TON ID DE SALON ARCHIVE

const META_STUFFS = {
    "Cra": {
        "PvM - Multi Do Crit": { link: "https://www.dofusbook.net/fr/equipement/14958422-multi-do-crit/objets", stats: "11/6/6 - 200+ Do Crit", desc: "Le build ultime pour clean tous les donjons du jeu." },
        "PvP - Terre/Air": { link: "https://www.dofusbook.net/fr/equipement/15234102-terre-air-pvp/objets", stats: "12/6/6 - Gros dégâts/Retrait", desc: "Très fort pour harceler à distance." }
    },
    "Iop": {
        "PvM - Terre Bourrin": { link: "https://www.dofusbook.net/fr/equipement/14852301-iop-terre-pvm/objets", stats: "12/6/3 - 1500 Force", desc: "Optimisé pour maximiser les dégâts de la Colère." },
        "PvP - Feu Tumulte": { link: "https://www.dofusbook.net/fr/equipement/15100234-iop-feu-pvp/objets", stats: "12/6/6 - Full Intel", desc: "Excellent pour le clean de zone." }
    },
    "Ouginak": {
        "PvP - Eau (Proie)": { link: "https://www.dofusbook.net/fr/equipement/15340912-ougi-eau-pvp/objets", stats: "11/6/6 - Tank/Dégâts", desc: "Le mode le plus solide pour coller au corps à corps." }
    },
    "Steamer": {
        "PvP - Multi Do Crit": { link: "https://www.dofusbook.net/fr/equipement/15410923-steam-multi/objets", stats: "11/6/6 - Embuscade", desc: "Dégâts monstrueux à l'Embuscade." }
    }
};

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Guilde V5.0 - Stats & Meta Stuffs");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- BASE DE DONNÉES ---
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
    const cols = ["joueur_id TEXT", "joueur_nom TEXT", "points REAL", "issue TEXT", "cote TEXT", "nb_allies INTEGER", "date TEXT"];
    cols.forEach(c => db.run(`ALTER TABLE attaques ADD COLUMN ${c}`, (err) => {}));
});

const sessions = new Map();

// --- FONCTIONS ---
async function getLeaderboard(title = "CLASSEMENT DE LA GUILDE") {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc, SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, SUM(CASE WHEN issue='Défaite' THEN 1 ELSE 0 END) as d, SUM(points) as p FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT 15`;
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("Aucune donnée enregistrée.");
            let txt = `🏆 **${title}** 🏆\n\`\`\`\nNom            | Cbt | V | D | Pts  | Ratio\n--------------------------------------------\n`;
            rows.forEach(r => {
                const ratio = r.tc > 0 ? ((r.v / r.tc) * 100).toFixed(0) + "%" : "0%";
                txt += `${(r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14)} | ${String(r.tc).padEnd(3)} | ${r.v} | ${r.d} | ${r.p.toFixed(2).padEnd(5)} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

async function archiveAndReset() {
    try {
        const channel = await client.channels.fetch(ARCHIVE_CHANNEL_ID);
        if (channel) {
            const moisNom = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
            const leaderboardTxt = await getLeaderboard(`BILAN MENSUEL : ${moisNom.toUpperCase()}`);
            await channel.send("💾 **SAUVEGARDE AUTOMATIQUE DU MOIS**");
            await channel.send(leaderboardTxt);
            db.run(`DELETE FROM attaques`, () => channel.send("✨ **Classement réinitialisé pour le nouveau mois !**"));
        }
    } catch (e) { console.error(e); }
}

setInterval(() => {
    const now = new Date();
    if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 0) archiveAndReset();
}, 60000);

// --- ÉVÉNEMENTS MESSAGES ---
client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!stuff') {
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('s_classe')
                .setPlaceholder('🛡️ Choisis ta classe...')
                .addOptions(Object.keys(META_STUFFS).map(c => ({ label: c, value: c })))
        );
        return m.reply({ content: "🔎 **Répertoire Meta de la Guilde**", components: [row] });
    }

    if (m.content === '!classement') {
        const b = await getLeaderboard();
        return m.channel.send(b);
    }

    if (m.content === '!resultat' || m.content