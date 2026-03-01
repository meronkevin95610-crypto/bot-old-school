const http = require('http');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder 
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- SERVEUR RENDER ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Bot Perco V3.1 - Tableau Ordonne");
    res.end();
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
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
    // Sécurité colonnes
    const cols = ["joueur_id", "joueur_nom", "points", "issue", "cote", "nb_allies"];
    cols.forEach(c => db.run(`ALTER TABLE attaques ADD COLUMN ${c} TEXT`, (err) => {}));
});

const sessions = new Map();

// --- CLASSEMENT RÉORDONNÉ ---
async function getLeaderboard() {
    return new Promise((resolve) => {
        const query = `
            SELECT joueur_nom, 
            COUNT(*) as total_c,
            SUM(CASE WHEN issue = 'Victoire' THEN 1 ELSE 0 END) as vics,
            SUM(CASE WHEN issue = 'Défaite' THEN 1 ELSE 0 END) as defs,
            SUM(points) as pts
            FROM attaques GROUP BY joueur_id ORDER BY pts DESC LIMIT 10`;

        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("Aucune donnée.");

            let text = "🏆 **CLASSEMENT DE LA GUILDE** 🏆\n```\n";
            // Ordre : Nom / Combats / Victoires / Défaites / Points / Ratio
            text += "Nom            | Cbt | V | D | Pts   | Ratio\n";
            text += "-----------------------------------------------\n";
            rows.forEach(row => {
                const ratio = ((row.vics / row.total_c) * 100).toFixed(0) + "%";
                const name = row.joueur_nom.substring(0, 14).padEnd(14);
                const cbt = String(row.total_c).padEnd(3);
                const v = String(row.vics).padEnd(1);
                const d = String(row.defs).padEnd(1);
                const p = row.pts.toFixed(2).padEnd(5);
                
                text += `${name} | ${cbt} | ${v} | ${d} | ${p} | ${ratio}\n`;
            });
            text += "```";
            resolve(text);
        });
    });
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.content === '!classement') {
        const board = await getLeaderboard();
        return message.channel.send(board);
    }
    if (message.content === '!attaque') {
        sessions.set(message.author.id, { participants: [], cote: null, issue: null, nb_allies: 4 });
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('select_users').setPlaceholder('Sélectionner les participants...').setMinValues(1).setMaxValues(4)
        );
        await message.reply({ content: "⚔️ **Nouvelle saisie :** Qui a participé ?", components: [menu] });
    }
});

client.on('interactionCreate', async (interaction) => {
    const session = sessions.get(interaction.user.id);
    if (!session) return;

    if (interaction.isUserSelectMenu()) {
        session.participants = interaction.users.map(u => ({ id: u.id, name: u.username }));
        const rowNb = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('nb_allies').setPlaceholder('Nombre d\'alliés').addOptions([
                { label: '4 alliés (Normal)', value: '4' },
                { label: '3 alliés (+2 pts bonus)', value: '3' },
                { label: '2 alliés (+2 pts bonus)', value: '2' }
            ])
        );
        await interaction.update({ content: "Combien étiez-vous ?", components: [rowNb] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'nb_allies') {
        session.nb_allies = parseInt(interaction.values[0]);
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary)
        );
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
        );
        await interaction.update({ content: "Détails du combat :", components: [row1, row2] });
    }

    if (interaction.isButton()) {
        if (['att', 'def'].includes(interaction.customId)) session.cote = interaction.customId === 'att' ? "Attaque" : "Défense";
        if (['win', 'lose'].includes(interaction.customId)) session.issue = interaction.customId === 'win' ? "Victoire" : "Défaite";

        if (session.cote && session.issue) {
            let pts = session.issue === "Victoire" ?