const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const fs = require('fs');

// --- 1. CONFIGURATION (Adaptée pour Render & Local) ---
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
        if (data.trim() !== "" && data.trim() !== "{}") {
            percoSettings = JSON.parse(data);
        }
    } catch (e) { console.log("Initialisation settings..."); }
}

// Serveur Keep-Alive pour Render
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Système Multi-Bot V6.0 - Gestion & Alerte Perco Actif");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

// --- 2. INITIALISATION DES CLIENTS ---
const botGestion = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const botPerco = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

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

// --- 4. FONCTIONS GESTION ---
function calculerPoints(cote, issue, ennemis) {
    if (issue === "Défaite") return (cote === "Défense") ? 1.0 : 0.0;
    if (ennemis === 0) return 0.25;
    if (cote === "Attaque") return (ennemis === 4) ? 5.0 : 3.0;
    return (ennemis === 4) ? 4.0 : 2.0;
}

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

// --- 5. LOGIQUE BOT GESTION (!top, !resultat) ---
botGestion.on('ready', () => console.log(`🚀 Bot Gestion prêt : ${botGestion.user.tag}`));

botGestion.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!top' || m.content === '!classement') {
        const board = await getLeaderboard(15);
        return m.reply(`🏆 **TOP 15 ACTUEL**\n${board}`);
    }

    if (m.content === '!topcomplet') {
        const board = await getLeaderboard(50);
        return m.reply(`📊 **CLASSEMENT GÉNÉRAL**\n${board}`);
    }

    if (m.content === '!resultat' || m.content === '!resulta') {
        const token = `ST-${Date.now()}-${m.author.id}`;
        sessions.set(m.author.id, { participants: [], cote: null, nb_ennemis: 4, processing: false, token: token });
        
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4)
        );
        await m.reply({ content: "⚔️ **Enregistrement de combat**", components: [menu] });
    }
});

botGestion.on('interactionCreate', async (i) => {
    const s = sessions.get(i.user.id);
    if (!s) return;

    if (i.isUserSelectMenu() && i.customId === 'u') {
        s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
        const r = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('cote').setPlaceholder('2. Côté ?')
            .addOptions([{ label: 'Attaque', value: 'att' }, { label: 'Défense', value: 'def' }])
        );
        return await i.update({ content: `✅ **${s.participants.length} joueurs** sélectionnés. 👉 **Côté ?**`, components: [r] });
    }

    if (i.isStringSelectMenu() && i.customId === 'cote') {
        s.cote = i.values[0] === 'att' ? "Attaque" : "Défense";
        const r = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('ennemis').setPlaceholder('3. Ennemis ?')
            .addOptions([{ label: '4 (Full)', value: '4' }, { label: '1-3', value: '3' }, { label: '0 (Abandon)', value: '0' }])
        );
        return await i.update({ content: `Côté : **${s.cote}**. 👉 **Nombre d'ennemis ?**`, components: [r] });
    }

    if (i.isStringSelectMenu() && i.customId === 'ennemis') {
        s.nb_ennemis = parseInt(i.values[0]);
        const r = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Danger)
        );
        return await i.update({ content: `Combat vs **${s.nb_ennemis}**. 👉 **Verdict ?**`, components: [r] });
    }

    if (i.isButton() && (i.customId === 'win' || i.customId === 'lose')) {
        if (s.processing) return;
        s.processing = true;
        await i.deferUpdate();

        const issue = i.customId === 'win' ? "Victoire" : "Défaite";
        const pts = calculerPoints(s.cote, issue, s.nb_ennemis);

        for (const p of s.participants) {
            db.run(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_ennemis, date, session_token) VALUES (?,?,?,?,?,?,date('now'),?)`, 
            [p.id, p.name, pts, issue, s.cote, s.nb_ennemis, s.token]);
        }

        setTimeout(async () => {
            const board = await getLeaderboard(15);
            const embed = new EmbedBuilder()
                .setTitle("📝 RÉCAPITULATIF COMBAT")
                .setDescription(`👥 **Team :** ${s.participants.map(p => p.name).join(', ')}\n⚔️ **Verdict :** ${issue} (${s.cote})\n🎖️ **Gain :** \`+${pts.toFixed(1)} pts\``)
                .setColor(issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                .addFields({ name: "🏆 CLASSEMENT", value: board });

            await i.editReply({ content: null, components: [], embeds: [embed] });
            const archive = botGestion.channels.cache.get(ID_SALON_ARCHIVE);
            if (archive) archive.send({ embeds: [embed] });
            sessions.delete(i.user.id);
        }, 1000);
    }
});

// --- 6. LOGIQUE BOT PERCO (Alerte Bouton Rouge) ---
const percoCommands = [
    new SlashCommandBuilder().setName('configurer').setDescription('Paramètres alerte').addChannelOption(o => o.setName('general').setDescription('Salon Alerte')).addChannelOption(o => o.setName('logs').setDescription('Salon Logs')).addRoleOption(o => o.setName('role').setDescription('Rôle à pinger')),
    new SlashCommandBuilder().setName('setup-bouton').setDescription('Affiche le bouton d\'alerte')
].map(c => c.toJSON());

botPerco.on('ready', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(config.tokenPerco);
        await rest.put(Routes.applicationCommands(config.clientIdPerco), { body: percoCommands });
        console.log(`✅ Bot Perco prêt : ${botPerco.user.tag} (Commandes Globales)`);
    } catch (error) {
        console.error("❌ Erreur Slash Commands :", error);
    }
});

botPerco.on('interactionCreate', async (i) => {
    try {
        if (i.isChatInputCommand()) {
            if (i.commandName === 'configurer') {
                if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: "Admin requis", ephemeral: true });
                percoSettings.mainChannelId = i.options.getChannel('general')?.id || percoSettings.mainChannelId;
                percoSettings.logChannelId = i.options.getChannel('logs')?.id || percoSettings.logChannelId;
                percoSettings.pingRoleId = i.options.getRole('role')?.id || percoSettings.pingRoleId;
                fs.writeFileSync('./settings.json', JSON.stringify(percoSettings, null, 2));
                await i.reply({ content: "✅ Configuration mise à jour !", ephemeral: true });
            }
            if (i.commandName === 'setup-bouton') {
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('alerte_perco').setLabel('Attaque Perco').setEmoji('🚨').setStyle(ButtonStyle.Danger));
                await i.reply({ content: '📌 **Bouton d\'alerte actif.**', components: [row] });
            }
        }

        if (i.isButton() && i.customId === 'alerte_perco') {
            const roleMention = percoSettings.pingRoleId ? `<@&${percoSettings.pingRoleId}>` : "@everyone";
            const msg = `🚨 **ALERTE DÉCLENCHÉE PAR <@${i.user.id}>** 🚨\n\n${roleMention} GO DEF 🔥 Soin / Ero / Bouclier / Placeur 🚨\nS’annoncer en canal guilde, priorité aux optis 🏹`;
            const chan = botPerco.channels.cache.get(percoSettings.mainChannelId);
            if (chan) await chan.send(msg);
            const logChan = botPerco.channels.cache.get(percoSettings.logChannelId);
            if (logChan) await logChan.send(`🛡️ **LOG :** **${i.user.tag}** a lancé l'alerte.`);
            await i.reply({ content: 'Alerte envoyée !', ephemeral: true });
        }
    } catch (err) {
        console.error(err);
    }
});

// --- 7. CONNEXION ---
botGestion.login(config.tokenGestion);
botPerco.login(config.tokenPerco);
