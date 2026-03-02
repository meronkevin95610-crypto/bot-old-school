const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- 1. SERVEUR DE MAINTIEN (RENDER) ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Guilde V5.3 - Fix SQL & Interactions");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- 2. BASE DE DONNÉES AVEC AUTO-MIGRATION ---
const db = new sqlite3.Database('./stats.db');

db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");
    
    // Création des tables de base
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
    db.run(`CREATE TABLE IF NOT EXISTS metapano (id INTEGER PRIMARY KEY AUTOINCREMENT, auteur TEXT, element TEXT, description TEXT, lien TEXT)`);

    // Liste des colonnes obligatoires pour 'attaques'
    const schemaAttaques = [
        { name: "joueur_id", type: "TEXT" },
        { name: "joueur_nom", type: "TEXT" },
        { name: "points", type: "REAL" },
        { name: "issue", type: "TEXT" },
        { name: "cote", type: "TEXT" },
        { name: "nb_allies", type: "INTEGER" },
        { name: "date", type: "TEXT" }
    ];

    // Vérification et ajout automatique des colonnes manquantes
    db.all("PRAGMA table_info(attaques)", (err, rows) => {
        if (err) return console.error("Erreur PRAGMA:", err);
        const existingCols = rows.map(r => r.name);
        
        schemaAttaques.forEach(col => {
            if (!existingCols.includes(col.name)) {
                db.run(`ALTER TABLE attaques ADD COLUMN ${col.name} ${col.type}`, (err) => {
                    if (!err) console.log(`✅ SQL : Colonne [${col.name}] ajoutée avec succès.`);
                });
            }
        });
    });
});

const sessions = new Map();

// --- 3. FONCTION CLASSEMENT (TOP 15) ---
async function getLeaderboard(title = "CLASSEMENT DE LA GUILDE") {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc, 
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(CASE WHEN issue='Défaite' THEN 1 ELSE 0 END) as d, 
                       SUM(points) as p 
                       FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT 15`;
        
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucune donnée enregistrée.");
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

// --- 4. ÉVÉNEMENTS ---
client.on('ready', () => console.log(`✅ Bot Opérationnel : ${client.user.tag}`));

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!classement') {
        const board = await getLeaderboard();
        return m.reply(board);
    }

    if (m.content === '!stuff') {
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('view_stuff').setPlaceholder('🔎 Choisis un élément').addOptions([
                { label: 'Terre', value: 'Terre', emoji: '🪨' },
                { label: 'Feu', value: 'Feu', emoji: '🔥' },
                { label: 'Eau', value: 'Eau', emoji: '💧' },
                { label: 'Air', value: 'Air', emoji: '🌪️' },
                { label: 'Multi', value: 'Multi', emoji: '🌈' }
            ])
        );
        return m.reply({ content: "🛡️ **BIBLIOTHÈQUE DE STUFFS**", components: [row] });
    }

    if (m.content === '!resultat') {
        sessions.set(m.author.id, { participants: [] });
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('sel_u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4)
        );
        return m.reply({ content: "⚔️ **Nouvelle saisie de combat**", components: [menu] });
    }
});

// --- 5. LOGIQUE DES INTERACTIONS ---
client.on('interactionCreate', async (i) => {
    const userId = i.user.id;
    let s = sessions.get(userId);

    // Sécurité : Vérifier si l'interaction est encore valide
    if (i.isUserSelectMenu() && i.customId === 'sel_u') {
        s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
        const r = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('sel_f').setPlaceholder('2. Format du combat ?').addOptions([
                { label: '4 alliés', value: '4' },
                { label: '3 alliés (+0.75 pts)', value: '3' },
                { label: '2 alliés (+0.75 pts)', value: '2' }
            ])
        );
        return i.update({ content: `✅ Joueurs enregistrés.\n👉 **Combien d'alliés étiez-vous au total ?**`, components: [r] });
    }

    if (i.isStringSelectMenu() && i.customId === 'sel_f') {
        if (!s) return i.reply({ content: "Session expirée, relance !resultat", ephemeral: true });
        s.nb_allies = parseInt(i.values[0]);
        const r1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary)
        );
        const r2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
        );
        return i.update({ content: `✅ Format : **${s.nb_allies}v4**\n👉 **Choisis le côté et l'issue :**`, components: [r1, r2] });
    }

    if (i.isButton() && ['att', 'def', 'win', 'lose'].includes(i.customId)) {
        if (!s) return i.reply({ content: "Session expirée.", ephemeral: true });
        
        if (['att', 'def'].includes(i.customId)) s.cote = (i.customId === 'att' ? "Attaque" : "Défense");
        if (['win', 'lose'].includes(i.customId)) s.issue = (i.customId === 'win' ? "Victoire" : "Défaite");

        if (s.cote && s.issue) {
            // Calcul des points
            let basePts = s.issue === "Victoire" ? 1.0 : 0.25;
            let finalPts = (s.nb_allies < 4) ? (basePts + 0.75) : basePts;

            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_allies, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            s.participants.forEach(p => stmt.run(p.id, p.name, finalPts, s.issue, s.cote, s.nb_allies));
            stmt.finalize();

            sessions.delete(userId);
            const board = await getLeaderboard();
            
            // On répond à l'interaction pour éviter le "Interaction inconnue"
            return i.update({ 
                content: `✅ **Combat enregistré !** (+${finalPts.toFixed(2)} pts)`, 
                components: [], 
                embeds: [new EmbedBuilder().setTitle("Mise à jour du Classement").setDescription(board).setColor('#2ecc71')] 
            });
        } else {
            // Met à jour l'affichage des choix sans fermer l'interaction
            return i.update({ content: `👉 Sélection actuelle : **${s.cote || '?'}** | **${s.issue || '?'}**` });
        }
    }

    if (i.isStringSelectMenu() && i.customId === 'view_stuff') {
        const elem = i.values[0];
        db.all(`SELECT * FROM metapano WHERE element = ?`, [elem], (err, rows) => {
            const embed = new EmbedBuilder().setTitle(`🛡️ Stuffs : ${elem}`).setColor('#3498db');
            let desc = (rows && rows.length > 0) ? rows.map(r => `• **${r.description}**\n🔗 [Dofusbook](${r.lien})`).join('\n\n') : "Aucun stuff enregistré.";
            embed.setDescription(desc);
            return i.reply({ embeds: [embed], ephemeral: true });
        });
    }
});

client.login(process.env.TOKEN);