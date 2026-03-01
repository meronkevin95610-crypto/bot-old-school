const http = require('http');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits 
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- SERVEUR RENDER (Maintien en vie) ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Bot Perco V3.6 - Stable & Corrected");
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

// --- BASE DE DONNÉES AVEC AUTO-REPAIR ---
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    // Crée la table si elle n'existe pas
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
    
    // Ajoute les colonnes une par une si elles manquent (évite l'erreur SQLITE_ERROR)
    const columns = [
        "joueur_id TEXT",
        "joueur_nom TEXT",
        "points REAL",
        "issue TEXT",
        "cote TEXT",
        "nb_allies INTEGER",
        "date TEXT"
    ];
    columns.forEach(col => {
        db.run(`ALTER TABLE attaques ADD COLUMN ${col}`, (err) => {
            // On ignore l'erreur si la colonne existe déjà
        });
    });
});

const sessions = new Map();

// --- FONCTION CLASSEMENT ---
async function getLeaderboard() {
    return new Promise((resolve) => {
        const query = `
            SELECT joueur_nom, 
            COUNT(*) as total_c, 
            SUM(CASE WHEN issue = 'Victoire' THEN 1 ELSE 0 END) as vics, 
            SUM(CASE WHEN issue = 'Défaite' THEN 1 ELSE 0 END) as defs, 
            SUM(points) as pts 
            FROM attaques 
            GROUP BY joueur_id 
            ORDER BY pts DESC 
            LIMIT 10`;

        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("Aucune donnée enregistrée.");
            
            let text = "🏆 **CLASSEMENT DE LA GUILDE** 🏆\n```\n";
            text += "Nom            | Cbt | V | D | Pts   | Ratio\n";
            text += "-----------------------------------------------\n";
            
            rows.forEach(row => {
                const ratio = row.total_c > 0 ? ((row.vics / row.total_c) * 100).toFixed(0) + "%" : "0%";
                const name = (row.joueur_nom || "Inconnu").substring(0, 14).padEnd(14);
                const cbt = String(row.total_c).padEnd(3);
                const v = String(row.vics).padEnd(1);
                const d = String(row.defs).padEnd(1);
                const p = (row.pts || 0).toFixed(2).padEnd(5);
                
                text += `${name} | ${cbt} | ${v} | ${d} | ${p} | ${ratio}\n`;
            });
            text += "```";
            resolve(text);
        });
    });
}

// --- ÉVÉNEMENTS ---
client.on('ready', () => {
    console.log(`✅ Bot Opérationnel : ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Commande RESET (Admin uniquement)
    if (message.content === '!reset') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply("❌ Erreur : Vous devez être Administrateur pour reset le classement.");
        }
        db.run(`DELETE FROM attaques`, (err) => {
            if (err) return message.reply("Erreur lors du reset.");
            message.channel.send("🔄 **Le classement a été réinitialisé à zéro !**");
        });
    }

    // Commande CLASSEMENT
    if (message.content === '!classement') {
        const board = await getLeaderboard();
        return message.channel.send(board);
    }

    // Commande RESULTAT
    if (message.content === '!resultat' || message.content === '!resulta') {
        sessions.set(message.author.id, { participants: [], cote: null, issue: null, nb_allies: 4 });
        
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('select_users')
                .setPlaceholder('Qui a participé ?')
                .setMinValues(1)
                .setMaxValues(4)
        );
        
        await message.reply({ 
            content: "⚔️ **Saisie de résultat** : Sélectionnez les joueurs :", 
            components: [menu] 
        });
    }
});

client.on('interactionCreate', async (interaction) => {
    const session = sessions.get(interaction.user.id);
    if (!session) return;

    // 1. Sélection des membres
    if (interaction.isUserSelectMenu()) {
        session.participants = interaction.users.map(u => ({ id: u.id, name: u.username }));
        const rowNb = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('nb_allies').setPlaceholder('Nombre d\'alliés').addOptions([
                { label: '4 alliés (Normal)', value: '4' },
                { label: '3 alliés (+2 pts bonus)', value: '3' },
                { label: '2 alliés (+2 pts bonus)', value: '2' }
            ])
        );
        await interaction.update({ content: "👥 Joueurs sélectionnés. Combien d'alliés étiez-vous ?", components: [rowNb] });
    }

    // 2. Sélection du nombre d'alliés
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
        await interaction.update({ content: "Dét