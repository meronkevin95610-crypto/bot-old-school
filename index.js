// index.js
const http = require('http');
const { Client, GatewayIntentBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- BLOC INDISPENSABLE POUR RENDER ---
// Correction : On s'assure que le serveur répond sur toutes les interfaces (0.0.0.0)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write("Le bot est en ligne !");
    res.end();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur de monitoring actif sur le port ${PORT}`);
});
// ---------------------------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // REQUIS : À activer dans le Discord Dev Portal
        GatewayIntentBits.GuildPresences  // Ajouté pour correspondre aux réglages standards
    ]
});

// Connexion à la base de données
const db = new sqlite3.Database('./stats.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS attaques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        joueur TEXT,
        victoires INTEGER,
        defaites INTEGER,
        date TEXT
    )`);
});

// ID du rôle à ping (Assure-toi que c'est bien l'ID numérique)
const roleToPing = "<@&1476632455669743666>";

client.on('ready', () => {
    console.log(`✅ Connecté en tant que ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Commande !attaque
    if (message.content.startsWith('!attaque')) {
        const args = message.content.split(' ').filter(arg => arg !== '');
        if (args.length < 4) {
            return message.reply("⚠️ Utilisation : `!attaque Pseudo Victoires Defaites` (ex: !attaque Meron 2 1)");
        }

        const joueur = args[1];
        const victoires = parseInt(args[2]);
        const defaites = parseInt(args[3]);

        if (isNaN(victoires) || isNaN(defaites)) {
            return message.reply("❌ Les victoires et défaites doivent être des nombres.");
        }

        db.run(
            `INSERT INTO attaques (joueur, victoires, defaites, date) VALUES (?, ?, ?, datetime('now'))`,
            [joueur, victoires, defaites],
            function(err) {
                if (err) return console.error(err.message);
                
                message.channel.send(
                    `🚨 ${roleToPing} Nouvelle attaque enregistrée !\n\n` +
                    `👤 **Joueur** : ${joueur}\n` +
                    `🏆 **Victoires** : ${victoires}\n` +
                    `💀 **Défaites** : ${defaites}\n` +
                    `📅 **Date** : ${new Date().toLocaleString('fr-FR')}`
                );
            }
        );
    }

    // Commande !classement
    if (message.content === '!classement') {
        db.all(`
            SELECT joueur, 
            SUM(victoires) as total_v, 
            SUM(defaites) as total_d 
            FROM attaques 
            GROUP BY joueur 
            ORDER BY total_v DESC 
            LIMIT 10
        `, [], (err, rows) => {
            if (err) return console.error(err.message);
            if (!rows || rows.length === 0) return message.channel.send("Aucune donnée enregistrée.");

            let reply = "🏆 **Classement de la Guilde (Top 10)** :\n```\n";
            rows.forEach((row, index) => {
                reply += `${index + 1}. ${row.joueur.padEnd(15)} | ${row.total_v}V - ${row.total_d}D\n`;
            });
            reply += "```";
            message.channel.send(reply);
        });
    }

    // Commande !stats
    if (message.content.startsWith('!stats')) {
        const args = message.content.split(' ');
        const joueur = args[1];
        if (!joueur) return message.reply("Utilisation : `!stats Pseudo`");

        db.get(`
            SELECT SUM(victoires) as total_v, SUM(defaites) as total_d 
            FROM attaques WHERE joueur = ?
        `, [joueur], (err, row) => {
            if (err) return console.error(err.message);
            if (!row || row.total_v === null) return message.channel.send(`Aucune stat pour **${joueur}**.`);

            message.channel.send(
                `📊 **Stats de ${joueur}** :\n` +
                `- Victoires : ${row.total_v}\n` +
                `- Défaites : ${row.total_d}\n` +
                `- Ratio : ${((row.total_v / (row.total_v + row.total_d)) * 100).toFixed(1)}%`
            );
        });
    }
});

// Gestion des erreurs pour éviter que le bot ne crash
process.on('unhandledRejection', error => console.error('Erreur non gérée :', error));

client.login(process.env.TOKEN);