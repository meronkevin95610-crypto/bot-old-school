const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');

// --- 1. INITIALISATION DU CLIENT ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// --- 2. BASE DE DONNÉES & MIGRATION ---
const db = new sqlite3.Database('./guilde_touch.db');

db.serialize(() => {
    // Création de la table si elle n'existe pas
    db.run(`CREATE TABLE IF NOT EXISTS combats (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        joueur_id TEXT, 
        joueur_nom TEXT, 
        points REAL, 
        issue TEXT, 
        structure TEXT, 
        action TEXT, 
        date TEXT
    )`);

    // Vérification des colonnes pour éviter les crashs lors du déploiement
    db.all("PRAGMA table_info(combats)", (err, rows) => {
        const columns = rows.map(r => r.name);
        if (!columns.includes('structure')) {
            db.run("ALTER TABLE combats ADD COLUMN structure TEXT DEFAULT 'Inconnu'");
        }
        if (!columns.includes('action')) {
            db.run("ALTER TABLE combats ADD COLUMN action TEXT DEFAULT 'Inconnu'");
        }
    });
});

const sessions = new Map();

// --- 3. SERVEUR DE MAINTIEN (UPTIME RENDER) ---
http.createServer((req, res) => { 
    res.write("Bot Guilde Touch Online - V10.2"); 
    res.end(); 
}).listen(process.env.PORT || 3000);

// --- 4. LOGIQUE DU TABLEAU DE CLASSEMENT ---
async function showLeaderboard() {
    return new Promise((resolve) => {
        const query = `
            SELECT joueur_nom, COUNT(*) as cbt,
            SUM(CASE WHEN issue = 'Victoire' THEN 1 ELSE 0 END) as v,
            SUM(CASE WHEN issue = 'Défaite' THEN 1 ELSE 0 END) as d,
            SUM(points) as pts
            FROM combats 
            GROUP BY joueur_id 
            ORDER BY pts DESC 
            LIMIT 15`;

        db.all(query, (err, rows) => {
            if (!rows || rows.length === 0) return resolve("⚠️ Aucune donnée enregistrée.");
            
            let table = "🏆 **TOP 15 GUILDE TOUCH** 🏆\n```\n";
            table += "Nom            | Cbt | V | D | Pts  | Ratio\n";
            table += "--------------------------------------------\n";
            
            rows.forEach(r => {
                const ratio = Math.round((r.v / r.cbt) * 100) + "%";
                const nom = r.joueur_nom.substring(0, 14).padEnd(14);
                const cbt = String(r.cbt).padEnd(3);
                const v = String(r.v).padEnd(1);
                const d = String(r.d).padEnd(1);
                const pts = r.pts.toFixed(2).padEnd(4);
                const rat = ratio.padEnd(4);
                
                table += `${nom} | ${cbt} | ${v} | ${d} | ${pts} | ${rat}\n`;
            });
            table += "```";
            resolve(table);
        });
    });
}

// --- 5. GESTION DES COMMANDES ---
client.on('ready', () => console.log(`✅ Bot en ligne : ${client.user.tag}`));

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    if (m.content === '!resultat') {
        sessions.set(m.author.id, { participants: [] });
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('step_users')
                .setPlaceholder('Qui a participé ? (1 à 4)')
                .setMinValues(1)
                .setMaxValues(4)
        );
        return m.reply({ content: "👤 **Étape 1 : Sélectionnez les participants**", components: [menu] });
    }

    if (m.content === '!classement') {
        const board = await showLeaderboard();
        return m.channel.send(board);
    }
});

// --- 6. LOGIQUE DES INTERACTIONS (BOUTONS) ---
client.on('interactionCreate', async (i) => {
    const userId = i.user.id;
    const s = sessions.get(userId);

    if (!s && i.isButton()) {
        return i.reply({ content: "❌ Session expirée. Refais !resultat", ephemeral: true });
    }

    // Étape 1 : Sélection Participants -> Choix Structure
    if (i.customId === 'step_users') {
        s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('str_Percepteur').setLabel('Percepteur').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('str_Prisme').setLabel('Prisme').setStyle(ButtonStyle.Primary)
        );
        return i.update({ content: "🏰 **Étape 2 : Sur quelle structure ?**", components: [row] });
    }

    // Étape 2 : Choix Structure -> Choix Action
    if (i.customId.startsWith('str_')) {
        s.structure = i.customId.split('_')[1];
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('act_Attaque').setLabel('Attaque').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('act_Défense').setLabel('Défense').setStyle(ButtonStyle.Success)
        );
        return i.update({ content: `🏰 Structure : **${s.structure}**\n⚔️ **Étape 3 : Attaque ou Défense ?**`, components: [row] });
    }

    // Étape 3 : Choix Action -> Choix Résultat
    if (i.customId.startsWith('act_')) {
        s.action = i.customId.split('_')[1];
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('res_Victoire').setLabel('Victoire').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('res_Défaite').setLabel('Défaite').setStyle(ButtonStyle.Secondary)
        );
        return i.update({ content: `⚔️ Action : **${s.action}** sur **${s.structure}**\n🏆 **Étape 4 : Quel est le résultat ?**`, components: [row] });
    }

    // Étape 4 : Résultat -> Enregistrement & Affichage Classement
    if (i.customId.startsWith('res_')) {
        const issue = i.customId.split('_')[1];
        const pts = (issue === 'Victoire') ? 1.0 : 0.25;

        const stmt = db.prepare(`INSERT INTO combats (joueur_id, joueur_nom, points, issue, structure, action, date) VALUES (?,?,?,?,?,?, datetime('now'))`);
        
        s.participants.forEach(p => {
            stmt.run(p.id, p.name, pts, issue, s.structure, s.action);
        });
        stmt.finalize();

        sessions.delete(userId);
        const board = await showLeaderboard();
        
        return i.update({ 
            content: `✅ **Combat enregistré !**\n${s.structure} | ${s.action} | ${issue}`, 
            components: [], 
            embeds: [new EmbedBuilder().setTitle("Classement de Guilde").setDescription(board).setColor('#f1c40f')] 
        });
    }
});

// --- 7. CONNEXION ---
client.login(process.env.TOKEN);