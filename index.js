const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- 1. SÉCURITÉ ANTI-DOUBLON D'INSTANCE ---
process.on('SIGTERM', () => {
    console.log("Fermeture propre de l'instance...");
    db.close();
    process.exit(0);
});

// --- 2. CONFIGURATION & SERVEUR ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V5.3.4 - Operationnel");
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.log('⚠️ Port occupé. Tentative de reconnexion...');
        setTimeout(() => {
            server.close();
            server.listen(process.env.PORT || 3000);
        }, 1000);
    }
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- 3. BASE DE DONNÉES (MODE WAL) ---
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
        date TEXT,
        session_token TEXT UNIQUE
    )`);
});

const sessions = new Map();

// --- 4. LOGIQUE DE CALCUL ---
function calculerPoints(cote, issue, ennemis) {
    if (issue === "Défaite") return (cote === "Défense") ? 1.0 : 0.0; 
    if (ennemis === 0) return 0.25; 
    if (cote === "Attaque") return (ennemis === 4) ? 5.0 : 3.0;
    return (ennemis === 4) ? 4.0 : 2.0;
}

// --- 5. LEADERBOARD TOP 15 ---
async function getLeaderboard(limit = 15) {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc,
                       SUM(CASE WHEN cote='Attaque' THEN 1 ELSE 0 END) as n_atk,
                       SUM(CASE WHEN cote='Défense' THEN 1 ELSE 0 END) as n_def,
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(points) as p FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT ${limit}`;
        
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucune donnée enregistrée.");
            let txt = "```\nNom            | Pts   | Atk | Def | %\n---------------------------------------\n";
            rows.forEach(r => {
                const ratio = r.tc > 0 ? Math.round((r.v / r.tc) * 100) + "%" : "0%";
                const nom = (r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14);
                const pts = (r.p || 0).toFixed(1).padEnd(5);
                const atk = String(r.n_atk).padEnd(3);
                const def = String(r.n_def).padEnd(3);
                txt += `${nom} | ${pts} | ${atk} | ${def} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- 6. ÉVÉNEMENTS ---
client.on('ready', () => {
    console.log(`🚀 Bot Perco V5.3.4 prêt | ${client.user.tag}`);
});

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!classement') {
        const board = await getLeaderboard(15);
        return m.reply(`🏆 **CLASSEMENT ACTUEL**\n${board}`);
    }

    if (m.content === '!resultat' || m.content === '!resulta') {
        const token = `ST-${Date.now()}-${m.author.id}`;
        sessions.set(m.author.id, { 
            participants: [], cote: null, nb_ennemis: 4, processing: false, token: token 
        });
        
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4)
        );
        await m.reply({ content: "⚔️ **Configuration du combat**", components: [menu] });
    }
});

client.on('interactionCreate', async (i) => {
    const s = sessions.get(i.user.id);
    if (!s) return;

    try {
        if (i.isUserSelectMenu() && i.customId === 'u') {
            s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
            const r = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('cote').setPlaceholder('2. Côté ?')
                .addOptions([{ label: 'Attaque', value: 'att' }, { label: 'Défense', value: 'def' }])
            );
            return await i.update({ content: "✅ Joueurs enregistrés. 👉 **Côté ?**", components: [r] });
        }

        if (i.isStringSelectMenu() && i.customId === 'cote') {
            s.cote = i.values[0] === 'att' ? "Attaque" : "Défense";
            const r = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Danger)
            );
            return await i.update({ content: `Côté : **${s.cote}** 👉 **Verdict ?**`, components: [r] });
        }

        if (i.isButton()) {
            if (s.processing) return;
            s.processing = true;

            await i.deferUpdate();

            const issue = i.customId === 'win' ? "Victoire" : "Défaite";
            const pts = calculerPoints(s.cote, issue, s.nb_ennemis);

            const placeholders = s.participants.map(() => "(?, ?, ?, ?, ?, ?, date('now'), ?)").join(', ');
            const params = [];
            s.participants.forEach(p => params.push(p.id, p.name, pts, issue, s.cote, s.nb_ennemis, s.token));

            const sql = `INSERT OR IGNORE INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_ennemis, date, session_token) VALUES ${placeholders}`;

            db.run(sql, params, async function(err) {
                if (err) {
                    console.error("Erreur SQL:", err);
                    return;
                }

                setTimeout(async () => {
                    const board = await getLeaderboard(15);
                    
                    const recap = [
                        `👥 **Participants :** ${s.participants.map(p => `**${p.name}**`).join(', ')}`,
                        `⚔️ **Type :** ${issue} en ${s.cote}`,
                        `🎖️ **Gain :** \`+${pts.toFixed(1)} points\``
                    ].join('\n');

                    const finalEmbed = new EmbedBuilder()
                        .setTitle("📝 RÉCAPITULATIF DU COMBAT")
                        .setDescription(recap)
                        .setColor(issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                        .addFields({ name: "🏆 TOP 15 - CLASSEMENT GÉNÉRAL", value: board })
                        .setTimestamp();

                    await i.editReply({ content: null, components: [], embeds: [finalEmbed] });

                    const archiveChannel = client.channels.cache.get(ID_SALON_ARCHIVE);
                    if (archiveChannel) {
                        await archiveChannel.send({ embeds: [finalEmbed] }).catch(() => {});
                    }

                    sessions.delete(i.user.id);
                }, 500); 
            });
        }
    } catch (err) {
        console.error("Erreur interaction:", err);
        sessions.delete(i.user.id);
    }
});

client.login(process.env.TOKEN);
