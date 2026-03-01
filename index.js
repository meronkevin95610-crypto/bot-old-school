const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V3.6.1 Stable");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
    const cols = ["joueur_id TEXT", "joueur_nom TEXT", "points REAL", "issue TEXT", "cote TEXT", "nb_allies INTEGER", "date TEXT"];
    cols.forEach(c => db.run(`ALTER TABLE attaques ADD COLUMN ${c}`, (err) => {}));
});

const sessions = new Map();

async function getLeaderboard() {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc, SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, SUM(CASE WHEN issue='Défaite' THEN 1 ELSE 0 END) as d, SUM(points) as p FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT 10`;
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("Aucune donnée.");
            let txt = "🏆 **CLASSEMENT** 🏆\n```\nNom            | Cbt | V | D | Pts  | %\n------------------------------------------\n";
            rows.forEach(r => {
                const ratio = r.tc > 0 ? ((r.v / r.tc) * 100).toFixed(0) + "%" : "0%";
                txt += `${(r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14)} | ${String(r.tc).padEnd(3)} | ${r.v} | ${r.d} | ${r.p.toFixed(1).padEnd(4)} | ${ratio}\n`;
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
        if (!m.member.permissions.has(PermissionFlagsBits.Administrator)) return m.reply("❌ Admin requis.");
        db.run(`DELETE FROM attaques`, () => m.reply("🔄 Reset terminé."));
    }
    if (m.content === '!classement') {
        const b = await getLeaderboard();
        m.channel.send(b);
    }
    if (m.content === '!resultat' || m.content === '!resulta') {
        sessions.set(m.author.id, { participants: [], cote: null, issue: null, nb_allies: 4 });
        const menu = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('Joueurs ?').setMinValues(1).setMaxValues(4));
        await m.reply({ content: "⚔️ Sélectionnez les joueurs :", components: [menu] });
    }
});

client.on('interactionCreate', async (i) => {
    const s = sessions.get(i.user.id);
    if (!s) return;
    if (i.isUserSelectMenu()) {
        s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
        const r = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('n').setPlaceholder('Alliés ?').addOptions([{label:'4',value:'4'},{label:'3 (+2pts)',value:'3'},{label:'2 (+2pts)',value:'2'}]));
        await i.update({ content: "Combien d'alliés ?", components: [r] });
    }
    if (i.isStringSelectMenu()) {
        s.nb_allies = parseInt(i.values[0]);
        const r1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary));
        const r2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary));
        await i.update({ content: "Détails du combat :", components: [r1, r2] });
    }
    if (i.isButton()) {
        if (['att', 'def'].includes(i.customId)) s.cote = i.customId === 'att' ? "Attaque" : "Défense";
        if (['win', 'lose'].includes(i.customId)) s.issue = i.customId === 'win' ? "Victoire" : "Défaite";
        if (s.cote && s.issue) {
            let pts = s.issue === "Victoire" ? 1.0 : 0.25;
            if (s.nb_allies < 4) pts += 2.0;
            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_allies, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            s.participants.forEach(p => stmt.run(p.id, p.name, pts, s.issue, s.cote, s.nb_allies));
            stmt.finalize();
            const names = s.participants.map(p => `**${p.name}**`).join(', ');
            const e = new EmbedBuilder().setTitle("🚨 Enregistré").setDescription(`${names} : ${s.issue} en ${s.cote} (${s.nb_allies}v4)`).setColor(s.issue === "Victoire" ? "Green" : "Red");
            await i.update({ content: "✅ Terminé !", components: [], embeds: [e] });
            const b = await getLeaderboard();
            await i.channel.send(b);
            sessions.delete(i.user.id);
        } else {
            await i.update({ content: `Sélection : ${s.cote || '?'} | ${s.issue || '?'}` });
        }
    }
});

client.login(process.env.TOKEN);