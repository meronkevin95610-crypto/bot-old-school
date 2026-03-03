const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// --- 1. SERVEUR HTTP (Priorité Render) ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Système Multi-Bot V6.0 - Opérationnel");
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Serveur actif sur le port ${PORT}`);
});

// --- 2. CONFIGURATION ---
let config = {};
if (fs.existsSync('./config.json')) {
    config = require('./config.json');
} else {
    config = {
        tokenGestion: process.env.tokenGestion,
        tokenPerco: process.env.tokenPerco,
        clientIdPerco: process.env.clientIdPerco,
        guildId: process.env.guildId
    };
}

const ID_SALON_ARCHIVE = "1477765166467911765";
let percoSettings = { mainChannelId: null, logChannelId: null, pingRoleId: null };

if (fs.existsSync('./settings.json')) {
    try {
        const data = fs.readFileSync('./settings.json', 'utf8');
        if (data.trim()) percoSettings = JSON.parse(data);
    } catch (e) { console.log("Init settings..."); }
}

// --- 3. BASE DE DONNÉES ---
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");
    db.run(`CREATE TABLE IF NOT EXISTS attaques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        joueur_id TEXT, joueur_nom TEXT, points REAL, issue TEXT,
        cote TEXT, nb_ennemis INTEGER, date TEXT, session_token TEXT
    )`);
});

const sessions = new Map();

// --- 4. INITIALISATION DES CLIENTS ---
const botGestion = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const botPerco = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// --- 5. LOGIQUE GESTION ---
async function getLeaderboard(limit = 15) {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, SUM(points) as p, COUNT(*) as total FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT ${limit}`;
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucun score enregistré.");
            let txt = "```\nNom            | Pts   | Combats\n--------------------------------\n";
            rows.forEach(r => {
                const nom = (r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14);
                const pts = (r.p || 0).toFixed(1).padEnd(5);
                const count = String(r.total).padEnd(3);
                txt += `${nom} | ${pts} | ${count}\n`;
            });
            resolve(txt + "```");
        });
    });
}

botGestion.on('ready', () => console.log(`🚀 Bot Gestion prêt : ${botGestion.user.tag}`));

// ... (Le reste de ta logique botGestion.on messageCreate / interactionCreate est conservé)

// --- 6. LOGIQUE BOT PERCO (CORRIGÉE) ---
const percoCommands = [
    new SlashCommandBuilder().setName('configurer').setDescription('Paramètres alerte').addChannelOption(o => o.setName('general').setDescription('Salon Alerte')).addChannelOption(o => o.setName('logs').setDescription('Salon Logs')).addRoleOption(o => o.setName('role').setDescription('Rôle à pinger')),
    new SlashCommandBuilder().setName('setup-bouton').setDescription('Affiche le bouton d\'alerte')
].map(c => c.toJSON());

botPerco.on('ready', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(config.tokenPerco);
        await rest.put(Routes.applicationCommands(config.clientIdPerco), { body: percoCommands });
        console.log(`✅ Bot Perco prêt : ${botPerco.user.tag}`);
    } catch (error) { console.error("❌ REST Error:", error); }
});

botPerco.on('interactionCreate', async (i) => {
    try {
        if (i.isChatInputCommand()) {
            // AJOUT : On prévient Discord qu'on traite la demande pour éviter le timeout
            await i.deferReply({ ephemeral: true }); 

            if (i.commandName === 'configurer') {
                if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.editReply("Admin requis");
                
                percoSettings.mainChannelId = i.options.getChannel('general')?.id || percoSettings.mainChannelId;
                percoSettings.logChannelId = i.options.getChannel('logs')?.id || percoSettings.logChannelId;
                percoSettings.pingRoleId = i.options.getRole('role')?.id || percoSettings.pingRoleId;
                
                fs.writeFileSync('./settings.json', JSON.stringify(percoSettings, null, 2));
                await i.editReply("✅ Configuration mise à jour !");
            }

            if (i.commandName === 'setup-bouton') {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('alerte_perco').setLabel('Attaque Perco').setEmoji('🚨').setStyle(ButtonStyle.Danger)
                );
                // On utilise followUp ou on change le mode de réponse car setup-bouton doit souvent être visible par tous
                await i.channel.send({ content: '📌 **Bouton d\'alerte actif.**', components: [row] });
                await i.editReply("Bouton généré.");
            }
        }

        if (i.isButton() && i.customId === 'alerte_perco') {
            const roleMention = percoSettings.pingRoleId ? `<@&${percoSettings.pingRoleId}>` : "@everyone";
            const msg = `🚨 **ALERTE DÉCLENCHÉE PAR <@${i.user.id}>** 🚨\n\n${roleMention} GO DEF 🔥 Soin / Ero / Bouclier / Placeur 🚨`;
            
            const chan = botPerco.channels.cache.get(percoSettings.mainChannelId);
            if (chan) await chan.send(msg);
            
            const logChan = botPerco.channels.cache.get(percoSettings.logChannelId);
            if (logChan) await logChan.send(`🛡️ **LOG :** **${i.user.tag}** a lancé l'alerte.`);
            
            await i.reply({ content: 'Alerte envoyée !', ephemeral: true });
        }
    } catch (err) { console.error("Interaction Error:", err); }
});

// --- 7. CONNEXION ---
botGestion.login(config.tokenGestion);
botPerco.login(config.tokenPerco);
