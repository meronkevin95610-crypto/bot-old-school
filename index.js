const http = require('http');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder 
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- SERVEUR POUR RENDER ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Bot Perco V2 - Multi-joueurs & Points");
    res.end();
});
server.listen(process.env.PORT || 3000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// BASE DE DONNÉES MISE À JOUR
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS attaques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        joueur_id TEXT,
        joueur_nom TEXT,
        points INTEGER,
        type TEXT,
        issue TEXT,
        date TEXT
    )`);
});

const roleToPing = "<@&1476632455669743666>";
const sessions = new Map();

client.on('ready', () => console.log(`✅ Bot Opérationnel : ${client.user.tag}`));

// --- LOGIQUE CLASSEMENT ---
async function generateLeaderboard() {
    return new Promise((resolve) => {
        db.all(`SELECT joueur_nom, SUM(points) as total_pts FROM attaques 
                GROUP BY joueur_id ORDER BY total_pts DESC LIMIT 10`, [], (err, rows) => {
            if (err) return resolve("Erreur de chargement du classement.");
            if (!rows || rows.length === 0) return resolve("Aucune donnée pour le moment.");

            let leaderboard = "🏆 **CLASSEMENT GÉNÉRAL (TOP 10)** 🏆\n```\n";
            rows.forEach((row, index) => {
                leaderboard += `${index + 1}. ${row.joueur_nom.padEnd(15)} | ${row.total_pts} pts\n`;
            });
            leaderboard += "```";
            resolve(leaderboard);
        });
    });
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!classement') {
        const board = await generateLeaderboard();
        message.channel.send(board);
    }

    if (message.content === '!attaque') {
        sessions.set(message.author.id, { 
            cote: null, issue: null, type: null, participants: [] 
        });

        const embed = new EmbedBuilder()
            .setTitle("⚔️ Nouvelle Saisie - Étape 1 : Équipe")
            .setDescription("Sélectionnez les membres de la guilde ayant participé.")
            .setColor("Blue");

        const userSelect = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('select_users')
                .setPlaceholder('Ajouter les participants (max 4)')
                .setMinValues(1)
                .setMaxValues(4)
        );

        await message.reply({ embeds: [embed], components: [userSelect] });
    }
});

client.on('interactionCreate', async (interaction) => {
    const session = sessions.get(interaction.user.id);
    if (!session && !interaction.customId.startsWith('public_')) return;

    // 1. Sélection des membres
    if (interaction.isUserSelectMenu() && interaction.customId === 'select_users') {
        session.participants = interaction.users.map(u => ({ id: u.id, username: u.username }));
        
        const embed = new EmbedBuilder()
            .setTitle("⚔️ Étape 2 : Détails du combat")
            .setDescription(`Équipe : ${session.participants.map(p => p.username).join(', ')}`)
            .setColor("Yellow");

        const rowButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
        );

        const rowType = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('perco').setLabel('Percepteur').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('prisme').setLabel('Prisme').setStyle(ButtonStyle.Primary)
        );

        await interaction.update({ embeds: [embed], components: [rowButtons, rowType] });
    }

    // 2. Gestion des boutons et finalisation
    if (interaction.isButton()) {
        if (['att', 'def', 'win', 'lose', 'perco', 'prisme'].includes(interaction.customId)) {
            if (interaction.customId === 'att') session.cote = "Attaque";
            if (interaction.customId === 'def') session.cote = "Défense";
            if (interaction.customId === 'win') session.issue = "Victoire";
            if (interaction.customId === 'lose') session.issue = "Défaite";
            if (interaction.customId === 'perco') session.type = "Percepteur";
            if (interaction.customId === 'prisme') session.type = "Prisme";

            if (session.cote && session.issue && session.type) {
                // CALCUL DES POINTS
                let pointsBase = session.issue === "Victoire" ? 5 : 2;
                if (session.type === "Percepteur") pointsBase += 1;

                // Enregistrement de chaque participant
                const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, type, issue, date) VALUES (?, ?, ?, ?, ?, datetime('now'))`);
                session.participants.forEach(p => {
                    stmt.run(p.id, p.username, pointsBase, session.type, session.issue);
                });
                stmt.finalize();

                const finalEmbed = new EmbedBuilder()
                    .setTitle(`🚨 Combat Enregistré !`)
                    .setColor("Green")
                    .addFields(
                        { name: "👥 Équipe", value: session.participants.map(p => p.username).join('\n'), inline: true },
                        { name: "🎖️ Gain", value: `${pointsBase} pts / personne`, inline: true },
                        { name: "ℹ️ Type", value: `${session.issue} ${session.type} (${session.cote})` }
                    );

                const leaderboard = await generateLeaderboard();
                
                await interaction.update({ 
                    content: `${roleToPing} **Mise à jour des stats !**`, 
                    embeds: [finalEmbed], 
                    components: [] 
                });
                
                // Envoi du nouveau classement juste après
                await interaction.channel.send(leaderboard);
                sessions.delete(interaction.user.id);
            } else {
                await interaction.update({ content: `Sélection en cours : ${session.cote || '?'} | ${session.issue || '?'} | ${session.type || '?'}` });
            }
        }
    }
});

client.login(process.env.TOKEN);