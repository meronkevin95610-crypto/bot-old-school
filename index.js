const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V4.4 - Full Display Fix");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- BASE DE DONNÉES (BLINDÉE) ---
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
    
    // Ajout forcé des colonnes si elles manquent
    const columns = [
        "joueur_id TEXT", "joueur_nom TEXT", "points REAL", 
        "issue TEXT", "cote TEXT", "nb_allies INTEGER", "date TEXT"
    ];
    columns.forEach(col => {
        db.run(`ALTER TABLE attaques ADD COLUMN ${col}`, (err) => { /* Ignore si existe déjà */ });
    });
});

const sessions = new Map();

// --- FONCTION CLASSEMENT (TOP 15) ---
async function getLeaderboard(limit = 15) {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc, 
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(CASE WHEN issue='Défaite' THEN 1 ELSE 0 END) as d, 
                       SUM(points) as p 
                       FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT ${limit}`;
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error("Erreur SQL:", err);
                return resolve("❌ Erreur lors de la lecture de la base de données.");
            }
            if (!rows || rows.length === 0) return resolve("⚠️ Aucune donnée enregistrée pour le moment.");
            
            let txt = `🏆 **TOP ${limit} DE LA GUILDE** 🏆\n\`\`\`\nNom            | Cbt | V | D | Pts  | Ratio\n--------------------------------------------\n`;
            rows.forEach(r => {
                const ratio = r.tc > 0 ? ((r.v / r.tc) * 100).toFixed(0) + "%" : "0%";
                const nom = (r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14);
                const pts = (r.p || 0).toFixed(2).padEnd(5);
                txt += `${nom} | ${String(r.tc).padEnd(3)} | ${r.v} | ${r.d} | ${pts} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

client.on('ready', () => console.log(`✅ Bot en ligne: ${client.user.tag}`));

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!reset') {
        if (!m.member.permissions.has(PermissionFlagsBits.Administrator)) return m.reply("❌ Admin requis.");
        const finalBoard = await getLeaderboard(50); 
        const archiveChannel = client.channels.cache.get(ID_SALON_ARCHIVE);
        if (archiveChannel) {
            await archiveChannel.send(`📦 **ARCHIVE FIN DE MOIS**\n${finalBoard}`);
        }
        db.run(`DELETE FROM attaques`, () => m.reply("🔄 Classement archivé et remis à zéro."));
    }

    if (m.content === '!classement') {
        const b = await getLeaderboard(15);
        return m.reply(b);
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

    if (i.isUserSelectMenu() && i.customId === 'u') {
        s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
        const r = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('n').setPlaceholder('2. Format du combat ?').addOptions([
                { label: '4 alliés (Normal)', value: '4', emoji: '👥' },
                { label: '3 alliés (+0.75 pts)', value: '3', emoji: '🛡️' },
                { label: '2 alliés (+0.75 pts)', value: '2', emoji: '⚔️' }
            ])
        );
        return i.update({ content: `✅ Joueurs sélectionnés.\n👉 **Quel était le format ?**`, components: [r] });
    }

    if (i.isStringSelectMenu() && i.customId === 'n') {
        s.nb_allies = parseInt(i.values[0]);
        const r1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary)
        );
        const r2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
        );
        return i.update({ content: `✅ Format : **${s.nb_allies}v4**\n👉 **Côté et Résultat ?**`, components: [r1, r2] });
    }

    if (i.isButton()) {
        if (['att', 'def'].includes(i.customId)) s.cote = i.customId === 'att' ? "Attaque" : "Défense";
        if (['win', 'lose'].includes(i.customId)) s.issue = i.customId === 'win' ? "Victoire" : "Défaite";

        if (s.cote && s.issue) {
            let pts = s.issue === "Victoire" ? 1.0 : 0.25;
            if (s.nb_allies < 4) pts += 0.75; 

            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_allies, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            s.participants.forEach(p => stmt.run(p.id, p.name, pts, s.issue, s.cote, s.nb_allies));
            stmt.finalize();

            const e = new EmbedBuilder()
                .setTitle("🚨 Résultat Enregistré")
                .setDescription(`${s.participants.map(p => `**${p.name}**`).join(', ')} : **${s.issue}** en **${s.cote}** !`)
                .setColor(s.issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                .addFields({ name: "🎖️ Points", value: `+${pts.toFixed(2)} chacun` })
                .setTimestamp();

            await i.update({ content: "✅ **Stats synchronisées.**", components: [], embeds: [e] });
            
            const b = await getLeaderboard(15);
            await i.channel.send(b);
            sessions.delete(i.user.id);
        } else {
            await i.update({ content: `👉 Sélection : **${s.cote || '?'}** | **${s.issue || '?'}**` });
        }
    }
});

client.login(process.env.TOKEN);