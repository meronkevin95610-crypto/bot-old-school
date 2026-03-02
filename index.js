const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V4.3.1 - Fixed Syntax");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT, joueur_id TEXT, joueur_nom TEXT, points REAL, issue TEXT, cote TEXT, nb_allies INTEGER, date TEXT)`);
});

const sessions = new Map();

async function getLeaderboard(limit = 15) {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc, 
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(CASE WHEN issue='Défaite' THEN 1 ELSE 0 END) as d, 
                       SUM(points) as p 
                       FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT ${limit}`;
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucune donnée enregistrée.");
            let txt = `🏆 **TOP ${limit} DE LA GUILDE** 🏆\n\`\`\`\nNom            | Cbt | V | D | Pts  | Ratio\n--------------------------------------------\n`;
            rows.forEach(r => {
                const ratio = r.tc > 0 ? ((r.v / r.tc) * 100).toFixed(0) + "%" : "0%";
                txt += `${(r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14)} | ${String(r.tc).padEnd(3)} | ${r.v} | ${r.d} | ${r.p.toFixed(2).padEnd(5)} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

client.on('ready', () => console.log(`✅ Bot Opérationnel: ${client.user.tag}`));

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!reset') {
        if (!m.member.permissions.has(PermissionFlagsBits.Administrator)) return m.reply("❌ Permission Administrateur requise.");
        const finalBoard = await getLeaderboard(50); 
        const archiveChannel = client.channels.cache.get(ID_SALON_ARCHIVE);
        if (archiveChannel) {
            await archiveChannel.send(`📦 **ARCHIVE FIN DE MOIS - ${new Date().toLocaleDateString('fr-FR')}**\n${finalBoard}`);
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

    if (i.isUserSelectMenu()) {
        s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
        const r = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('n').setPlaceholder('2. Format du combat ?').addOptions([
                { label: '4 alliés (Normal)', value: '4', emoji: '👥' },
                { label: '3 alliés (+0.75 pts)', value: '3', emoji: '🛡️' },
                { label: '2 alliés (+0.75 pts)', value: '2', emoji: '⚔️' }
            ])
        );
        await i.update({ 
            content: `✅ Joueurs : **${s.participants.map(p => p.name).join(', ')}**\n👉 Combien d'alliés étiez-vous ?`, 
            components: [r] 
        });
    }

    if (i.isStringSelectMenu()) {
        s.nb_allies = parseInt(i.values[0]);
        const r1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger).setEmoji('🔥'),
            new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary).setEmoji('🛡️')
        );
        const r2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success).setEmoji('🏆'),
            new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary).setEmoji('💀')
        );
        await i.update({ 
            content: `✅ Format : **${s.nb_allies}v4**\n👉 Choisissez le côté et l'issue :`, 
            components: [r1, r2] 
        });
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
                .setDescription(`${s.participants.map(p => `**${p.name}**`).join(', ')} vient de réaliser une **${s.issue}** en **${s.cote}** (${s.nb_allies}v4) !`)
                .setColor(s.issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                .addFields(
                    { name: "🎖️ Points", value: `+${pts.toFixed(2)} pts chacun`, inline: true },
                    { name: "👤 Saisi par", value: i.user.username, inline: true }
                )
                .setTimestamp();

            await i.update({ content: "✅ **Données synchronisées.**", components: [], embeds: [e] });
            const b = await getLeaderboard(15);
            await i.channel.send(b);
            sessions.delete(i.user.id);
        } else {
            await i.update({ 
                content: `✅ Participants : **${s.participants.map(p => p.name).join(', ')}**\n✅ Format : **${s.nb_allies}v4**\n👉 Sélection : **${s.cote || '?'}** | **${s.issue || '?'}**` 
            });
        }
    }
});

client.login(process.env.TOKEN);