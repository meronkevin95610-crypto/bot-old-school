const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');

// --- 1. CONFIGURATION VISUELLE ---
const CLASSES_TOUCH = {
    "Cra": { emoji: "🏹", image: "https://r2.starry.io/dofus/gfx/illus/Cra.png" },
    "Ecaflip": { emoji: "🐱", image: "https://r2.starry.io/dofus/gfx/illus/Ecaflip.png" },
    "Eniripsa": { emoji: "🧚", image: "https://r2.starry.io/dofus/gfx/illus/Eniripsa.png" },
    "Enutrof": { emoji: "👴", image: "https://r2.starry.io/dofus/gfx/illus/Enutrof.png" },
    "Feca": { emoji: "🛡️", image: "https://r2.starry.io/dofus/gfx/illus/Feca.png" },
    "Iop": { emoji: "⚔️", image: "https://r2.starry.io/dofus/gfx/illus/Iop.png" },
    "Osamodas": { emoji: "🐉", image: "https://r2.starry.io/dofus/gfx/illus/Osamodas.png" },
    "Pandawa": { emoji: "🐼", image: "https://r2.starry.io/dofus/gfx/illus/Pandawa.png" },
    "Roublard": { emoji: "💣", image: "https://r2.starry.io/dofus/gfx/illus/Roublard.png" },
    "Sacrieur": { emoji: "🩸", image: "https://r2.starry.io/dofus/gfx/illus/Sacrieur.png" },
    "Sadida": { emoji: "🌳", image: "https://r2.starry.io/dofus/gfx/illus/Sadida.png" },
    "Sram": { emoji: "💀", image: "https://r2.starry.io/dofus/gfx/illus/Sram.png" },
    "Steamer": { emoji: "🐙", image: "https://r2.starry.io/dofus/gfx/illus/Steamer.png" },
    "Xelor": { emoji: "⏳", image: "https://r2.starry.io/dofus/gfx/illus/Xelor.png" },
    "Zobal": { emoji: "🎭", image: "https://r2.starry.io/dofus/gfx/illus/Zobal.png" }
};

// --- 2. INITIALISATION ---
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});
const db = new sqlite3.Database('./guilde_touch.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS combats (id INTEGER PRIMARY KEY AUTOINCREMENT, joueur_id TEXT, joueur_nom TEXT, points REAL, issue TEXT, type TEXT, date TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS shared_stuff (id INTEGER PRIMARY KEY AUTOINCREMENT, auteur TEXT, classe TEXT, element TEXT, mode TEXT, lien TEXT)`);
});

const sessions = new Map();

// --- 3. UPTIME SERVER ---
http.createServer((req, res) => { res.write("Bot Dofus Touch Online"); res.end(); }).listen(process.env.PORT || 3000);

// --- 4. FONCTIONS ---
async function showLeaderboard() {
    return new Promise((resolve) => {
        db.all(`SELECT joueur_nom, COUNT(*) as nb, SUM(points) as pts FROM combats GROUP BY joueur_id ORDER BY pts DESC LIMIT 10`, (err, rows) => {
            if (!rows || rows.length === 0) return resolve("Aucune donnée enregistrée.");
            let txt = "🏆 **TOP 10 GUILDE TOUCH** 🏆\n```\nNom            | Cbt | Pts\n---------------------------\n";
            rows.forEach(r => { txt += `${r.joueur_nom.substring(0, 14).padEnd(14)} | ${String(r.nb).padEnd(3)} | ${r.pts.toFixed(1)}\n`; });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- 5. COMMANDES ---
client.on('ready', () => console.log(`✅ Bot Opérationnel: ${client.user.tag}`));

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    const options = Object.keys(CLASSES_TOUCH).map(c => ({ label: c, value: c, emoji: CLASSES_TOUCH[c].emoji }));

    if (m.content === '!stuff') {
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('search_classe').setPlaceholder('Rechercher un stuff...').addOptions(options));
        return m.reply({ content: "🔎 **Recherche de Stuff Dofus Touch**\nChoisis une classe :", components: [row] });
    }

    if (m.content === '!ajouterstuff') {
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('add_c').setPlaceholder('Quelle classe ?').addOptions(options));
        return m.reply({ content: "📤 **Partage un stuff !**", components: [row] });
    }

    if (m.content === '!resultat') {
        sessions.set(m.author.id, { participants: [] });
        const menu = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('combat_users').setPlaceholder('Qui a combattu ?').setMinValues(1).setMaxValues(4));
        return m.reply({ content: "⚔️ **Enregistrement Combat**", components: [menu] });
    }

    if (m.content === '!classement') {
        const board = await showLeaderboard();
        return m.channel.send(board);
    }
});

