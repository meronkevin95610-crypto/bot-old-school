const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

// --- 1. SÉCURITÉ ---
process.on('SIGTERM', () => { if (db) db.close(); process.exit(0); });

// --- 2. CONFIGURATION & SERVEUR ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V5.5.3 - Full Auto");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- 3. BASE DE DONNÉES ---
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

// --- 5. MOTEUR DE LEADERBOARD ---
async function getLeaderboard(limit = null) {
    return new Promise((resolve) => {
        const limitQuery = limit ? `LIMIT ${limit}` : "";
        const query = `SELECT joueur_nom, COUNT(*) as tc,
                       SUM(CASE WHEN cote='Attaque' THEN 1 ELSE 0 END) as n_atk,
                       SUM(CASE WHEN cote='Défense' THEN 1 ELSE 0 END) as n_def,
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(points) as p FROM attaques GROUP BY joueur_id ORDER BY p DESC ${limitQuery}`;
        
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucune donnée.");
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

// --- 6. TÂCHE AUTOMATIQUE (FIN DE MOIS & RESET) ---
cron.schedule('59 23 28-31 * *', async () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    if (tomorrow.getDate() === 1) {
        const archive = client.channels.cache.get(ID_SALON_ARCHIVE);
        if (archive) {
            const fullBoard = await getLeaderboard(null); // Archive tout le monde
            const embed = new EmbedBuilder()
                .setTitle("📅 CLASSEMENT FINAL DU MOIS")
                .setDescription(fullBoard)
                .setColor("#f1c40f")
                .setFooter({ text: "Archive de fin de mois - Les scores sont réinitialisés" })
                .setTimestamp();
            
            await archive.send({ content: "@everyone 🚨 **CLASSEMENT FINAL !** Les compteurs repartent à zéro.", embeds: [embed] });
            
            db.run("DELETE FROM attaques", (err) => {
                if (!err) console.log("✅ Base de données réinitialisée.");
            });
        }
    }
});

// --- 7. ÉVÉNEMENTS ---
client.on('ready', () => { console.log(`🚀 Bot prêt | V5.5.3`); });

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    // Affiche uniquement le Top 15
    if (m.content === '!top' || m.content === '!classement') {
        const board = await getLeaderboard(15); 
        return m.reply(`🏆 **TOP 15 ACTUEL**\n${board}`);
    }

    // Affiche TOUT LE MONDE
    if (m.content === '!topcomplet') {
        const board = await getLeaderboard(null); 
        return m.reply(`📊 **CLASSEMENT COMPLET (TOUS LES JOUEURS)**\n${board}`);
    }

    if (m.content === '!resultat' || m.content === '!resulta') {
        const token = `ST-${Date.now()}-${m.author.id}`;
        sessions.set(m.author.id, { participants: [], cote: null, nb_ennemis: 4, processing: false, token: token });
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
                new StringSelectMenuBuilder().setCustomId('ennemis').setPlaceholder('3. Combien d\'ennemis ?')
                .addOptions([
                    { label: '4 Ennemis (Full)', value: '4' },
                    { label: '1 à 3 Ennemis', value: '3' },
                    { label: '0 Ennemis (Abandon)', value: '0' }
                ])
            );
            return await i.update({ content: `Côté : **${s.cote}**. 👉 **Nombre d'ennemis ?**`, components: [r] });
        }

        if (i.isStringSelectMenu() && i.customId === 'ennemis') {
            s.nb_ennemis = parseInt(i.values[0]);
            const r = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Danger)
            );
            return await i.update({ content: `Combat contre **${s.nb_ennemis}** ennemis. 👉 **Verdict ?**`, components: [r] });
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

            db.run(`INSERT OR IGNORE INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_ennemis, date, session_token) VALUES ${placeholders}`, params, async function(err) {
                if (err) { console.error(err); return sessions.delete(i.user.id); }

                setTimeout(async () => {
                    const board = await getLeaderboard(15); // Récap limité au Top 15 pour rester propre
                    const embed = new EmbedBuilder()
                        .setTitle("📝 RÉCAPITULATIF DU COMBAT")
                        .setDescription(`👥 **Participants :** ${s.participants.map(p => `**${p.name}**`).join(', ')}\n⚔️ **Type :** ${issue} en ${s.cote} (${s.nb_ennemis} ennemis)\n🎖️ **Gain :** \`+${pts.toFixed(1)} points par joueur\``)
                        .setColor(issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                        .addFields({ name: "🏆 TOP 15 - CLASSEMENT GÉNÉRAL", value: board })
                        .setTimestamp();

                    await i.editReply({ content: null, components: [], embeds: [embed] });
                    const archive = client.channels.cache.get(ID_SALON_ARCHIVE);
                    if (archive) await archive.send({ embeds: [embed] }).catch(() => {});
                    sessions.delete(i.user.id);
                }, 500);
            });
        }
    } catch (err) { console.error(err); sessions.delete(i.user.id); }
});

client.login(process.env.TOKEN);
