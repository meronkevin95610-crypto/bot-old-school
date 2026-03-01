const http = require('http');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits 
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- SERVEUR RENDER ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Bot Perco V3.5 - Version Finale Stable");
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
            if (err || !rows || rows.length === 0) return resolve("Aucune donnée enregistrée.");
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

    // 1. Commande RESET (Admin uniquement)
    if (message.content === '!reset') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply("❌ Tu n'as pas la permission `Administrateur` !");
        }
        db.run(`DELETE FROM attaques`, (err) => {
            if (err) return message.reply("Erreur : " + err.message);
            message.channel.send({ embeds: [new EmbedBuilder().setTitle("🔄 Reset").setDescription("Le classement a été remis à zéro !").setColor("Orange")] });
        });
    }

    // 2. Commande RESULTAT
    if (message.content === '!resultat' || message.content === '!resulta') {
        sessions.set(message.author.id, { participants: [], cote: null, issue: null, nb_allies: 4 });
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('select_users').setPlaceholder('Joueurs...').setMinValues(1).setMaxValues(4)
        );
        await message.reply({ content: "⚔️ **Nouveau résultat** : Sélectionnez les joueurs :", components: [menu] });
    }

    // 3. Commande CLASSEMENT
    if (message.content === '!classement') {
        const board = await getLeaderboard();
        message.channel.send(board);
    }
});

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
        await interaction.update({ content: "Combien d'alliés étiez-vous ?", components: [rowNb] });
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
        const id = interaction.customId;
        if (['att', 'def'].includes(id)) session.cote = (id === 'att' ? "Attaque" : "Défense");
        if (['win', 'lose'].includes(id)) session.issue = (id === 'win' ? "Victoire" : "Défaite");

        if (session.cote && session.issue) {
            let pts = session.issue === "Victoire" ? 1.0 : 0.25;
            if (session.nb_allies < 4) pts += 2.0;

            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_allies, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            session.participants.forEach(p => stmt.run(p.id, p.name, pts, session.issue, session.cote, session.nb_allies));
            stmt.finalize();

            const listeNoms = session.participants.map(p => `**${p.name}**`).join(', ');
            const action = session.issue === "Victoire" ? "réalisé une **Victoire**" : "subi une **Défaite**";
            
            const embed = new EmbedBuilder()
                .setTitle("🚨 Résultat Enregistré")
                .setDescription(`${listeNoms} vient de ${action} en **${session.cote}** (${session.nb_allies}v4) !`)
                .setColor(session.issue === "Victoire" ? "Green" : "Red")
                .addFields(
                    { name: "🎖️ Points", value: `+${pts.toFixed(2)} pts chacun`, inline: true },
                    { name: "👤 Saisi par", value: interaction.user.username, inline: true }
                )
                .setTimestamp();

            await interaction.update({ content: "✅ Stats mises à jour !", components: [], embeds: [embed] });
            const board = await getLeaderboard();
            await interaction.channel.send(board);
            sessions.delete(interaction.user.id);
        } else {
            await interaction.update({ content: `Sélection : **${session.cote || '?'}** | **${session.issue || '?'}**` });
        }
    }
});

client.login(process.env.TOKEN);