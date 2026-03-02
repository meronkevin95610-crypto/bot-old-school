const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- 1. SERVEUR ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Guilde V6.4 - Fix Leaderboard Display");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- 2. BASE DE DONNÉES ---
const db = new sqlite3.Database('./stats.db');
const CLASSES_DOFUS = ["Cra", "Ecaflip", "Eliotrope", "Eniripsa", "Enutrof", "Feca", "Iop", "Osamodas", "Pandawa", "Sacrieur", "Sadida", "Sram", "Steamer", "Xelor", "Zobal"];

db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT, joueur_id TEXT, joueur_nom TEXT, points REAL, issue TEXT, cote TEXT, nb_allies INTEGER, date TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS metapano (id INTEGER PRIMARY KEY AUTOINCREMENT, auteur TEXT, classe TEXT, element TEXT, description TEXT, lien TEXT)`);
});

const sessions = new Map();

// --- 3. FONCTION CLASSEMENT ---
async function getFullLeaderboard() {
    return new Promise((resolve, reject) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc, 
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(CASE WHEN issue='Défaite' THEN 1 ELSE 0 END) as d, 
                       SUM(points) as p 
                       FROM attaques GROUP BY joueur_id ORDER BY p DESC`;
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error("Erreur SQL Classement:", err);
                return reject(err);
            }
            if (!rows || rows.length === 0) return resolve("⚠️ Aucune donnée enregistrée.");
            
            let txt = "🏆 **CLASSEMENT GÉNÉRAL** 🏆\n```\nNom            | Cbt | V | D | Pts  | Ratio\n--------------------------------------------\n";
            rows.forEach(r => {
                const ratio = r.tc > 0 ? ((r.v / r.tc) * 100).toFixed(0) + "%" : "0%";
                const nom = (r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14);
                txt += `${nom} | ${String(r.tc).padEnd(3)} | ${r.v} | ${r.d} | ${r.p.toFixed(2).padEnd(5)} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- 4. COMMANDES ---
client.on('messageCreate', async (m) => {
    if (m.author.bot) return;
    if (m.content === '!classement') {
        const board = await getFullLeaderboard();
        return m.reply(board);
    }
    if (m.content === '!resultat') {
        sessions.set(m.author.id, { participants: [] });
        const menu = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('sel_u').setPlaceholder('👥 Qui a participé ?').setMinValues(1).setMaxValues(4));
        return m.reply({ content: "⚔️ **Saisie de combat**", components: [menu] });
    }
});

// --- 5. INTERACTIONS ---
client.on('interactionCreate', async (i) => {
    try {
        const userId = i.user.id;

        if (i.customId === 'sel_u') {
            let s = sessions.get(userId);
            if(!s) return i.reply({ content: "Session expirée.", ephemeral: true });
            s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
            const r = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('sel_f').setPlaceholder('2. Format ?').addOptions([{ label: '4 alliés', value: '4' }, { label: '3 alliés (+0.75)', value: '3' }, { label: '2 alliés (+0.75)', value: '2' }]));
            return i.update({ content: `👉 **Format du combat ?**`, components: [r] });
        }

        if (i.customId === 'sel_f') {
            let s = sessions.get(userId);
            if(!s) return;
            s.nb_allies = parseInt(i.values[0]);
            const r1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary));
            const r2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary));
            return i.update({ content: `👉 **Côté et Issue ?**`, components: [r1, r2] });
        }

        if (['att', 'def', 'win', 'lose'].includes(i.customId)) {
            let s = sessions.get(userId);
            if (!s) return;
            if (['att', 'def'].includes(i.customId)) s.cote = i.customId === 'att' ? "Attaque" : "Défense";
            if (['win', 'lose'].includes(i.customId)) s.issue = i.customId === 'win' ? "Victoire" : "Défaite";

            if (s.cote && s.issue) {
                // Étape 1: On répond tout de suite pour libérer l'interaction Discord
                await i.update({ content: "⏳ Traitement des données en cours...", components: [] });
                
                let pts = (s.issue === "Victoire" ? 1.0 : 0.25) + (s.nb_allies < 4 ? 0.75 : 0);
                
                // Étape 2: Insertion en base de données
                const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_allies, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
                s.participants.forEach(p => stmt.run(p.id, p.name, pts, s.issue, s.cote, s.nb_allies));
                stmt.finalize();
                
                sessions.delete(userId);

                // Étape 3: Récupération du classement et mise à jour finale
                const board = await getFullLeaderboard();
                return i.editReply({ content: `✅ Combat enregistré avec succès !`, embeds: [new EmbedBuilder().setDescription(board).setColor('#2ecc71')] });
            } else {
                return i.update({ content: `👉 Sélection actuelle : **${s.cote || '?'}** | **${s.issue || '?'}**` });
            }
        }
    } catch (error) {
        console.error("Erreur interaction:", error);
    }
});

client.login(process.env.TOKEN);