// --- 6. INTERACTIONS ---
client.on('interactionCreate', async (i) => {
    const userId = i.user.id;

    // --- LOGIQUE RECHERCHE (PA/PM/PO) ---
    if (i.customId === 'search_classe') {
        sessions.set(userId, { search: { classe: i.values[0] } });
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('search_elem').setPlaceholder('Quel élément ?').addOptions(['Terre', 'Air', 'Feu', 'Eau', 'Multi'].map(e => ({ label: e, value: e }))));
        return i.update({ content: `✅ Classe : **${i.values[0]}**\nChoisis l'élément :`, components: [row] });
    }

    if (i.customId === 'search_elem') {
        sessions.get(userId).search.element = i.values[0];
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('search_pa').setPlaceholder('Combien de PA ?').addOptions(['9', '10', '11', '12'].map(v => ({ label: `${v} PA`, value: v }))));
        return i.update({ content: `✅ Élément : **${i.values[0]}**\nNombre de PA ?`, components: [row] });
    }

    if (i.customId === 'search_pa') {
        sessions.get(userId).search.pa = i.values[0];
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('search_pm').setPlaceholder('Combien de PM ?').addOptions(['4', '5', '6'].map(v => ({ label: `${v} PM`, value: v }))));
        return i.update({ content: `✅ PA : **${i.values[0]}**\nNombre de PM ?`, components: [row] });
    }

    if (i.customId === 'search_pm') {
        sessions.get(userId).search.pm = i.values[0];
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('search_po').setPlaceholder('Combien de PO ?').addOptions(['0', '1', '2', '3', '4', '5', '6'].map(v => ({ label: `${v} PO`, value: v }))));
        return i.update({ content: `✅ PM : **${i.values[0]}**\nNombre de PO ?`, components: [row] });
    }

    if (i.customId === 'search_po') {
        const s = sessions.get(userId).search;
        s.po = i.values[0];
        const dbLink = `https://www.dofusbook.net/fr/recherche?text=${s.classe}+${s.element}+${s.pa}pa+${s.pm}pm+${s.po}po+Touch`.replace(/ /g, '+');

        db.all(`SELECT * FROM shared_stuff WHERE classe = ? AND element = ?`, [s.classe, s.element], (err, rows) => {
            const embed = new EmbedBuilder().setTitle(`🎯 Résultats : ${s.classe} ${s.element}`).setColor('#2ecc71').setThumbnail(CLASSES_TOUCH[s.classe].image);
            let desc = `**Critères :** ${s.pa} PA | ${s.pm} PM | ${s.po} PO\n\n`;
            
            if (rows && rows.length > 0) {
                desc += "**📦 Builds de la Guilde :**\n" + rows.map(r => `• [${r.mode}](${r.lien}) (par ${r.auteur})`).join('\n');
            } else {
                desc += "*Aucun build guilde trouvé. Voici la recherche générale :*";
            }
            embed.setDescription(desc);
            const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Voir sur Dofusbook').setStyle(ButtonStyle.Link).setURL(dbLink));
            return i.update({ content: null, embeds: [embed], components: [btn] });
        });
    }

    // --- LOGIQUE AJOUT ---
    if (i.customId === 'add_c') {
        sessions.set(userId, { classe: i.values[0] });
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('add_e').setPlaceholder('Élément ?').addOptions(['Terre', 'Air', 'Feu', 'Eau', 'Multi'].map(e => ({ label: e, value: e }))));
        return i.update({ content: `✅ Classe : **${i.values[0]}**`, components: [row] });
    }

    if (i.customId === 'add_e') {
        sessions.get(userId).element = i.values[0];
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('type_PVP').setLabel('PVP').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('type_PVM').setLabel('PVM').setStyle(ButtonStyle.Success)
        );
        return i.update({ content: `✅ Élément : **${i.values[0]}**`, components: [row] });
    }

    if (i.isButton() && i.customId.startsWith('type_')) {
        const sess = sessions.get(userId);
        if (!sess) return;
        sess.mode = i.customId.split('_')[1];
        const modal = new ModalBuilder().setCustomId('modal_link').setTitle('Lien Dofusbook');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('l').setLabel("Lien du stuff (Touch)").setStyle(TextInputStyle.Short).setRequired(true)));
        return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === 'modal_link') {
        const data = sessions.get(userId);
        const link = i.fields.getTextInputValue('l');
        db.run(`INSERT INTO shared_stuff (auteur, classe, element, mode, lien) VALUES (?,?,?,?,?)`, [i.user.username, data.classe, data.element, data.mode, link]);
        sessions.delete(userId);
        return i.reply({ content: `✅ Build enregistré avec succès !` });
    }

    // --- LOGIQUE COMBAT ---
    if (i.customId === 'combat_users') {
        sessions.set(userId, { participants: i.users.map(u => ({ id: u.id, name: u.username })) });
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('combat_format').setPlaceholder('Format ?').addOptions([{ label: '4v4', value: '4' }, { label: '3v4', value: '3' }, { label: '2v4', value: '2' }]));
        return i.update({ content: `✅ Participants : **${i.users.map(u => u.username).join(', ')}**`, components: [row] });
    }

    if (i.customId === 'combat_format') {
        sessions.get(userId).format = parseInt(i.values[0]);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('res_win').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('res_lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
        );
        return i.update({ content: `👉 Issue du combat ?`, components: [row] });
    }

    if (i.isButton() && i.customId.startsWith('res_')) {
        const s = sessions.get(userId);
        if (!s || !s.participants) return;
        const win = i.customId === 'res_win';
        const pts = (win ? 1.0 : 0.25) + (s.format < 4 ? 0.75 : 0);
        const stmt = db.prepare(`INSERT INTO combats (joueur_id, joueur_nom, points, issue, type, date) VALUES (?,?,?,?,?, datetime('now'))`);
        s.participants.forEach(p => stmt.run(p.id, p.name, pts, win ? 'Victoire' : 'Défaite', `${s.format}v4`));
        stmt.finalize();
        sessions.delete(userId);
        const board = await showLeaderboard();
        return i.update({ content: `✅ Combat enregistré !`, components: [], embeds: [new EmbedBuilder().setDescription(board).setColor('#2ecc71')] });
    }
});

// --- 7. CONNEXION ---
client.login(process.env.TOKEN).catch(() => console.error("❌ Token Invalide. Vérifie Render !"));