const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- CONFIGURATION ---
const ID_SALON_ARCHIVE = "1477765166467911765"; 

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Perco V5.3.1 - Operationnel");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

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
        date TEXT,
        session_token TEXT 
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
            let txt = "```\nNom            | Pts   | Atk | Def | %\n---------------------------------------\n";
            rows.forEach(r => {
                const ratio = r.tc > 0 ? Math.round((r.v / r.tc) * 100) + "%" : "0%";
                const nom = (r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14);
                const pts = (r.p || 0).toFixed(1).padEnd(5);
                const atk = String(r.n_atk).padEnd(3);
                const def = String(r.n_def).padEnd(3);
                txt += `${nom} | ${pts} | ${atk} | ${def} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

// --- GESTION MESSAGES ---
client.on('ready', () => {
    console.log(`🚀 Bot Perco V5.3.1 prêt | ${client.user.tag}`);
});

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!classement') {
        const board = await getLeaderboard(15);
        return m.reply(`🏆 **CLASSEMENT ACTUEL**\n${board}`);
    }

    if (m.content === '!resultat' || m.content === '!resulta') {
        const sessionToken = Date.now() + "-" + m.author.id;
        sessions.set(m.author.id, { 
            participants: [], 
            cote: null, 
            nb_ennemis: 4, 
            processing: false,
            token: sessionToken 
        });
        
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4)
        );
        await m.reply({ content: "⚔️ **Configuration du combat**", components: [menu] });
    }
});

// --- INTERACTIONS ---
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

            await i.deferUpdate().catch(() => {});

            const issue = i.customId === 'win' ? "Victoire" : "Défaite";
            const pts = calculerPoints(s.cote, issue, s.nb_ennemis);

            // --- SECURITE ANTI-DOUBLON ---
            const alreadyExists = await new Promise(res => {
                db.get("SELECT id FROM attaques WHERE session_token = ?", [s.token], (err, row) => res(row));
            });

            if (alreadyExists) {
                console.log("Doublon bloqué.");
                return;
            }

            // --- INSERTION AVEC PROMISE (Plus stable) ---
            const placeholders = s.participants.map(() => "(?, ?, ?, ?, ?, ?, date('now'), ?)").join(', ');
            const params = [];
            s.participants.forEach(p => params.push(p.id, p.name, pts, issue, s.cote, s.nb_ennemis, s.token));

            const sql = `INSERT INTO attaques (joueur_id, joueur_nom, points, issue, cote, nb_ennemis, date, session_token) VALUES ${placeholders}`;

            await new Promise((resolve, reject) => {
                db.run(sql, params, function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            }).catch(console.error);

            // --- RÉCUPÉRATION DU TABLEAU ---
            const board = await getLeaderboard(15);
            
            // --- CONSTRUCTION DE L'EMBED ---
            const embed = new EmbedBuilder()
                .setTitle("🚨 Résultat Enregistré")
                .setDescription(`👥 **Participants :** ${s.participants.map(p => `**${p.name}**`).join(', ')}\n📝 **Action :** ${issue} en ${s.cote}\n🎖️ **Points :** +${pts.toFixed(1)}`)
                .setColor(issue === "Victoire" ? "#2ecc71" : "#e74c3c")
                // On s'assure que value n'est jamais vide
                .addFields({ name: "📊 CLASSEMENT MIS À JOUR", value: board.length > 10 ? board : "⚠️ Données en cours de calcul..." })
                .setTimestamp();

            // --- ENVOI FINAL ---
            await i.editReply({ 
                content: null,
                components: [], 
                embeds: [embed] 
            }).catch(err => console.error("Erreur EditReply:", err));

            sessions.delete(i.user.id);
        }
    } catch (err) { 
        console.error("Erreur Critique Interaction:", err);
        sessions.delete(i.user.id);
    }
});

client.login(process.env.TOKEN);
