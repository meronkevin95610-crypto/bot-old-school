const http = require('http');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, UserSelectMenuBuilder 
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- SERVEUR RENDER ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Bot Perco V2.5 - Stats Dissociees");
    res.end();
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- BASE DE DONNÉES AVEC RÉPARATION ---
const db = new sqlite3.Database('./stats.db');

db.serialize(() => {
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

    // Force l'ajout des colonnes pour éviter SQLITE_ERROR
    const cols = ["joueur_id", "joueur_nom", "points", "type", "issue", "cote"];
    cols.forEach(c => {
        db.run(`ALTER TABLE attaques ADD COLUMN ${c} TEXT`, (err) => {});
    });
});

const sessions = new Map();

// --- FONCTION CLASSEMENT DISSOCIÉ ---
async function getLeaderboard() {
    return new Promise((resolve) => {
        const query = `
            SELECT joueur_nom, 
            SUM(CASE WHEN cote = 'Attaque' THEN points ELSE 0 END) as pts_att,
            SUM(CASE WHEN cote = 'Défense' THEN points ELSE 0 END) as pts_def,
            SUM(points) as total
            FROM attaques GROUP BY joueur_id ORDER BY total DESC LIMIT 10`;

        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("Aucune donnée.");

            let text = "🏆 **CLASSEMENT GÉNÉRAL (TOP 10)** 🏆\n```\n";
            text += "Pseudo          | Att. | Def. | Total\n";
            text += "---------------------------------------\n";
            rows.forEach(row => {
                const name = row.joueur_nom.substring(0, 15).padEnd(15);
                text += `${name} | ${String(row.pts_att).padEnd(4)} | ${String(row.pts_def).padEnd(4)} | ${row.total} pts\n`;
            });
            text += "```";
            resolve(text);
        });
    });
}

client.on('ready', () => console.log(`✅ Bot Opérationnel : ${client.user.tag}`));

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!classement') {
        const board = await getLeaderboard();
        return message.channel.send(board);
    }

    if (message.content === '!attaque') {
        sessions.set(message.author.id, { participants: [], cote: null, issue: null, type: null });
        const embed = new EmbedBuilder().setTitle("⚔️ Saisie - Étape 1").setDescription("Sélectionnez les participants.").setColor("#5865F2");
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('select_users').setPlaceholder('Participants...').setMinValues(1).setMaxValues(4)
        );
        await message.reply({ embeds: [embed], components: [menu] });
    }
});

client.on('interactionCreate', async (interaction) => {
    const session = sessions.get(interaction.user.id);
    if (!session) return;

    if (interaction.isUserSelectMenu()) {
        session.participants = interaction.users.map(u => ({ id: u.id, name: u.username }));
        const embed = new EmbedBuilder().setTitle("⚔️ Étape 2").setDescription(`Équipe : ${session.participants.map(p => p.name).join(', ')}`).setColor("#FEE75C");
        const r1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary)
        );
        const r2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
        );
        const r3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('perco').setLabel('Percepteur').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('prisme').setLabel('Prisme').setStyle(ButtonStyle.Primary)
        );
        await interaction.update({ embeds: [embed], components: [r1, r2, r3] });
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
            let pts = session.issue === "Victoire" ? 5 : 2;
            if (session.type === "Percepteur") pts += 1;

            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, type, issue, cote, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            session.participants.forEach(p => stmt.run(p.id, p.name, pts, session.type, session.issue, session.cote));
            stmt.finalize();

            await interaction.update({ content: `✅ Stats enregistrées pour ${session.cote} !`, embeds: [], components: [] });
            const board = await getLeaderboard();
            await interaction.channel.send(board);
            sessions.delete(interaction.user.id);
        } else {
            await interaction.update({ content: `Choix : ${session.cote || '?'} | ${session.issue || '?'} | ${session.type || '?'}` });
        }
    }
});

client.login(process.env.TOKEN);