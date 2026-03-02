const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- 1. SERVEUR DE MAINTIEN ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Guilde V6.1 - Anti-Doublon Actif");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- 2. BASE DE DONNÉES ---
const db = new sqlite3.Database('./stats.db');
const CLASSES_DOFUS = ["Cra", "Ecaflip", "Eliotrope", "Eniripsa", "Enutrof", "Feca", "Iop", "Osamodas", "Pandawa", "Sacrieur", "Sadida", "Sram", "Steamer", "Xelor", "Zobal"];

db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT, joueur_id TEXT, joueur_nom TEXT, points REAL, issue TEXT, cote TEXT, nb_allies INTEGER, date TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS metapano (id INTEGER PRIMARY KEY AUTOINCREMENT, auteur TEXT, classe TEXT, element TEXT, description TEXT, lien TEXT)`);
});

const sessions = new Map();
const msgCooldowns = new Set(); // Système anti-double message

// --- 3. FONCTION CLASSEMENT ILLIMITÉ ---
async function getFullLeaderboard() {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc, 
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(CASE WHEN issue='Défaite' THEN 1 ELSE 0 END) as d, 
                       SUM(points) as p 
                       FROM attaques GROUP BY joueur_id ORDER BY p DESC`;
        
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucune donnée enregistrée.");
            let txt = `🏆 **CLASSEMENT GÉNÉRAL** 🏆\n\`\`\`\nNom            | Cbt | V | D | Pts  | Ratio\n--------------------------------------------\n`;
            rows.forEach(r => {
                const ratio = r.tc > 0 ? ((r.v / r.tc) * 100).toFixed(0) + "%" : "0%";
                txt += `${(r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14)} | ${String(r.tc).padEnd(3)} | ${r.v} | ${r.d} | ${r.p.toFixed(2).padEnd(5)} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- 4. COMMANDES AVEC ANTI-DOUBLON ---
client.on('ready', () => console.log(`✅ Bot en ligne : ${client.user.tag}`));

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    // --- LOGIQUE ANTI-DOUBLON ---
    const cooldownKey = `${m.author.id}-${m.content}`;
    if (msgCooldowns.has(cooldownKey)) return; // Ignore si commande répétée trop vite
    msgCooldowns.add(cooldownKey);
    setTimeout(() => msgCooldowns.delete(cooldownKey), 2000); // Reset après 2 secondes

    if (m.content === '!classement') {
        const board = await getFullLeaderboard();
        return m.reply(board);
    }

    if (m.content === '!resultat') {
        sessions.set(m.author.id, { participants: [] });
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('sel_u').setPlaceholder('👥 Sélectionne les participants (1 à 4)').setMinValues(1).setMaxValues(4)
        );
        return m.reply({ content: "⚔️ **Début de la saisie du combat**", components: [menu] });
    }

    if (m.content === '!stuff') {
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('view_classe').setPlaceholder('🛡️ Choisis une classe').addOptions(CLASSES_DOFUS.map(c => ({ label: c, value: c })))
        );
        return m.reply({ content: "🔎 **Bibliothèque des Stuffs**", components: [row] });
    }

    if (m.content === '!addstuff') {
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('add_classe').setPlaceholder('➕ Ajouter pour quelle classe ?').addOptions(CLASSES_DOFUS.map(c => ({ label: c, value: c })))
        );
        return m.reply({ content: "➕ **Enregistrer un nouveau stuff**", components: [row] });
    }
});

// --- 5. LOGIQUE DES INTERACTIONS ---
client.on('interactionCreate', async (i) => {
    const userId = i.user.id;

    // CONSULTATION STUFF
    if (i.isStringSelectMenu() && i.customId === 'view_classe') {
        const classe = i.values[0];
        db.all(`SELECT * FROM metapano WHERE classe = ?`, [classe], (err, rows) => {
            const embed = new EmbedBuilder().setTitle(`🛡️ Stuffs : ${classe}`).setColor('#3498db');
            let desc = (rows && rows.length > 0) ? rows.map(r => `• **${r.element}** : ${r.description}\n🔗 [Lien](${r.lien}) (par ${r.auteur})`).join('\n\n') : "Auc