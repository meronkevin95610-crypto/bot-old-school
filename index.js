const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ARCHIVE_CHANNEL_ID = "TON_ID_DE_SALON_ICI"; // ⚠️ METS L'ID DU SALON ICI

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V4.3 - Top 15 & Bonus 0.75 Actif");
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

// --- FONCTION CLASSEMENT (TOP 15) ---
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

// --- ARCHIVAGE ET RESET AUTOMATIQUE ---
async function archiveAndReset() {
    console.log("📦 Début de l'archivage mensuel...");
    try {
        const channel = await client.channels.fetch(ARCHIVE_CHANNEL_ID);
        if (channel) {
            const date = new Date();
            date.setMonth(date.getMonth() - 1);
            const moisNom = date.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
            
            const leaderboardTxt = await getLeaderboard(`BILAN MENSUEL : ${moisNom.toUpperCase()}`);
            await channel.send("💾 **SAUVEGARDE AUTOMATIQUE DU MOIS ÉCOULÉ**");
            await channel.send(leaderboardTxt);

            // RESET après envoi
            db.run(`DELETE FROM attaques`, (err) => {
                if (!err) {
                    channel.send("✨ **Le nouveau mois commence : le classement a été réinitialisé !**");
                    console.log("✅ Archive postée et classement vidé.");
                }
            });
        }
    } catch (e) { console.error("❌ Erreur archive:", e); }
}

// Vérification du 1er du mois
setInterval(() => {
    const now = new Date();
    if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 0) {
        archiveAndReset();
    }
}, 60000);

// --- ÉVÉNEMENTS ---
client.on('ready', () => console.log(`✅ Bot Opérationnel: ${client.user.tag}`));

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!reset') {
        if (!m.member.permissions.has(PermissionFlagsBits.Administrator)) return m.reply("❌ Permission Admin requise.");
        db.run(`DELETE FROM attaques`, () => m.reply("🔄 Classement remis à zéro."));
    }

    if (m.content === '!classement') {
        const b = await getLeaderboard();
        m.channel.send(b);
    }

    if (m.content === '!resultat' || m.content === '!resulta') {
        sessions.set(m.author.id, { participants: [], cote: null, issue: null, nb_allies: 4 });
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4)
        );
        await m.reply({ content: "⚔️ **Configuration du combat**", components: [menu] });
    }
});

client.on('interactionCreate', async (i) => {
    const s = sessions.get(i.user.id);
    if (!s) return;

    if (i.isUserSelectMenu()) {
        s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
        const r = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('n').setPlaceholder('2. Format ?').addOptions([
                { label: '4 alliés', value: '4', emoji: '👥' },
                { label: '3 alliés (+0.75 pts)', value: '3', emoji: '🛡️' },
                { label: '2 alliés (+0.75 pts)', value: '2', emoji: '⚔️' }
            ])
        );
        await i.update({ content: `✅ Joueurs : **${s.participants.map(p => p.name).join(', ')}**\n👉 Combien d'alliés ?`, components: [r] });
    }

    if (i.isStringSelectMenu()) {
        s.nb_allies = parseInt(i.values[0]);
        const r1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary)
        );
        const r2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
        );
        await i.update({ content: `✅ Format : **${s.nb_allies}v4**\n👉 Côté et Issue :`, components: [r1, r2] });
    }

    if (i.isButton()) {
        if (['att', 'def'].includes(i.customId)) s.cote = i.customId === 'att' ? "Attaque" : "Défense";
        if (['win', 'lose'].includes(i.customId)) s.issue = i.customId === 'win' ? "Victoire" : "Défaite";

        if (s.cote && s.issue) {
            // LOGIQUE DE POINTS MODIFIÉE ICI (Bonus +0.75 au lieu de +2.0)
            let pts = s.issue === "Victoire" ? 1.0 : 0.25;
            if (s.nb_allies < 4) pts += 0.75; 

            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_allies, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            s.participants.forEach(p => stmt.run(p.id, p.name, pts, s.issue, s.cote, s.nb_allies));
            stmt.finalize();

            const e = new EmbedBuilder()
                .setTitle("🚨 Résultat Enregistré")
                .setDescription(`${s.participants.map(p => `**${p.name}**`).join(', ')} : **${s.issue}** en **${s.cote}** (${s.nb_allies}v4)`)
                .setColor(s.issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                .addFields({ name: "🎖️ Points", value: `+${pts.toFixed(2)} pts`, inline: true }, { name: "👤 Saisi par", value: i.user.username, inline: true })
                .setTimestamp();

            await i.update({ content: "✅ **Stats enregistrées.**", components: [], embeds: [e] });
            const b = await getLeaderboard();
            await i.channel.send(b);
            sessions.delete(i.user.id);
        } else {
            await i.update({ content: `👉 Sélection : **${s.cote || '?'}** | **${s.issue || '?'}**` });
        }
    }
});

client.login(process.env.TOKEN);