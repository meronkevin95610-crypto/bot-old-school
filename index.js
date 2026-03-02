const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// Serveur pour Render
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Guilde V6.5 - Anti-Lag");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const db = new sqlite3.Database('./stats.db');
const sessions = new Map();

// --- LOGIQUE CLASSEMENT OPTIMISÉE ---
async function generateBoard() {
    return new Promise((resolve) => {
        const query = `SELECT joueur_nom, COUNT(*) as tc, 
                       SUM(CASE WHEN issue='Victoire' THEN 1 ELSE 0 END) as v, 
                       SUM(points) as p 
                       FROM attaques GROUP BY joueur_id ORDER BY p DESC`;
        db.all(query, [], (err, rows) => {
            if (err || !rows || rows.length === 0) return resolve("⚠️ Aucune donnée disponible.");
            
            let header = "🏆 **CLASSEMENT GÉNÉRAL** 🏆\n```\nNom            | Cbt | V | Pts\n------------------------------\n";
            let lines = rows.map(r => {
                const nom = (r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14);
                return `${nom} | ${String(r.tc).padEnd(3)} | ${r.v} | ${r.p.toFixed(2)}`;
            }).join('\n');
            
            resolve(header + lines + "\n```");
        });
    });
}

// --- COMMANDES ---
client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!classement') {
        const board = await generateBoard();
        m.reply(board);
    }

    if (m.content === '!resultat') {
        sessions.set(m.author.id, { p: [] });
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a joué ?').setMinValues(1).setMaxValues(4)
        );
        m.reply({ content: "⚔️ **Nouveau Combat**", components: [menu] });
    }
});

// --- INTERACTIONS ---
client.on('interactionCreate', async (i) => {
    try {
        const sid = i.user.id;
        let s = sessions.get(sid);

        if (i.customId === 'u') {
            if(!s) return i.reply({ content: "Erreur : Relancez !resultat", ephemeral: true });
            s.p = i.users.map(u => ({ id: u.id, n: u.username }));
            const r = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('f').setPlaceholder('2. Format ?').addOptions([
                    { label: '4 alliés', value: '4' },
                    { label: '3 alliés (+0.75)', value: '3' },
                    { label: '2 alliés (+0.75)', value: '2' }
                ])
            );
            return i.update({ content: "👉 **Quel format ?**", components: [r] });
        }

        if (i.customId === 'f') {
            if(!s) return;
            s.f = parseInt(i.values[0]);
            const r1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
            );
            return i.update({ content: "👉 **Résultat ?**", components: [r1] });
        }

        if (i.customId === 'win' || i.customId === 'lose') {
            if(!s) return;
            
            // 1. On "defer" (indique que le bot travaille) pour éviter le timeout
            await i.update({ content: "💾 Enregistrement en cours...", components: [] });

            const isWin = i.customId === 'win';
            const pts = (isWin ? 1.0 : 0.25) + (s.f < 4 ? 0.75 : 0);
            const issue = isWin ? "Victoire" : "Défaite";

            const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, date) VALUES (?, ?, ?, ?, datetime('now'))`);
            s.p.forEach(player => stmt.run(player.id, player.n, pts, issue));
            stmt.finalize();

            sessions.delete(sid); // Nettoyage immédiat

            // 2. On génère et on affiche le tableau final
            const board = await generateBoard();
            return i.editReply({ content: "✅ Combat enregistré !", embeds: [new EmbedBuilder().setDescription(board).setColor('#2ecc71')] });
        }
    } catch (e) {
        console.error("Crash évité :", e);
    }
});

client.login(process.env.TOKEN);