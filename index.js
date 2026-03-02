const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ARCHIVE_CHANNEL_ID = "1477765166467911765"; // ✅ ID Configuré pour le salon #classement

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
    res.end("Bot Guilde V5.1 - Stats & Meta Stuffs Actif");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
    const cols = ["joueur_id TEXT", "joueur_nom TEXT", "points REAL", "issue TEXT", "cote TEXT", "nb_allies INTEGER", "date TEXT"];
    cols.forEach(c => db.run(`ALTER TABLE attaques ADD COLUMN ${c}`, (err) => {}));
});

const sessions = new Map();

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

client.on('ready', () => console.log(`✅ Bot Opérationnel: ${client.user.tag}`));

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!stuff') {
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('s_classe').setPlaceholder('🛡️ Choisis ta classe...').addOptions(Object.keys(META_STUFFS).map(c => ({ label: c, value: c })))
        );
        return m.reply({ content: "🔎 **Répertoire Meta**", components: [row] });
    }

    if (m.content === '!classement') {
        const b = await getLeaderboard();
        return m.channel.send(b);
    }

    if (m.content === '!resultat' || m.content === '!resulta') {
        sessions.set(m.author.id, { participants: [], cote: null, issue: null, nb_allies: 4 });
        const menu = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4));
        return m.reply({ content: "⚔️ **Configuration du combat**", components: [menu] });
    }

    if (m.content === '!reset' && m.member.permissions.has(PermissionFlagsBits.Administrator)) {
        db.run(`DELETE FROM attaques`, () => m.reply("🔄 Classement remis à zéro."));
    }
});

client.on('interactionCreate', async (i) => {
    if (!i.isStringSelectMenu() && !i.isUserSelectMenu() && !i.isButton()) return;

    if (i.customId === 's_classe') {
        const classe = i.values[0];
        const builds = Object.keys(META_STUFFS[classe]);
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`s_res_${classe}`).setPlaceholder('✨ Quel mode ?').addOptions(builds.map(b => ({ label: b, value: b }))));
        return i.update({ content: `✅ Classe : **${classe}**`, components: [row] });
    }

    if (i.customId.startsWith('s_res_')) {
        const classe = i.customId.split('_')[2];
        const build = i.values[0];
        const data = META_STUFFS[classe][build];
        const e = new EmbedBuilder().setTitle(`🔥 META : ${classe} - ${build}`).setURL(data.link).setColor('#f39c12').addFields({ name: "📊 Stats", value: `\`${data.stats}\`` }, { name: "📝 Info", value: data.desc }, { name: "🔗 Lien", value: `[Ouvrir Dofusbook](${data.link})` }).setTimestamp();
        return i.update({ content: "✅ **Build trouvé !**", embeds: [e], components: [] });
    }

    const s = sessions.get(i.user.id);
    if (!s) return;

    if (i.isUserSelectMenu()) {
        s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
        const r = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('n').setPlaceholder('2. Format ?').addOptions([{ label: '4 alliés', value: '4', emoji: '👥' }, { label: '3 alliés (+0.75 pts)', value: '3', emoji: '🛡️' }, { label: '2 alliés (+0.75 pts)', value: '2', emoji: '⚔️' }]));
        return i.update({ content: `✅ Joueurs : **${s.participants.map(p => p.name).join(', ')}**\n👉 Combien d'alliés ?`, components: [r] });
    }

    if (i.isStringSelectMenu() && i.customId === 'n') {
        s.nb_allies = parseInt(i.values[0]);
        const r1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary));
        const r2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary));
        return i.update({ content: `✅ Format : **${s.nb_allies}v4**\n👉 Côté et Issue :`, components: [r1, r2] });
    }

    if (i.isButton()) {
        if (['att', 'def'].includes(i.customId)) s.cote = i.customId === 'att' ? "Attaque" : "Défense";
        if (['win', 'lose'].includes(i.customId)) s.issue = i.customId === 'win' ? "Victoire" : "Défaite";

        if (s.cote && s.issue) {
            let pts = (s.issue === "Victoire" ? 1.0 : 0.25) + (s.nb_allies < 4 ? 0.75 : 0);
            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_allies, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            s.participants.forEach(p => stmt.run(p.id, p.name, pts, s.issue, s.cote, s.nb_allies));
            stmt.finalize();

            const e = new EmbedBuilder().setTitle("🚨 Résultat Enregistré").setDescription(`${s.participants.map(p => `**${p.name}**`).join(', ')} : **${s.issue}** (${s.cote})`).setColor(s.issue === "Victoire" ? "#2ecc71" : "#e74c3c").addFields({ name: "🎖️ Points", value: `+${pts.toFixed(2)} pts`, inline: true }).setTimestamp();
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
