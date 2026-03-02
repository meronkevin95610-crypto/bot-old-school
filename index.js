
const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ARCHIVE_CHANNEL_ID = "1477765166467911765"; 

const META_STUFFS = {
    "Cra": { emoji: "🏹", stats: "Terre/Air ou Feu", link: "https://www.dofusbook.net/fr/recherche?text=Cra+Touch", desc: "Le roi du farm et du retrait à distance.", image: "https://r2.starry.io/dofus/gfx/illus/Cra.png" },
    "Ecaflip": { emoji: "🐱", stats: "Multi Do Crit", link: "https://www.dofusbook.net/fr/recherche?text=Ecaflip+Touch", desc: "Dégâts imprévisibles et grosse mobilité.", image: "https://r2.starry.io/dofus/gfx/illus/Ecaflip.png" },
    "Eniripsa": { emoji: "🧚", stats: "Feu / Soin", link: "https://www.dofusbook.net/fr/recherche?text=Eniripsa+Touch", desc: "Le pilier indispensable pour soigner la team.", image: "https://r2.starry.io/dofus/gfx/illus/Eniripsa.png" },
    "Enutrof": { emoji: "👴", stats: "Eau / Retrait PM", link: "https://www.dofusbook.net/fr/recherche?text=Enutrof+Touch", desc: "Maître de l'entrave et du drop.", image: "https://r2.starry.io/dofus/gfx/illus/Enutrof.png" },
    "Feca": { emoji: "🛡️", stats: "Eau / Retrait", link: "https://www.dofusbook.net/fr/recherche?text=Feca+Touch", desc: "Protections massives et contrôle de zone.", image: "https://r2.starry.io/dofus/gfx/illus/Feca.png" },
    "Iop": { emoji: "⚔️", stats: "Full Terre", link: "https://www.dofusbook.net/fr/recherche?text=Iop+Touch", desc: "Dégâts bruts pour OS un focus rapidement.", image: "https://r2.starry.io/dofus/gfx/illus/Iop.png" },
    "Osamodas": { emoji: "🐉", stats: "Feu / Air", link: "https://www.dofusbook.net/fr/recherche?text=Osamodas+Touch", desc: "Harcèlement via les invocations.", image: "https://r2.starry.io/dofus/gfx/illus/Osamodas.png" },
    "Pandawa": { emoji: "🐼", stats: "Tank / Résistances", link: "https://www.dofusbook.net/fr/recherche?text=Pandawa+Touch", desc: "Le meilleur placeur (indispensable en donjon/perco).", image: "https://r2.starry.io/dofus/gfx/illus/Pandawa.png" },
    "Roublard": { emoji: "💣", stats: "Feu ou Air", link: "https://www.dofusbook.net/fr/recherche?text=Roublard+Touch", desc: "Expert en explosions et murs de bombes.", image: "https://r2.starry.io/dofus/gfx/illus/Roublard.png" },
    "Sacrieur": { emoji: "🩸", stats: "Air / Tacle", link: "https://www.dofusbook.net/fr/recherche?text=Sacrieur+Touch", desc: "Le sac à PV qui colle ses adversaires.", image: "https://r2.starry.io/dofus/gfx/illus/Sacrieur.png" },
    "Sadida": { emoji: "🌳", stats: "Terre / Eau", link: "https://www.dofusbook.net/fr/recherche?text=Sadida+Touch", desc: "Entrave PM et propagation de l'état infecté.", image: "https://r2.starry.io/dofus/gfx/illus/Sadida.png" },
    "Sram": { emoji: "💀", stats: "Terre / Air", link: "https://www.dofusbook.net/fr/recherche?text=Sram+Touch", desc: "Invisibilité et réseaux de pièges mortels.", image: "https://r2.starry.io/dofus/gfx/illus/Sram.png" },
    "Steamer": { emoji: "🐙", stats: "Terre / Eau", link: "https://www.dofusbook.net/fr/recherche?text=Steamer+Touch", desc: "Polyvalence soin/dégâts avec les tourelles.", image: "https://r2.starry.io/dofus/gfx/illus/Steamer.png" },
    "Xelor": { emoji: "⏳", stats: "Terre / Eau", link: "https://www.dofusbook.net/fr/recherche?text=Xelor+Touch", desc: "Retrait PA et téléportations.", image: "https://r2.starry.io/dofus/gfx/illus/Xelor.png" },
    "Zobal": { emoji: "🎭", stats: "Terre / Do Pou", link: "https://www.dofusbook.net/fr/recherche?text=Zobal+Touch", desc: "Boucliers d'équipe et gros dommages de poussée.", image: "https://r2.starry.io/dofus/gfx/illus/Zobal.png" }
};

// --- SERVEUR WEB ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Guilde Dofus Touch V8.5 - Fusion Finale Active");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- BASE DE DONNÉES ---
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");
    db.run(`CREATE TABLE IF NOT EXISTS attaques (id INTEGER PRIMARY KEY AUTOINCREMENT, joueur_id TEXT, joueur_nom TEXT, points REAL, issue TEXT, cote TEXT, nb_allies INTEGER, date TEXT)`);
});

const sessions = new Map();

