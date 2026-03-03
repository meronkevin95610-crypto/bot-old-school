const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 

// Serveur HTTP pour Render
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V5.2.3 - Operationnel");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- SECURITE ANTI-CRASH GLOBALE ---
process.on('unhandledRejection', (reason) => console.error(' [ERREUR] Rejet non géré :', reason));
process.on('uncaughtException', (err) => console.error(' [ERREUR] Exception non capturée :', err));

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
    // Table pour stocker le mois du dernier reset
    db.run(`CREATE TABLE IF NOT EXISTS config (cle TEXT PRIMARY KEY, valeur TEXT)`);
});

const sessions = new Map();

// --- LOGIQUE METIER ---
function calculerPoints(cote, issue, ennemis) {
    if (issue === "Défaite") return (cote === "Défense") ? 1.0 : 0.0; 
    if (ennemis === 0) return 0.25; 
    if (cote === "Attaque") return (ennemis === 4) ? 5.0 : 3.0;
    else return (ennemis === 4) ? 4.0 : 2.0;
}

async function getLeaderboard(limit = 15) {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc,
                       SUM(CASE WHEN cote='Attaque' THEN 1 ELSE 0 END) as n_atk,
                       SUM(CASE WHEN cote='Défense' THEN 1 ELSE 0 END) as n_def,
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(points) as p FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT ${limit}`;
        
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucune donnée enregistrée.");
            let txt = `\`\`\`\nNom            | Pts   | Atk | Def | Ratio\n--------------------------------------------\n`;
            rows.forEach(r => {
                const ratio = r.tc > 0 ? ((r.v / r.tc) * 100).toFixed(0) + "%" : "0%";
                const nom = (r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14);
                const pts = (r.p || 0).toFixed(2).padEnd(5);
                const atk = String(r.n_atk).padEnd(3);
                const def = String(r.n_def).padEnd(3);
                txt += `${nom} | ${pts} | ${atk} | ${def} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- FONCTION DE RESET AUTOMATIQUE ---
async function checkMonthlyReset() {
    const mtn = new Date();
    const moisActuel = `${mtn.getFullYear()}-${mtn.getMonth() + 1}`; // Format "2026-3"

    db.get("SELECT valeur FROM config WHERE cle = 'dernier_reset'", async (err, row) => {
        if (err) return;

        // Si c'est la première fois ou si le mois enregistré est différent du mois actuel
        if (!row || row.valeur !== moisActuel) {
            
            // 1. On ne reset que si on a des données et que ce n'est pas le tout premier lancement
            if (row) {
                const channel = await client.channels.fetch(ID_SALON_ARCHIVE).catch(() => null);
                if (channel) {
                    const board = await getLeaderboard(20);
                    const embed = new EmbedBuilder()
                        .setTitle(`🏆 CLASSEMENT FINAL - MOIS PRÉCÉDENT`)
                        .setDescription(board)
                        .setColor("#f1c40f")
                        .setTimestamp();
                    await channel.send({ content: "🏁 **Le mois est terminé ! Voici le récapitulatif final :**", embeds: [embed] });
                }
                
                // 2. On vide la table des attaques
                db.run("DELETE FROM attaques;");
                console.log(" [RESET] Base de données réinitialisée pour le nouveau mois.");
            }

            // 3. Mise à jour du mois dans la config
            db.run("INSERT OR REPLACE INTO config (cle, valeur) VALUES ('dernier_reset', ?)", [moisActuel]);
        }
    });
}

// --- LOGIQUE DISCORD ---
client.on('ready', () => {
    console.log(`🚀 Bot Perco V5.2.3 prêt | ${client.user.tag}`);
    // Vérifier le reset au démarrage
    checkMonthlyReset();
    // Puis vérifier toutes les heures (3600000 ms)
    setInterval(checkMonthlyReset, 3600000);
});

// [Le reste de ton code !resultat et interactionCreate reste identique...]
// --- (Code MessageCreate et InteractionCreate ici) ---

client.on('messageCreate', async (m) => {
    try {
        if (m.author.bot) return;
        if (m.content === '!classement') {
            const board = await getLeaderboard(15);
            return m.reply(`🏆 **CLASSEMENT DE LA GUILDE (V5.2)** 🏆\n${board}`);
        }
        if (m.content === '!resultat' || m.content === '!resulta') {
            sessions.set(m.author.id, { participants: [], cote: null, nb_ennemis: 4, processing: false });
            const menu = new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId('u')
                    .setPlaceholder('1. Qui a participé ? (1 à 4 noms)')
                    .setMinValues(1)
                    .setMaxValues(4)
            );
            await m.reply({ content: "⚔️ **Configuration du combat**", components: [menu] });
        }
    } catch (e) { console.error("Erreur MessageCreate:", e); }
});

client.on('interactionCreate', async (i) => {
    const s = sessions.get(i.user.id);
    if (!s) return;
    try {
        if (i.isUserSelectMenu() && i.customId === 'u') {
            s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
            const r = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('cote')
                    .setPlaceholder('2. Côté du combat ?')
                    .addOptions([
                        { label: 'Attaque', value: 'att', description: 'Vous étiez les assaillants' },
                        { label: 'Défense', value: 'def', description: 'Vous défendiez' }
                    ])
            );
            return await i.update({ content: "✅ Joueurs enregistrés.\n👉 **De quel côté étiez-vous ?**", components: [r] });
        }
        if (i.isStringSelectMenu()) {
            if (i.customId === 'cote') {
                s.cote = i.values[0] === 'att' ? "Attaque" : "Défense";
                const r = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('ennemis')
                        .setPlaceholder('3. Combien d\'adversaires ?')
                        .addOptions([
                            { label: '4 Adversaires', value: '4', description: 'Combat complet' },
                            { label: '1 à 3 Adversaires', value: '1', description: 'Sous-nombre ennemi' },
                            { label: '0 Adversaire (Malus)', value: '0', description: 'Combat sans opposition' }
                        ])
                );
                return await i.update({ content: `Côté : **${s.cote}**\n👉 **Combien d'adversaires y avait-il en face ?**`, components: [r] });
            }
            if (i.customId === 'ennemis') {
                s.nb_ennemis = parseInt(i.values[0]);
                const r = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Danger)
                );
                return await i.update({ content: `Opposition : **${s.nb_ennemis} ennemis**\n👉 **Quel est le verdict final ?**`, components: [r] });
            }
        }
        if (i.isButton()) {
            if (s.processing) return;
            const issue = i.customId === 'win' ? "Victoire" : "Défaite";
            s.processing = true;
            const pts = calculerPoints(s.cote, issue, s.nb_ennemis);
            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_ennemis, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            db.serialize(() => {
                s.participants.forEach(p => stmt.run(p.id, p.name, pts, issue, s.cote, s.nb_ennemis));
                stmt.finalize();
            });
            const board = await getLeaderboard(15);
            const embed = new EmbedBuilder()
                .setTitle("🚨 Résultat de Combat Enregistré")
                .setDescription(`${s.participants.map(p => `**${p.name}**`).join(', ')}\n**${issue}** en **${s.cote}** contre **${s.nb_ennemis}** ennemis.\n🎖️ Points : **+${pts.toFixed(2)}** chacun.`)
                .setColor(issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                .addFields({ name: "📊 TOP 15 ACTUALISÉ", value: board })
                .setTimestamp();
            await i.update({ content: "✅ **Statistiques synchronisées avec succès.**", components: [], embeds: [embed] });
            sessions.delete(i.user.id);
        }
    } catch (err) { 
        console.error("Erreur Interaction:", err);
        sessions.delete(i.user.id);
    }
});

client.login(process.env.TOKEN);