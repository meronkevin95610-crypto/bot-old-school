const http = require('http');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Bot Guilde V6.6 - Ratio & Performance");
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const db = new sqlite3.Database('./stats.db');
const sessions = new Map();

// --- TA FONCTION DE CLASSEMENT COMPLÈTE (PROTÉGÉE) ---
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
                const nom = (r.joueur_nom || "Inconnu").substring(0, 14).padEnd(14);
                const pts = r.p.toFixed(2).padEnd(5);
                txt += `${nom} | ${String(r.tc).padEnd(3)} | ${r.v} | ${r.d} | ${pts} | ${ratio}\n`;
            });
            txt += "```";
            resolve(txt);
        });
    });
}

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;
    if (m.content === '!classement') {
        const board = await getFullLeaderboard();
        m.reply(board);
    }
    if (m.content === '!resultat') {
        sessions.set(m.author.id, { participants: [] });
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('sel_u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4)
        );
        m.reply({ content: "⚔️ **Saisie de combat**", components: [menu] });
    }
});

client.on('interactionCreate', async (i) => {
    const userId = i.user.id;
    let s = sessions.get(userId);

    if (i.customId === 'sel_u') {
        if(!s) return i.reply({ content: "Session expirée.", ephemeral: true });
        s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
        const r = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('sel_f').setPlaceholder('2. Format ?').addOptions([
                { label: '4 alliés', value: '4' }, { label: '3 alliés (+0.75)', value: '3' }, { label: '2 alliés (+0.75)', value: '2' }
            ])
        );
        return i.update({ content: "👉 **Quel était le format ?**", components: [r] });
    }

    if (i.customId === 'sel_f') {
        if(!s) return;
        s.nb_allies = parseInt(i.values[0]);
        const r1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('win').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lose').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
        );
        return i.update({ content: "👉 **Résultat du combat ?**", components: [r1] });
    }

    if (i.customId === 'win' || i.customId === 'lose') {
        if (!s) return;

        // --- ÉTAPE CRUCIALE : ON VALIDE L'INTERACTION TOUT DE SUITE ---
        await i.update({ content: "💾 **Calcul du classement détaillé en cours...**", components: [] });

        const issue = i.customId === 'win' ? "Victoire" : "Défaite";
        const pts = (i.customId === 'win' ? 1.0 : 0.25) + (s.nb_allies < 4 ? 0.75 : 0);

        // Enregistrement SQL
        const stmt = db.prepare(`INSERT INTO attaques (joueur_id, joueur_nom, points, issue, nb_allies, date) VALUES (?, ?, ?, ?, ?, datetime('now'))`);
        s.participants.forEach(p => stmt.run(p.id, p.name, pts, issue, s.nb_allies));
        stmt.finalize();

        sessions.delete(userId);

        // On génère le tableau (ça peut prendre 1 ou 2 secondes)
        const board = await getFullLeaderboard();

        // On utilise editReply pour envoyer le tableau final une fois prêt
        return i.editReply({ 
            content: `✅ Combat enregistré ! (+${pts.toFixed(2)} pts)`, 
            embeds: [new EmbedBuilder().setDescription(board).setColor('#2ecc71')] 
        });
    }
});

client.login(process.env.TOKEN);