// --- LOGIQUE CLASSEMENT ---
async function getLeaderboard(title = "CLASSEMENT GUILDE TOUCH") {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc, SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, SUM(CASE WHEN issue='Défaite' THEN 1 ELSE 0 END) as d, SUM(points) as p FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT 15`;
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("Aucune donnée enregistrée.");
            let txt = `🏆 **${title}** 🏆\n\`\`\`\nNom            | Cbt | V | D | Pts  | Ratio\n--------------------------------------------\n`;
            rows.forEach(r => {
                const ratio = r.tc > 0 ? ((r.v / r.tc) * 100).toFixed(0) + "%" : "0%";
                txt += `${(r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14)} | ${String(r.tc).padEnd(3)} | ${r.v} | ${r.d} | ${r.p.toFixed(2).padEnd(5)} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- FONCTIONS MENUS ---
function getStuffMenu() {
    const options = Object.entries(META_STUFFS).map(([name, data]) => ({ label: name, value: name, emoji: data.emoji }));
    const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('s_classe').setPlaceholder('🛡️ Choisis ta classe Touch...').addOptions(options));
    return { content: "🔎 **Répertoire Visuel des Builds (Touch)**", embeds: [], components: [row] };
}

// --- ÉVÉNEMENTS ---
client.on('ready', () => console.log(`✅ Bot Opérationnel: ${client.user.tag}`));

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!stuff') return m.reply(getStuffMenu());

    if (m.content === '!classement') {
        const b = await getLeaderboard();
        return m.channel.send(b);
    }

    if (m.content === '!resultat' || m.content === '!resulta') {
        sessions.set(m.author.id, { participants: [], cote: null, issue: null, nb_allies: 4 });
        const menu = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a combattu ?').setMinValues(1).setMaxValues(4));
        return m.reply({ content: "⚔️ **Enregistrement Combat**", components: [menu] });
    }

    if (m.content === '!reset' && m.member.permissions.has(PermissionFlagsBits.Administrator)) {
        db.run(`DELETE FROM attaques`, () => m.reply("🔄 Le classement a été remis à zéro."));
    }
});

client.on('interactionCreate', async (i) => {
    if (i.isButton() && i.customId === 'back_to_stuff') return i.update(getStuffMenu());

    if (!i.isStringSelectMenu() && !i.isUserSelectMenu() && !i.isButton()) return;

    // --- INTERACTION STUFF ---
    if (i.customId === 's_classe') {
        const classe = i.values[0];
        const data = META_STUFFS[classe];
        const embed = new EmbedBuilder()
            .setTitle(`${data.emoji} FICHE CLASSE : ${classe.toUpperCase()}`)
            .setColor('#f39c12')
            .setThumbnail(data.image)
            .addFields(
                { name: "📊 Éléments", value: `\`${data.stats}\``, inline: true },
                { name: "🔗 Dofusbook", value: `[Voir le stuff](${data.link})`, inline: true },
                { name: "📝 Conseil", value: data.desc }
            )
            .setFooter({ text: "Touch Edition - Cliquez sur le bouton pour revenir au menu" });

        const btnRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('back_to_stuff').setLabel('🔙 Retour au menu').setStyle(ButtonStyle.Secondary));
        return i.update({ content: `✅ **Affichage : ${classe}**`, embeds: [embed], components: [btnRow] });
    }

    // --- INTERACTION RÉSULTATS ---
    const s = sessions.get(i.user.id);
    if (!s) return;

    if (i.isUserSelectMenu()) {
        s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
        const r = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('n').setPlaceholder('2. Format du combat ?').addOptions([{ label: '4v4', value: '4' }, { label: '3v4 (+0.75 pts)', value: '3' }, { label: '2v4 (+0.75 pts)', value: '2' }]));
        return i.update({ content: `✅ Joueurs : **${s.participants.map(p => p.name).join(', ')}**\n👉 Quel format ?`, components: [r] });
    }

    if (i.isStringSelectMenu() && i.customId === 'n') {
        s.nb_allies = parseInt(i.values[0]);
        const r1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('att').setLabel('Attaque').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('def').setLabel('Défense').setStyle(ButtonStyle.Primary));
        const r2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary));
        return i.update({ content: `✅ Format : **${s.nb_allies}v4**\n👉 Issue du combat :`, components: [r1, r2] });
    }

    if (i.isButton()) {
        if (['att', 'def'].includes(i.customId)) s.cote = i.customId === 'att' ? "Attaque" : "Défense";
        if (['win', 'lose'].includes(i.customId)) s.issue = i.customId === 'win' ? "Victoire" : "Défaite";

        if (s.cote && s.issue) {
            let pts = (s.issue === "Victoire" ? 1.0 : 0.25) + (s.nb_allies < 4 ? 0.75 : 0);
            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_allies, date) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
            s.participants.forEach(p => stmt.run(p.id, p.name, pts, s.issue, s.cote, s.nb_allies));
            stmt.finalize();

            const e = new EmbedBuilder().setTitle("🚨 Combat Enregistré").setDescription(`${s.participants.map(p => `**${p.name}**`).join(', ')}\n**${s.issue}** (${s.cote})`).setColor(s.issue === "Victoire" ? "#2ecc71" : "#e74c3c").addFields({ name: "🎖️ Points", value: `+${pts.toFixed(2)} pts` });
            await i.update({ content: "✅ **Mis à jour !**", components: [], embeds: [e] });
            const b = await getLeaderboard();
            await i.channel.send(b);
            sessions.delete(i.user.id);
        } else {
            await i.update({ content: `👉 Sélection : **${s.cote || '?'}** | **${s.issue || '?'}**` });
        }
    }
});

client.login(process.env.TOKEN);