const http = require('http');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder 
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- SERVEUR RENDER ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Bot Perco V3.0 - Ratio & Bonus Actif");
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
        type TEXT,
        issue TEXT,
        cote TEXT,
        nb_allies INTEGER,
        date TEXT
    )`);
    // Mise à jour des colonnes si nécessaire
    const cols = ["joueur_id", "joueur_nom", "points", "type", "issue", "cote", "nb_allies"];
    cols.forEach(c => db.run(`ALTER TABLE attaques ADD COLUMN ${c} TEXT`, (err) => {}));
});

const sessions = new Map();

// --- CLASSEMENT AVEC RATIO ET POINTS PRÉCIS ---
async function getLeaderboard() {
    return new Promise((resolve) => {
        const query = `
            SELECT joueur_nom, 
            SUM(points) as total_pts,
            COUNT(*) as total_combats,
            SUM(CASE WHEN issue = 'Victoire' THEN 1 ELSE 0 END) as victoires
            FROM attaques GROUP BY joueur_id ORDER BY total_pts DESC LIMIT 10`;

        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("Aucune donnée.");

            let text = "🏆 **CLASSEMENT ACTIVITÉ & RATIO** 🏆\n```\n";
            text += "Pseudo          | Pts   | Ratio | Combats\n";
            text += "------------------------------------------\n";
            rows.forEach(row => {
                const ratio = ((row.victoires / row.total_combats) * 100).toFixed(0);
                const name = row.joueur_nom.substring(0, 15).padEnd(15);
                const pts = row.total_pts.toFixed(2).padEnd(5);
                text += `${name} | ${pts} | ${ratio}%  | ${row.total_combats}\n`;
            });
            text += "```";
            resolve(text);
        });
    });
}

client.on('messageCreate', async (message) => {
    if (message.author.bot || message.content !== '!attaque') return;

    sessions.set(message.author.id, { participants: [], cote: null, issue: null, type: null, nb_allies: 4 });
    
    const embed = new EmbedBuilder()
        .setTitle("⚔️ Saisie - Étape 1 : Équipe")
        .setDescription("Sélectionnez les participants.")
        .setColor("Blue");

    const menu = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId('select_users').setPlaceholder('Participants...').setMinValues(1).setMaxValues(4)
    );

    await message.reply({ embeds: [embed], components: [menu] });
});

client.on('interactionCreate', async (interaction) => {
    const session = sessions.get(interaction.user.id);
    if (!session) return;

    // 1. Sélection Joueurs
    if (interaction.isUserSelectMenu()) {
        session.participants = interaction.users.map(u => ({ id: u.id, name: u.username }));
        
        const embed = new EmbedBuilder()
            .setTitle("⚔️ Étape 2 : Configuration")
            .setDescription(`Équipe : ${session.participants.map(p => p.name).join(', ')}\nIndiquez si vous étiez en sous-nombre (ex: 3v4).`)
            .setColor("Yellow");

        const rowNb = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('nb_allies').setPlaceholder('Nombre d\'alliés').addOptions([
                { label: '4 alliés (Normal)', value: '4' },
                { label: '3 alliés (Bonus +2 pts)', value: '3' },
                { label: '2 alliés (Bonus +2 pts)', value: '2' }
            ])
        );

        await interaction.update({ embeds: [embed], components: [rowNb] });
    }

    // 2. Sélection Nombre Alliés
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

        await interaction.update({ content: "Choisissez le côté et l'issue :", components: [row1, row2] });
    }

    // 3. Boutons Finaux & Calcul Points
    if (interaction.isButton()) {
        if (['att', 'def'].includes(interaction.customId)) session.cote = interaction.customId === 'att' ? "Attaque" : "Défense";
        if (['win', 'lose'].includes(interaction.customId)) session.issue = interaction.customId === 'win' ? "Victoire" : "Défaite";

        if (session.cote && session.issue) {
            // --- BARÈME UTILISATEUR ---
            let pts = session.issue === "Victoire" ? 1.0 : 0.25; // 1 pt victoire, 0.25 pt défaite
            if (session.nb_allies < 4) pts += 2.0; // Bonus +2 pts si 3v4 ou moins

            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_allies, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            session.participants.forEach(p => stmt.run(p.id, p.name, pts, session.issue, session.cote, session.nb_allies));
            stmt.finalize();

            await interaction.update({ content: `✅ Enregistré ! Bonus appliqué : ${session.nb_allies < 4 ? '+2 pts' : 'Aucun'}`, components: [], embeds: [] });
            const board = await getLeaderboard();
            await interaction.channel.send(board);
            sessions.delete(interaction.user.id);
        } else {
            await interaction.update({ content: `Sélection : ${session.cote || '?'} | ${session.issue || '?'}` });
        }
    }
});

client.login(process.env.TOKEN);