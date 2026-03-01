const http = require('http');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder 
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- SERVEUR RENDER ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Bot Perco V3.3 - Recap Nommé");
    res.end();
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- BASE DE DONNÉES ---
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS attaques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        joueur_id TEXT,
        joueur_nom TEXT,
        points REAL,
        issue TEXT,
        cote TEXT,
        nb_allies INTEGER,
        date TEXT
    )`);
});

const sessions = new Map();

// --- FONCTION CLASSEMENT ---
async function getLeaderboard() {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as total_c, SUM(CASE WHEN issue = 'Victoire' THEN 1 ELSE 0 END) as vics, SUM(CASE WHEN issue = 'Défaite' THEN 1 ELSE 0 END) as defs, SUM(points) as pts FROM attaques GROUP BY joueur_id ORDER BY pts DESC LIMIT 10`;
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("Aucune donnée.");
            let text = "🏆 **CLASSEMENT DE LA GUILDE** 🏆\n```\nNom            | Cbt | V | D | Pts   | Ratio\n-----------------------------------------------\n";
            rows.forEach(row => {
                const ratio = row.total_c > 0 ? ((row.vics / row.total_c) * 100).toFixed(0) + "%" : "0%";
                text += `${(row.joueur_nom || "Inconnu").substring(0, 14).padEnd(14)} | ${String(row.total_c).padEnd(3)} | ${String(row.vics).padEnd(1)} | ${String(row.defs).padEnd(1)} | ${(row.pts || 0).toFixed(2).padEnd(5)} | ${ratio}\n`;
            });
            text += "```";
            resolve(text);
        });
    });
}

client.on('ready', () => console.log(`✅ Bot Opérationnel : ${client.user.tag}`));

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!resultat') {
        sessions.set(message.author.id, { 
            participants: [], cote: null, issue: null, nb_allies: 4, step: 'SETUP' 
        });

        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('select_users').setPlaceholder('Sélectionner les joueurs...').setMinValues(1).setMaxValues(4)
        );
        await message.reply({ content: "⚔️ **Saisie de résultat** : Qui a participé au combat ?", components: [menu] });
    }

    // --- ÉTAPE FINALE : RÉCEPTION DU SCREENSHOT ---
    const session = sessions.get(message.author.id);
    if (session && session.step === 'WAITING_SCREEN') {
        if (message.attachments.size > 0) {
            const screenshot = message.attachments.first().url;
            
            let pts = session.issue === "Victoire" ? 1.0 : 0.25;
            if (session.nb_allies < 4) pts += 2.0;

            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_allies, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            session.participants.forEach(p => stmt.run(p.id, p.name, pts, session.issue, session.cote, session.nb_allies));
            stmt.finalize();

            // --- CONSTRUCTION DE LA PHRASE PERSONNALISÉE ---
            const listeNoms = session.participants.map(p => `**${p.name}**`).join(', ');
            const grammaireAction = session.issue === "Victoire" ? "réalisé une **Victoire**" : "subi une **Défaite**";
            const phraseRecap = `${listeNoms} vient de ${grammaireAction} en **${session.cote}** en **${session.nb_allies}v4** !`;

            const confirmEmbed = new EmbedBuilder()
                .setTitle("🔥 Résultat Enregistré !")
                .setDescription(phraseRecap) // Affiche la phrase personnalisée ici
                .setColor(session.issue === "Victoire" ? "Green" : "Red")
                .addFields(
                    { name: "🎖️ Gain", value: `+${pts} pts / joueur`, inline: true },
                    { name: "📊 Mode", value: `${session.cote} (${session.nb_allies}v4)`, inline: true }
                )
                .setImage(screenshot)
                .setFooter({ text: `Vérifié par ${message.author.username}` })
                .setTimestamp();

            await message.reply({ content: `✅ Statut mis à jour pour : ${listeNoms}`, embeds: [confirmEmbed] });
            
            const board = await getLeaderboard();
            await message.channel.send(board);
            sessions.delete(message.author.id);
        }
    }

    if (message.content === '!classement') {
        const board = await getLeaderboard();
        message.channel.send(board);
    }
});

// --- GESTION DES MENUS ET BOUTONS ---
client.on('interactionCreate', async (interaction) => {
    const session = sessions.get(interaction.user.id);
    if (!session) return;

    if (interaction.isUserSelectMenu()) {
        session.participants = interaction.users.map(u => ({ id: u.id, name: u.username }));
        const rowNb = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('nb_allies').setPlaceholder('Nombre d\'alliés').addOptions([
                { label: '4 alliés', value: '4' },
                { label: '3 alliés (Bonus +2)', value: '3' },
                { label: '2 alliés (Bonus +2)', value: '2' }
            ])
        );
        await interaction.update({ content: "Combien étiez-vous ?", components: [rowNb] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'nb_allies') {
        session.nb_allies = parseInt(interaction.values[0]);
        const r1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary)
        );
        const r2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
        );
        await interaction.update({ content: "Détails du combat :", components: [r1, r2] });
    }

    if (interaction.isButton()) {
        if (['att', 'def'].includes(interaction.customId)) session.cote = interaction.customId === 'att' ? "Attaque" : "Défense";
        if (['win', 'lose'].includes(interaction.customId)) session.issue = interaction.customId === 'win' ? "Victoire" : "Défaite";

        if (session.cote && session.issue) {
            session.step = 'WAITING_SCREEN';
            await interaction.update({ 
                content: `📸 **Presque fini !**\nSaisie : **${session.issue}** en **${session.cote}**.\n\n👉 **Envoie maintenant le SCREENSHOT** du combat pour valider.`, 
                components: [] 
            });
        }
    }
});

client.login(process.env.TOKEN);