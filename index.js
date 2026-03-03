const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 

// Serveur HTTP pour Render
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V5.2.8 - Operationnel");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- SECURITE ---
process.on('unhandledRejection', (reason) => console.error(' [ERREUR] Rejet non géré :', reason));
process.on('uncaughtException', (err) => console.error(' [ERREUR] Exception non capturée :', err));

// --- BASE DE DONNÉES ---
const db = new sqlite3.Database('./stats.db');
db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;"); 
    db.run(`CREATE TABLE IF NOT EXISTS attaques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        joueur_id TEXT,
        joueur_nom TEXT,
        points REAL,
        issue TEXT,
        cote TEXT,
        nb_ennemis INTEGER,
        date TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS config (cle TEXT PRIMARY KEY, valeur TEXT)`);
});

const sessions = new Map();

// --- LOGIQUE CALCUL ---
function calculerPoints(cote, issue, ennemis) {
    if (issue === "Défaite") return (cote === "Défense") ? 1.0 : 0.0; 
    if (ennemis === 0) return 0.25; 
    if (cote === "Attaque") return (ennemis === 4) ? 5.0 : 3.0;
    return (ennemis === 4) ? 4.0 : 2.0;
}

// --- GENERATION DU CLASSEMENT ---
async function getLeaderboard(limit = 15) {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc,
                       SUM(CASE WHEN cote='Attaque' THEN 1 ELSE 0 END) as n_atk,
                       SUM(CASE WHEN cote='Défense' THEN 1 ELSE 0 END) as n_def,
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(points) as p FROM attaques GROUP BY joueur_id ORDER BY p DESC LIMIT ${limit}`;
        
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucune donnée enregistrée.");
            let txt = `\`\`\`\nNom            | Pts   | Atk | Def | Ratio\n--------------------------------------------\n`;
            rows.forEach(r => {
                const ratio = r.tc > 0 ? Math.round((r.v / r.tc) * 100) + "%" : "0%";
                const nom = (r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14);
                const pts = (r.p || 0).toFixed(2).padEnd(5);
                const atk = String(r.n_atk).padEnd(3);
                const def = String(r.n_def).padEnd(3);
                txt += `${nom} | ${pts} | ${atk} | ${def} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- RESET & ARCHIVAGE ---
async function executerResetMensuel(trigger = null) {
    const channel = await client.channels.fetch(ID_SALON_ARCHIVE).catch(() => null);
    const board = await getLeaderboard(20);

    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle(`🏆 ARCHIVES DES STATISTIQUES`)
            .setDescription(board)
            .setColor("#f1c40f")
            .setTimestamp();
        await channel.send({ content: "🏁 **Réinitialisation du mois effectuée.**", embeds: [embed] });
    }

    db.run("DELETE FROM attaques;");
    if (trigger && trigger.reply) trigger.reply("✅ Reset et archivage terminés.");
}

async function checkMonthlyReset() {
    const mtn = new Date();
    const moisActuel = `${mtn.getFullYear()}-${mtn.getMonth() + 1}`;
    db.get("SELECT valeur FROM config WHERE cle = 'dernier_reset'", async (err, row) => {
        if (!row || row.valeur !== moisActuel) {
            if (row) await executerResetMensuel();
            db.run("INSERT OR REPLACE INTO config (cle, valeur) VALUES ('dernier_reset', ?)", [moisActuel]);
        }
    });
}

// --- GESTION MESSAGES ---
client.on('ready', () => {
    console.log(`🚀 Bot Perco V5.2.8 prêt | ${client.user.tag}`);
    checkMonthlyReset();
    setInterval(checkMonthlyReset, 3600000);
});

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!forcereset' && m.member.permissions.has('Administrator')) {
        return await executerResetMensuel(m);
    }

    if (m.content === '!classement') {
        const board = await getLeaderboard(15);
        return m.reply(`🏆 **CLASSEMENT ACTUEL** 🏆\n${board}`);
    }

    if (m.content === '!resultat' || m.content === '!resulta') {
        sessions.set(m.author.id, { participants: [], cote: null, nb_ennemis: 4, processing: false });
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4)
        );
        await m.reply({ content: "⚔️ **Configuration du combat**", components: [menu] });
    }
});

// --- INTERACTIONS CORRIGÉES ---
client.on('interactionCreate', async (i) => {
    const s = sessions.get(i.user.id);
    if (!s) return;

    try {
        if (i.isUserSelectMenu() && i.customId === 'u') {
            s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
            const r = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('cote').setPlaceholder('2. Côté ?')
                .addOptions([{ label: 'Attaque', value: 'att' }, { label: 'Défense', value: 'def' }])
            );
            return await i.update({ content: "✅ Joueurs enregistrés. 👉 **Attaque ou Défense ?**", components: [r] });
        }

        if (i.isStringSelectMenu()) {
            if (i.customId === 'cote') {
                s.cote = i.values[0] === 'att' ? "Attaque" : "Défense";
                const r = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('ennemis').setPlaceholder('3. Ennemis ?')
                    .addOptions([
                        { label: '4 Adversaires', value: '4' },
                        { label: '1-3 Adversaires', value: '1' },
                        { label: '0 Adversaire', value: '0' }
                    ])
                );
                return await i.update({ content: `Côté : **${s.cote}** 👉 **Combien d'adversaires ?**`, components: [r] });
            }
            if (i.customId === 'ennemis') {
                s.nb_ennemis = parseInt(i.values[0]);
                const r = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Danger)
                );
                return await i.update({ content: `Opposition : **${s.nb_ennemis}** 👉 **Verdict ?**`, components: [r] });
            }
        }

        if (i.isButton()) {
            if (s.processing) return;
            s.processing = true;

            // BLOQUE l'interaction pour éviter les clics multiples et les doublons
            await i.deferUpdate();

            const issue = i.customId === 'win' ? "Victoire" : "Défaite";
            const pts = calculerPoints(s.cote, issue, s.nb_ennemis);

            // --- SYNCHRONISATION SQL ---
            const queries = s.participants.map(p => {
                return new Promise((res, rej) => {
                    db.run(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_ennemis, date) VALUES (?, ?, ?, ?, ?, ?, date('now'))`, 
                    [p.id, p.name, pts, issue, s.cote, s.nb_ennemis], (err) => {
                        if (err) rej(err); else res();
                    });
                });
            });

            await Promise.all(queries);

            // Petit délai pour s'assurer que SQLite a fini d'écrire sur le disque
            await new Promise(resolve => setTimeout(resolve, 150));

            const board = await getLeaderboard(15);
            
            const embed = new EmbedBuilder()
                .setTitle("🚨 Résultat Enregistré")
                .setDescription(`${s.participants.map(p => `**${p.name}**`).join(', ')}\n**${issue}** en **${s.cote}** contre **${s.nb_ennemis}**.\n🎖️ Points : **+${pts.toFixed(2)}**`)
                .setColor(issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                .addFields({ name: "📊 CLASSEMENT MIS À JOUR", value: board || "Chargement..." })
                .setTimestamp();

            // On utilise editReply car le deferUpdate a déjà été fait
            await i.editReply({ content: "✅ Statistiques synchronisées.", components: [], embeds: [embed] });
            sessions.delete(i.user.id);
        }
    } catch (err) { 
        console.error("Erreur Interaction:", err);
        sessions.delete(i.user.id);
    }
});

client.login(process.env.TOKEN);
