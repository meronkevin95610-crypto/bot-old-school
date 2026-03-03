const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

// --- 1. CONFIGURATION & SÉCURITÉ ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 
process.on('SIGTERM', () => { if (db) db.close(); process.exit(0); });

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V5.6.0 - Full Auto & Multi-Fix");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- 2. BASE DE DONNÉES ---
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
        session_token TEXT
    )`);
});

const sessions = new Map();

// --- 3. LOGIQUE DE CALCUL ---
function calculerPoints(cote, issue, ennemis) {
    if (issue === "Défaite") return (cote === "Défense") ? 1.0 : 0.0; 
    if (ennemis === 0) return 0.25; 
    if (cote === "Attaque") return (ennemis === 4) ? 5.0 : 3.0;
    return (ennemis === 4) ? 4.0 : 2.0;
}

// --- 4. MOTEUR DE LEADERBOARD ---
async function getLeaderboard(limit = 50) {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, 
                       SUM(points) as p, 
                       COUNT(*) as total 
                       FROM attaques 
                       GROUP BY joueur_id 
                       ORDER BY p DESC 
                       LIMIT ${limit || 50}`;
        
        db.all(query, [], (err, rows) => {
            if (err) return resolve("⚠️ Erreur SQL.");
            if (!rows || rows.length === 0) return resolve("⚠️ Aucun joueur dans le classement.");

            let txt = "```\nNom            | Pts   | Combats\n--------------------------------\n";
            rows.forEach(r => {
                const nom = (r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14);
                const pts = (r.p || 0).toFixed(1).padEnd(5);
                const count = String(r.total).padEnd(3);
                txt += `${nom} | ${pts} | ${count}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- 5. TÂCHE AUTOMATIQUE (FIN DE MOIS) ---
cron.schedule('59 23 28-31 * *', async () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    if (tomorrow.getDate() === 1) {
        const archive = client.channels.cache.get(ID_SALON_ARCHIVE);
        if (archive) {
            const fullBoard = await getLeaderboard(50);
            const embed = new EmbedBuilder()
                .setTitle("📅 CLASSEMENT FINAL DU MOIS")
                .setDescription(fullBoard)
                .setColor("#f1c40f")
                .setFooter({ text: "Archive de fin de mois - Reset effectué" })
                .setTimestamp();
            
            await archive.send({ content: "@everyone 🚨 **CLASSEMENT FINAL !** Les compteurs repartent à zéro.", embeds: [embed] });
            db.run("DELETE FROM attaques");
        }
    }
});

// --- 6. ÉVÉNEMENTS & COMMANDES ---
client.on('ready', () => { console.log(`🚀 Bot prêt | V5.6.0`); });

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    // Affiche le Top 15 (Prestige)
    if (m.content === '!top' || m.content === '!classement') {
        const board = await getLeaderboard(15); 
        return m.reply(`🏆 **TOP 15 ACTUEL**\n${board}`);
    }

    // Affiche le Top 50 (Vérification complète)
    if (m.content === '!topcomplet') {
        const board = await getLeaderboard(50); 
        return m.reply(`📊 **CLASSEMENT GÉNÉRAL (TOUS LES JOUEURS)**\n${board}`);
    }

    // Commande de nettoyage (Admin uniquement)
    if (m.content === '!nettoyer-stats') {
        if (!m.member.permissions.has(PermissionFlagsBits.Administrator)) return;
        db.run("DELETE FROM attaques", (err) => {
            if (!err) return m.reply("✅ Toutes les statistiques ont été réinitialisées.");
        });
    }

    // Enregistrement de combat
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
            return await i.update({ content: `✅ **${s.participants.length} joueurs** sélectionnés. 👉 **Côté ?**`, components: [r] });
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

            // Insertion robuste joueur par joueur
            for (const p of s.participants) {
                await new Promise((resolve) => {
                    db.run(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_ennemis, date, session_token) 
                           VALUES (?, ?, ?, ?, ?, ?, date('now'), ?)`, 
                           [p.id, p.name, pts, issue, s.cote, s.nb_ennemis, s.token], resolve);
                });
            }

            setTimeout(async () => {
                const board = await getLeaderboard(50); // Récapitulatif large pour être sûr de voir tout le monde
                const embed = new EmbedBuilder()
                    .setTitle("📝 RÉCAPITULATIF DU COMBAT")
                    .setDescription(`👥 **Equipe :** ${s.participants.map(p => `**${p.name}**`).join(', ')}\n⚔️ **Verdict :** ${issue} (${s.cote})\n🎖️ **Gain :** \`+${pts.toFixed(1)} pts / joueur\``)
                    .setColor(issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                    .addFields({ name: "🏆 CLASSEMENT ACTUEL", value: board })
                    .setTimestamp();

                await i.editReply({ content: null, components: [], embeds: [embed] });
                const archive = client.channels.cache.get(ID_SALON_ARCHIVE);
                if (archive) await archive.send({ embeds: [embed] }).catch(() => {});
                sessions.delete(i.user.id);
            }, 800);
        }
    } catch (err) { console.error(err); sessions.delete(i.user.id); }
});

client.login(process.env.TOKEN);
