const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 

// Serveur HTTP pour Render (V5.2.7)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V5.2.7 - Operationnel");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- SECURITE ---
process.on('unhandledRejection', (reason) => console.error(' [ERREUR] Rejet non géré :', reason));
process.on('uncaughtException', (err) => console.error(' [ERREUR] Exception non capturée :', err));

// --- BASE DE DONNÉES ---
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
        date TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS config (cle TEXT PRIMARY KEY, valeur TEXT)`);
});

const sessions = new Map();

// --- LOGIQUE CALCUL ---
function calculerPoints(cote, issue, ennemis) {
    if (issue === "Défaite") return (cote === "Défense") ? 1.0 : 0.0; 
    if (ennemis === 0) return 0.25; 
    if (cote === "Attaque") return (ennemis === 4) ? 5.0 : 3.0;
    return (ennemis === 4) ? 4.0 : 2.0;
}

// --- GENERATION DU CLASSEMENT ---
async function getLeaderboard(limit = 15) {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc,
                       SUM(CASE WHEN cote='Attaque' THEN 1 ELSE 0 END) as n_atk,
                       SUM(CASE WHEN cote='Défense' THEN 1 ELSE 0 END) as n_def,
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(points) as p FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT ${limit}`;
        
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucune donnée enregistrée.");
            let txt = `\`\`\`\nNom            | Pts   | Atk | Def | Ratio\n--------------------------------------------\n`;
            rows.forEach(r => {
                const ratio = r.tc > 0 ? Math.round((r.v / r.tc) * 100) + "%" : "0%";
                const nom = (r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14);
                const pts = (r.p || 0).toFixed(2).padEnd(5);
                const atk = String(r.n_atk).padEnd(3);
                const def = String(r.n_def).padEnd(3);
                txt += `${nom} | ${pts} | ${atk} | ${def} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- RESET & ARCHIVAGE ---
async function executerResetMensuel(trigger = null) {
    const channel = await client.channels.fetch(ID_SALON_ARCHIVE).catch(() => null);
    const board = await getLeaderboard(20);

    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle(`🏆 ARCHIVES DES STATISTIQUES`)
            .setDescription(board)
            .setColor("#f1c40f")
            .setTimestamp();
        await channel.send({ content: "🏁 **Réinitialisation du mois effectuée.**", embeds: [embed] });
    }

    db.run("DELETE FROM attaques;");
    if (trigger && trigger.reply) trigger.reply("✅ Reset et archivage terminés.");
}

async function checkMonthlyReset() {
    const mtn = new Date();
    const moisActuel = `${mtn.getFullYear()}-${mtn.getMonth() + 1}`;
    db.get("SELECT valeur FROM config WHERE cle = 'dernier_reset'", async (err, row) => {
        if (!row || row.valeur !== moisActuel) {
            if (row) await executerResetMensuel();
            db.run("INSERT OR REPLACE INTO config (cle, valeur) VALUES ('dernier_reset', ?)", [moisActuel]);
        }
    });
}

// --- GESTION MESSAGES ---
client.on('ready', () => {
    console.log(`🚀 Bot Perco V5.2.7 prêt | ${client.user.tag}`);
    checkMonthlyReset();
    setInterval(checkMonthlyReset, 3600000);
});

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!forcereset' && m.member.permissions.has('Administrator')) {
        return await executerResetMensuel(m);
    }

    if (m.content === '!classement') {
        const board = await getLeaderboard(15);
        return m.reply(`🏆 **CLASSEMENT ACTUEL** 🏆\n${board}`);
    }

    if (m.content === '!resultat' || m.content === '!resulta') {
        sessions.set(m.author.id, { participants: [], cote: null, nb_ennemis