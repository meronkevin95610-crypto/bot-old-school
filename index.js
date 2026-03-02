const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- 1. SERVEUR ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Guilde V6.2 - Fixed Syntax");
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
const msgCooldowns = new Set();

// --- 3. CLASSEMENT ---
async function getFullLeaderboard() {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc, 
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(CASE WHEN issue='Défaite' THEN 1 ELSE 0 END) as d, 
                       SUM(points) as p 
                       FROM attaques GROUP BY joueur_id ORDER BY p DESC`;
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucune donnée enregistrée.");
            let txt = "🏆 **CLASSEMENT GÉNÉRAL** 🏆\n```\nNom            | Cbt | V | D | Pts  | Ratio\n--------------------------------------------\n";
            rows.forEach(r => {
                const ratio = r.tc > 0 ? ((r.v / r.tc) * 100).toFixed(0) + "%" : "0%";
                txt += `${(r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14)} | ${String(r.tc).padEnd(3)} | ${r.v} | ${r.d} | ${r.p.toFixed(2).padEnd(5)} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- 4. COMMANDES ---
client.on('ready', () => console.log(`✅ Bot en ligne : ${client.user.tag}`));

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    const cooldownKey = `${m.author.id}-${m.content}`;
    if (msgCooldowns.has(cooldownKey)) return;
    msgCooldowns.add(cooldownKey);
    setTimeout(() => msgCooldowns.delete(cooldownKey), 2000);

    if (m.content === '!classement') {
        const board = await getFullLeaderboard();
        return m.reply(board);
    }
    if (m.content === '!resultat') {
        sessions.set(m.author.id, { participants: [] });
        const menu = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('sel_u').setPlaceholder('👥 Qui a participé ?').setMinValues(1).setMaxValues(4));
        return m.reply({ content: "⚔️ **Saisie de combat**", components: [menu] });
    }
    if (m.content === '!stuff') {
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('view_classe').setPlaceholder('🛡️ Choisis une classe').addOptions(CLASSES_DOFUS.map(c => ({ label: c, value: c }))));
        return m.reply({ content: "🔎 **Bibliothèque**", components: [row] });
    }
    if (m.content === '!addstuff') {
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('add_classe').setPlaceholder('➕ Quelle classe ?').addOptions(CLASSES_DOFUS.map(c => ({ label: c, value: c }))));
        return m.reply({ content: "➕ **Ajouter un stuff**", components: [row] });
    }
});

// --- 5. INTERACTIONS ---
client.on('interactionCreate', async (i) => {
    const userId = i.user.id;

    if (i.isStringSelectMenu() && i.customId === 'view_classe') {
        const classe = i.values[0];
        db.all(`SELECT * FROM metapano WHERE classe = ?`, [classe], (err, rows) => {
            const embed = new EmbedBuilder().setTitle(`🛡️ Stuffs : ${classe}`).setColor('#3498db');
            let desc = (rows && rows.length > 0) ? rows.map(r => `• **${r.element}** : ${r.description}\n🔗 [Lien](${r.lien})`).join('\n\n') : "Aucun stuff.";
            embed.setDescription(desc);
            return i.reply({ embeds: [embed], ephemeral: true });
        });
    }

    if (i.isStringSelectMenu() && i.customId === 'add_classe') {
        const modal = new ModalBuilder().setCustomId(`modal_add_${i.values[0]}`).setTitle(`Nouveau Stuff ${i.values[0]}`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('elem').setLabel("Élément").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel("Description").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('link').setLabel("Lien").setStyle(TextInputStyle.Short).setRequired(true))
        );
        return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId.startsWith('modal_add_')) {
        const classe = i.customId.split('_')[2];
        const [elem, desc, link] = ['elem', 'desc', 'link'].map(id => i.fields.getTextInputValue(id));
        db.run(`INSERT INTO metapano (auteur, classe, element, description, lien) VALUES (?, ?, ?, ?, ?)`, [i.user.username, classe, elem, desc, link], () => {
            i.reply({ content: `✅ Stuff **${classe} ${elem}** ajouté !` });
        });
    }

    let s = sessions.get(userId);
    if (i.isUserSelectMenu() && i.customId === 'sel_u') {
        if(!s) return;
        s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
        const r = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('sel_f').setPlaceholder('2. Format ?').addOptions([{ label: '4 alliés', value: '4' }, { label: '3 alliés (+0.75)', value: '3' }, { label: '2 alliés (+0.75)', value: '2' }]));
        return i.update({ content: `👉 **Format ?**`, components: [r] });
    }

    if (i.isStringSelectMenu() && i.customId === 'sel_f') {
        if (!s) return;
        s.nb_allies = parseInt(i.values[0]);
        const r1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary));
        const r2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary));
        return i.update({ content: `👉 **Issue ?**`, components: [r1, r2] });
    }

    if (i.isButton() && ['att', 'def', 'win', 'lose'].includes(i.customId)) {
        if (!s) return;
        if (['att', 'def'].includes(i.customId)) s.cote = i.customId === 'att' ? "Attaque" : "Défense";
        if (['win', 'lose'].includes(i.customId)) s.issue = i.customId === 'win' ? "Victoire" : "Défaite";

        if (s.cote && s.issue) {
            let pts = (s.issue === "Victoire" ? 1.0 : 0.25) + (s.nb_allies < 4 ? 0.75 : 0);
            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_allies, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            s.participants.forEach(p => stmt.run(p.id, p.name, pts, s.issue, s.cote, s.nb_allies));
            stmt.finalize();
            sessions.delete(userId);
            const b = await getFullLeaderboard();
            return i.update({ content: `✅ Enregistré !`, components: [], embeds: [new EmbedBuilder().setDescription(b).setColor('#2ecc71')] });
        } else {
            return i.update({ content: `👉 **${s.cote || '?'}** | **${s.issue || '?'}**` });
        }
    }
});

client.login(process.env.TOKEN);