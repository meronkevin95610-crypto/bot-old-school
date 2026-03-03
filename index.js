const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V5.2.1 - Operationnel");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- BASE DE DONNÉES ---
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");
    // Création de la table unique
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

// --- FONCTION CLASSEMENT ---
async function getLeaderboard(limit = 15) {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, 
                       COUNT(*) as tc,
                       SUM(CASE WHEN cote='Attaque' THEN 1 ELSE 0 END) as n_atk,
                       SUM(CASE WHEN cote='Défense' THEN 1 ELSE 0 END) as n_def,
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(points) as p 
                       FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT ${limit}`;
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucune donnée enregistrée.");
            let txt = `🏆 **CLASSEMENT GUILDE (V5.2)** 🏆\n\`\`\`\nNom            | Pts   | Atk | Def | Ratio\n--------------------------------------------\n`;
            rows.forEach(r => {
                const ratio = r.tc > 0 ? ((r.v / r.tc) * 100).toFixed(0) + "%" : "0%";
                txt += `${(r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14)} | ${r.p.toFixed(2).padEnd(5)} | ${String(r.n_atk).padEnd(3)} | ${String(r.n_def).padEnd(3)} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- LOGIQUE DE CALCUL DES POINTS ---
function calculerPoints(cote, issue, ennemis) {
    if (issue === "Défaite") {
        return (cote === "Défense") ? 1.0 : 0.0; 
    }
    if (ennemis === 0) return 0.25; 
    if (cote === "Attaque") {
        return (ennemis === 4) ? 5.0 : 3.0;
    } else {
        return (ennemis === 4) ? 4.0 : 2.0;
    }
}

client.on('ready', () => console.log(`✅ Bot connecté: ${client.user.tag}`));

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    // --- COMMANDES ---
    if (m.content === '!classement') {
        const b = await getLeaderboard(15);
        return m.reply(b);
    }

    if (m.content === '!resultat' || m.content === '!resulta') {
        sessions.set(m.author.id, { participants: [], cote: null, nb_ennemis: 4, processing: false });
        const menu = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4));
        await m.reply({ content: "⚔️ **Nouveau Combat**", components: [menu] });
    }

    if (m.content.startsWith('!correct')) {
        if (!m.member.permissions.has(PermissionFlagsBits.Administrator)) return m.reply("❌ Admin uniquement.");
        const user = m.mentions.users.first();
        if (!user) return m.reply("⚠️ Mentionne un joueur !");
        const text = m.content.replace(/<@!?\d+>/, '').toLowerCase();
        const pointMatch = text.match(/-?\d+(\.\d+)?/);
        const pts = pointMatch ? parseFloat(pointMatch[0]) : null;
        let issue = text.includes("victoire") || text.includes("win") ? "Victoire" : "Défaite";
        
        if (pts === null) return m.reply("⚠️ Usage: `!correct @joueur [points] [Victoire/Défaite]`");
        db.run(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, date) VALUES (?, ?, ?, ?, datetime('now'))`, 
        [user.id, user.username, pts, issue], () => m.reply(`✅ Correction pour **${user.username}** effectuée.`));
    }
});

client.on('interactionCreate', async (i) => {
    const s = sessions.get(i.user.id);
    if (!s) return;

    try {
        // Étape 1 : Joueurs
        if (i.isUserSelectMenu() && i.customId === 'u') {
            s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
            const r = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('cote').setPlaceholder('2. Côté ?').addOptions([{label:'Attaque', value:'att'}, {label:'Défense', value:'def'}]));
            return await i.update({ content: "✅ Joueurs sélectionnés.\n👉 **Côté du combat ?**", components: [r] });
        }

        if (i.isStringSelectMenu()) {
            // Étape 2 : Côté
            if (i.customId === 'cote') {
                s.cote = i.values[0] === 'att' ? "Attaque" : "Défense";
                const r = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ennemis').setPlaceholder('3. Ennemis ?').addOptions([
                    { label: '4 Adversaires', value: '4' },
                    { label: '1 à 3 Adversaires', value: '1' },
                    { label: '0 Adversaire (Malus)', value: '0' }
                ]));
                return await i.update({ content: `Côté : **${s.cote}**\n👉 **Combien d'adversaires ?**`, components: [r] });
            }

            // Étape 3 : Opposition
            if (i.customId === 'ennemis') {
                s.nb_ennemis = parseInt(i.values[0]);
                const r = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Danger)
                );
                return await i.update({ content: `Opposition : **${s.nb_ennemis} ennemis**\n👉 **Résultat ?**`, components: [r] });
            }
        }

        // Étape Finale : Bouton Win/Lose
        if (i.isButton()) {
            if (s.processing) return;
            const issue = i.customId === 'win' ? "Victoire" : "Défaite";
            s.processing = true;

            const pts = calculerPoints(s.cote, issue, s.nb_ennemis);
            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_ennemis, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            s.participants.forEach(p => stmt.run(p.id, p.name, pts, issue, s.cote, s.nb_ennemis));
            stmt.finalize();

            const e = new EmbedBuilder()
                .setTitle("🚨 Résultat Enregistré")
                .setDescription(`${s.participants.map(p => `**${p.name}**`).join(', ')}\n**${issue}** en **${s.cote}** (${s.nb_ennemis} ennemis)`)
                .setColor(issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                .addFields({ name: "🎖️ Points", value: `+${pts.toFixed(2)} chacun` });

            await i.update({ content: "✅ **Stats mises à jour.**", components: [], embeds: [e] });
            const b = await getLeaderboard(15);
            await i.channel.send(b);
            sessions.delete(i.user.id);
        }
    } catch (err) { 
        console.error(err);
        sessions.delete(i.user.id);
    }
});

client.login(process.env.TOKEN);