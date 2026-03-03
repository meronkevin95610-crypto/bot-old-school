const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 

// Petit serveur HTTP pour garder le bot en vie sur Render
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
});

const sessions = new Map();

// --- LOGIQUE METIER (BARÈME V5.2) ---
function calculerPoints(cote, issue, ennemis) {
    if (issue === "Défaite") {
        return (cote === "Défense") ? 1.0 : 0.0; 
    }
    // Cas Victoire
    if (ennemis === 0) return 0.25; // Malus anti-farm
    
    if (cote === "Attaque") {
        return (ennemis === 4) ? 5.0 : 3.0;
    } else {
        return (ennemis === 4) ? 4.0 : 2.0;
    }
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

// --- LOGIQUE DISCORD ---
client.on('ready', () => console.log(`🚀 Bot Perco V5.2.3 prêt | ${client.user.tag}`));

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
        // ÉTAPE 1 : SÉLECTION DES JOUEURS
        if (i.isUserSelectMenu() && i.customId === 'u') {
            s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
            
            const r = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('cote')
                    .setPlaceholder('2. Côté du combat ?')
                    .addOptions([
                        { label: 'Attaque', value: 'att', description: 'Vous étiez les assaillants' },
                        { label: 'Défense', value: 'def', description: 'Vous défendiez un percepteur' }
                    ])
            );
            return await i.update({ content: "✅ Joueurs enregistrés.\n👉 **De quel côté étiez-vous ?**", components: [r] });
        }

        if (i.isStringSelectMenu()) {
            // ÉTAPE 2 : CÔTÉ (ATK/DEF)
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

            // ÉTAPE 3 : NOMBRE D'ENNEMIS
            if (i.customId === 'ennemis') {
                s.nb_ennemis = parseInt(i.values[0]);
                
                const r = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Danger)
                );
                return await i.update({ content: `Opposition : **${s.nb_ennemis} ennemis**\n👉 **Quel est le verdict final ?**`, components: [r] });
            }
        }

        // ÉTAPE 4 : RÉSULTAT FINAL ET ENREGISTREMENT
        if (i.isButton()) {
            if (s.processing) return;
            const issue = i.customId === 'win' ? "Victoire" : "Défaite";
            s.processing = true;

            const pts = calculerPoints(s.cote, issue, s.nb_ennemis);
            
            // Enregistrement SQL
            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_ennemis, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            
            db.serialize(() => {
                s.participants.forEach(p => {
                    stmt.run(p.id, p.name, pts, issue, s.cote, s.nb_ennemis);
                });
                stmt.finalize();
            });

            // Préparation de l'affichage final
            const board = await getLeaderboard(15);
            const listParticipants = s.participants.map(p => `**${p.name}**`).join(', ');

            const embed = new EmbedBuilder()
                .setTitle("🚨 Résultat de Combat Enregistré")
                .setDescription(`${listParticipants}\n**${issue}** en **${s.cote}** contre **${s.nb_ennemis}** ennemis.\n🎖️ Points attribués : **+${pts.toFixed(2)}** chacun.`)
                .setColor(issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                .addFields({ name: "📊 TOP 15 ACTUALISÉ", value: board })
                .setTimestamp();

            await i.update({ content: "✅ **Statistiques synchronisées avec succès.**", components: [], embeds: [embed] });
            
            // Nettoyage de la session
            sessions.delete(i.user.id);
        }
    } catch (err) { 
        console.error("Erreur Interaction:", err);
        if (!i.replied) {
            await i.followUp({ content: "❌ Une erreur est survenue lors du traitement.", ephemeral: true }).catch(() => {});
        }
        sessions.delete(i.user.id);
    }
});

client.login(process.env.TOKEN);