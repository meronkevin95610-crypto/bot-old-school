const http = require('http');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, UserSelectMenuBuilder 
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- SERVEUR DE MONITORING (Indispensable pour Render) ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Bot Perco V2.3 - Operationnel");
    res.end();
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

// --- CONFIGURATION DU BOT ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const roleToPing = "<@&1476632455669743666>";
const sessions = new Map();

// --- INITIALISATION ET RÉPARATION DE LA BDD ---
const db = new sqlite3.Database('./stats.db');

db.serialize(() => {
    // Création de la table avec la nouvelle structure
    db.run(`CREATE TABLE IF NOT EXISTS attaques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        joueur_id TEXT,
        joueur_nom TEXT,
        points INTEGER,
        type TEXT,
        issue TEXT,
        cote TEXT,
        date TEXT
    )`);

    // AUTO-RÉPARATION : Ajoute les colonnes si elles manquent (évite le crash SQLITE_ERROR)
    const columns = ["joueur_id", "joueur_nom", "points", "issue", "cote"];
    columns.forEach(col => {
        db.run(`ALTER TABLE attaques ADD COLUMN ${col} TEXT`, (err) => {
            // On ignore l'erreur si la colonne existe déjà
        });
    });
});

client.on('ready', () => {
    console.log(`✅ Bot Opérationnel : ${client.user.tag}`);
});

// --- FONCTION CLASSEMENT ---
async function getLeaderboard() {
    return new Promise((resolve) => {
        db.all(`SELECT joueur_nom, SUM(points) as total_pts FROM attaques 
                GROUP BY joueur_id ORDER BY total_pts DESC LIMIT 10`, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("Aucune donnée enregistrée.");

            let text = "🏆 **CLASSEMENT GÉNÉRAL (TOP 10)** 🏆\n```\n";
            rows.forEach((row, index) => {
                text += `${index + 1}. ${row.joueur_nom.padEnd(15)} | ${row.total_pts} pts\n`;
            });
            text += "```";
            resolve(text);
        });
    });
}

// --- GESTION DES COMMANDES ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!classement') {
        const board = await getLeaderboard();
        return message.channel.send(board);
    }

    if (message.content === '!attaque') {
        sessions.set(message.author.id, { 
            participants: [], cote: null, issue: null, type: null 
        });

        const embed = new EmbedBuilder()
            .setTitle("⚔️ Saisie de combat - Étape 1")
            .setDescription("Sélectionnez les participants via le menu ci-dessous.")
            .setColor("#5865F2");

        const userSelect = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('select_users')
                .setPlaceholder('Ajouter les joueurs participants...')
                .setMinValues(1)
                .setMaxValues(4)
        );

        await message.reply({ embeds: [embed], components: [userSelect] });
    }
});

// --- GESTION DES INTERACTIONS ---
client.on('interactionCreate', async (interaction) => {
    const session = sessions.get(interaction.user.id);
    if (!session && (interaction.isButton() || interaction.isUserSelectMenu())) {
        if (!interaction.replied) return interaction.reply({ content: "Session expirée. Refaites !attaque.", ephemeral: true });
        return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'select_users') {
        session.participants = interaction.users.map(u => ({ id: u.id, name: u.username }));
        
        const embed = new EmbedBuilder()
            .setTitle("⚔️ Étape 2 : Détails du combat")
            .setDescription(`**Équipe :** ${session.participants.map(p => p.name).join(', ')}`)
            .setColor("#FEE75C");

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary)
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
        );

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('perco').setLabel('Percepteur').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('prisme').setLabel('Prisme').setStyle(ButtonStyle.Primary)
        );

        await interaction.update({ embeds: [embed], components: [row1, row2, row3] });
    }

    if (interaction.isButton()) {
        const id = interaction.customId;
        if (id === 'att') session.cote = "Attaque";
        if (id === 'def') session.cote = "Défense";
        if (id === 'win') session.issue = "Victoire";
        if (id === 'lose') session.issue = "Défaite";
        if (id === 'perco') session.type = "Percepteur";
        if (id === 'prisme') session.type = "Prisme";

        if (session.cote && session.issue && session.type) {
            // CALCUL DES POINTS (Audit des points)
            let pts = session.issue === "Victoire" ? 5 : 2; 
            if (session.type === "Percepteur") pts += 1; 

            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, type, issue, cote, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            session.participants.forEach(p => {
                stmt.run(p.id, p.name, pts, session.type, session.issue, session.cote);
            });
            stmt.finalize();

            const finalEmbed = new EmbedBuilder()
                .setTitle(`✅ Combat validé !`)
                .setColor("#57F287")
                .addFields(
                    { name: "👥 Participants", value: session.participants.map(p => p.name).join('\n'), inline: true },
                    { name: "📊 Résultat", value: `${session.issue} ${session.type}`, inline: true },
                    { name: "🎖️ Gain", value: `+${pts} points chacun` }
                );

            await interaction.update({ content: `🚨 ${roleToPing} Nouvelle saisie !`, embeds: [finalEmbed], components: [] });
            
            const board = await getLeaderboard();
            await interaction.channel.send(board);
            sessions.delete(interaction.user.id);
        } else {
            await interaction.update({ content: `Sélection : **${session.cote || '?'}** | **${session.issue || '?'}** | **${session.type || '?'}**` });
        }
    }
});

process.on('unhandledRejection', error => console.error('Erreur :', error));
client.login(process.env.TOKEN);