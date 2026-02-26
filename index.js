// index.js
const { Client, GatewayIntentBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const db = new sqlite3.Database('./stats.db');

// Création de la table si elle n'existe pas
db.run(`CREATE TABLE IF NOT EXISTS attaques (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    joueur TEXT,
    victoires INTEGER,
    defaites INTEGER,
    date TEXT
)`);

// Rôle guilde à ping (ID que tu m’as donné)
const roleToPing = "<@&1476632455669743666>";

client.on('messageCreate', (message) => {
    if (message.author.bot) return;

    // Commande pour signaler une attaque
    if (message.content.startsWith('!attaque')) {
        const args = message.content.split(' ');
        if (args.length < 4) {
            return message.reply("Utilisation : !attaque Pseudo Victoires Defaites");
        }

        const joueur = args[1];
        const victoires = parseInt(args[2]);
        const defaites = parseInt(args[3]);

        db.run(
            `INSERT INTO attaques (joueur, victoires, defaites, date)
             VALUES (?, ?, ?, datetime('now'))`,
            [joueur, victoires, defaites]
        );

        message.channel.send(
            `🚨 ${roleToPing} Nouvelle attaque !\n\n` +
            `👤 Joueur : ${joueur}\n` +
            `🏆 Victoires : ${victoires}\n` +
            `💀 Défaites : ${defaites}\n` +
            `📅 Date : ${new Date().toLocaleString()}`
        );
    }

    // Commande classement de la guilde
    if (message.content === '!classement') {
        db.all(`
            SELECT joueur,
            SUM(victoires) as total_v,
            SUM(defaites) as total_d
            FROM attaques
            GROUP BY joueur
            ORDER BY total_v DESC
        `, [], (err, rows) => {
            if (!rows.length) return message.channel.send("Aucune donnée enregistrée.");

            let reply = "🏆 Classement Guilde :\n\n";
            rows.forEach((row, index) => {
                reply += `${index + 1}. ${row.joueur} → ${row.total_v}V / ${row.total_d}D\n`;
            });
            message.channel.send(reply);
        });
    }

    // Commande stats d’un joueur spécifique
    if (message.content.startsWith('!stats')) {
        const args = message.content.split(' ');
        const joueur = args[1];
        if (!joueur) return message.reply("Utilisation : !stats Pseudo");

        db.get(`
            SELECT SUM(victoires) as total_v,
                   SUM(defaites) as total_d
            FROM attaques
            WHERE joueur = ?
        `, [joueur], (err, row) => {
            if (!row || row.total_v === null) return message.channel.send("Aucune stat trouvée pour ce joueur.");

            message.channel.send(
                `📊 Stats de ${joueur} :\n` +
                `🏆 Total Victoires : ${row.total_v}\n` +
                `💀 Total Défaites : ${row.total_d}`
            );
        });
    }
});

// Sécurité : le token Discord via variable d'environnement
client.login(process.env.TOKEN);