const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V5.2.3 - Deployement Stable");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- SECURITE ANTI-CRASH ---
process.on('unhandledRejection', (reason) => console.error(' [ERREUR] Rejet :', reason));
process.on('uncaughtException', (err) => console.error(' [ERREUR] Exception :', err));

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
});

const sessions = new Map();

// --- LOGIQUE METIER (BARÈME V5.2) ---
function calculerPoints(cote, issue, ennemis) {
    if (issue === "Défaite") return (cote === "Défense") ? 1.0 : 0.0; 
    if (ennemis === 0) return 0.25; 
    if (cote === "Attaque") return (ennemis === 4) ? 5.0 : 3.0;
    return (ennemis === 4) ? 4.0 : 2.0;
}

async function getLeaderboard(limit = 15) {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc,
                       SUM(CASE WHEN cote='Attaque' THEN 1 ELSE 0 END) as n_atk,
                       SUM(CASE WHEN cote='Défense' THEN 1 ELSE 0 END) as n_def,
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(points) as p FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT ${limit}`;
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucune donnée.");
            let txt = `\`\`\`\nNom            | Pts   | Atk | Def | Ratio\n--------------------------------------------\n`;
            rows.forEach(r => {
                const ratio = r.tc > 0 ? ((r.v / r.tc) * 100).toFixed(0) + "%" : "0%";
                txt += `${(r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14)} | ${r.p.toFixed(2).padEnd(5)} | ${String(r.n_atk).padEnd(3)} | ${String(r.n_def).padEnd(3)} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- LOGIQUE DISCORD ---
client.on('ready', () => console.log(`🚀 Bot Perco V5.2 Ready | ${client.user.tag}`));

client.on('messageCreate', async (m) => {
    try {
        if (m.author.bot) return;

        if (m.content === '!classement') {
            const board = await getLeaderboard(15);
            return m.reply(`🏆 **CLASSEMENT DE LA GUILDE** 🏆\n${board}`);
        }

        if (m.content === '!resultat' || m.content === '!resulta') {
            sessions.set(m.author.id, { participants: [], cote: null, nb_ennemis: 4, processing: false });
            const menu = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4));
            await m.reply({ content: "⚔️ **Configuration du combat**", components: [menu] });
        }
    } catch (e) { console.error(e); }
});

client.on('interactionCreate', async (i) => {
    const s = sessions.get(i.user.id);
    if (!s) return;

    try {
        if (i.isUserSelectMenu() && i.customId === 'u') {
            s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
            const r = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('cote').setPlaceholder('2. Côté ?').addOptions([{label:'Attaque', value:'att'}, {label:'Défense', value:'def'}]));
            return await i.update({ content: "✅ Joueurs enregistrés.\n👉 **Quel côté ?**", components: [r] });
        }

        if (i.isStringSelectMenu()) {
            if (i.customId === 'cote') {
                s.cote = i.values[0] === 'att' ? "Attaque" : "Défense";
                const r = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ennemis').setPlaceholder('3. Adversaires ?').addOptions([{ label: '4 Adversaires', value: '4' }, { label: '1 à 3 Adversaires', value: '1' }, { label: '0 Adversaire (Malus)', value: '0' }]));
                return await i.update({ content: `Côté : **${s.cote}**\n👉 **Combien d'adversaires en face ?**`, components: [r] });
            }
            if (i.customId === 'ennemis') {
                s.nb_ennemis = parseInt(i.values[0]);
                const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Danger));
                return await i.update({ content: `Opposition : **${s.nb_ennemis} ennemis**\n👉 **Verdict ?**`, components: [r] });
            }
        }

        if (i.isButton()) {
            if (s.processing) return;
            const issue = i.customId === 'win' ? "Victoire" : "Défaite";
            s.processing = true;

            const pts = calculerPoints(s.cote, issue, s.nb_ennemis);
            
            db.serialize(() => {
                const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_ennemis, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
                s.participants.forEach(p => stmt.run(p.id, p.name, pts, issue, s.cote, s.nb_ennemis));
                stmt.finalize();
            });

            const board = await getLeaderboard(15);
            const e = new EmbedBuilder()
                .setTitle("🚨 Combat Enregistré")
                .setDescription(`${s.participants.map(p => `**${p.name}**`).join(', ')}\n**${issue}** en **${s.cote}** (${s.nb_ennemis} ennemis)\n🎖️ Gain : **+${pts.toFixed(2)} pts**`)
                .setColor(issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                .addFields({ name: "📊 CLASSEMENT ACTUALISÉ", value: board });

            await i.update({ content: "✅ **Statistiques mises à jour !**", components: [], embeds: [e] });
            sessions.delete(i.user.id);
        }
    } catch (err) { 
        console.error(err);
        sessions.delete(i.user.id);
    }
});

client.login(process.env.TOKEN);