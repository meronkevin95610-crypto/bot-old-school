// index.js
const http = require('http');
const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    StringSelectMenuBuilder 
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- SERVEUR POUR RENDER ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Bot Perco Interactif en ligne !");
    res.end();
});
server.listen(process.env.PORT || 3000);
// ----------------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const db = new sqlite3.Database('./stats.db');
db.run(`CREATE TABLE IF NOT EXISTS attaques (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    joueur TEXT,
    victoires INTEGER,
    defaites INTEGER,
    type TEXT,
    date TEXT
)`);

const roleToPing = "<@&1476632455669743666>";

// Stockage temporaire des choix des utilisateurs
const sessions = new Map();

client.on('ready', () => console.log(`✅ Bot prêt : ${client.user.tag}`));

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!attaque') {
        // Initialiser la session
        sessions.set(message.author.id, { cote: null, issue: null, type: null });

        const embed = new EmbedBuilder()
            .setTitle("⚔️ Saisie du résultat (Étape 1)")
            .setDescription("Choisissez le côté et l'issue du combat.")
            .setColor("#2f3136");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
        );

        const rowType = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('perco').setLabel('Percepteur').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('prisme').setLabel('Prisme').setStyle(ButtonStyle.Primary)
        );

        await message.reply({ embeds: [embed], components: [row, rowType] });
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

    const session = sessions.get(interaction.user.id);
    if (!session) return interaction.reply({ content: "Session expirée, tapez !attaque.", ephemeral: true });

    // Gestion des boutons Côté / Issue / Type
    if (interaction.isButton()) {
        if (interaction.customId === 'att') session.cote = "Attaque";
        if (interaction.customId === 'def') session.cote = "Défense";
        if (interaction.customId === 'win') session.issue = "Victoire";
        if (interaction.customId === 'lose') session.issue = "Défaite";
        if (interaction.customId === 'perco') session.type = "Percepteur";
        if (interaction.customId === 'prisme') session.type = "Prisme";

        // Si tout est coché, on passe au nombre d'adversaires
        if (session.cote && session.issue && session.type) {
            const menuRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('nb_adv')
                    .setPlaceholder('Nombre d\'adversaires')
                    .addOptions([
                        { label: '1 adversaire', value: '1' },
                        { label: '2 adversaires', value: '2' },
                        { label: '3 adversaires', value: '3' },
                        { label: '4 adversaires', value: '4' },
                    ])
            );
            return interaction.update({ content: "Combien d'ennemis ?", embeds: [], components: [menuRow] });
        }

        await interaction.update({ content: `Sélectionné : ${session.cote || '?'} | ${session.issue || '?'} | ${session.type || '?'}` });
    }

    // Gestion du menu déroulant final
    if (interaction.isStringSelectMenu() && interaction.customId === 'nb_adv') {
        const nb = interaction.values[0];
        const win = session.issue === "Victoire" ? 1 : 0;
        const lose = session.issue === "Défaite" ? 1 : 0;

        // Calcul des points (Audit des points)
        let points = win ? 4 : 2;
        if (session.type === "Percepteur") points += 1;

        db.run(`INSERT INTO attaques (joueur, victoires, defaites, type, date) VALUES (?, ?, ?, ?, datetime('now'))`,
            [interaction.user.username, win, lose, session.type]);

        const finalEmbed = new EmbedBuilder()
            .setTitle(`${session.issue} ${session.type} !`)
            .setColor(win ? "Green" : "Red")
            .addFields(
                { name: "👤 Joueur", value: interaction.user.username, inline: true },
                { name: "⚔️ Mode", value: `${session.cote} (${nb} vs 4)`, inline: true },
                { name: "📊 Audit des points", value: `Base : ${points} pts` }
            )
            .setTimestamp();

        await interaction.update({ content: `🚨 ${roleToPing} Combat enregistré !`, embeds: [finalEmbed], components: [] });
        sessions.delete(interaction.user.id);
    }
});

client.login(process.env.TOKEN);