const http = require('http');
const fs = require('fs');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, 
    AttachmentBuilder 
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// --- 1. CONFIGURATION ET VARIABLES ---
const config = {
    tokenGestion: process.env.tokenGestion,
    urlRender: process.env.urlRender || `https://ton-projet.onrender.com`,
    adminId: "TON_ID_DISCORD_ICI" // <--- METS TON ID ICI (ex: "1234567890")
};

const db = new sqlite3.Database('./database.sqlite');
const sessions = new Map();

// --- 2. SERVEUR HTTP (ESSENTIEL POUR RENDER) ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is Live!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));

// --- 3. INITIALISATION DU BOT ---
const botGestion = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// --- 4. GESTION DES MESSAGES (!commandes) ---
botGestion.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    // A. Commande de résultat
    if (m.content === '!resultat' || m.content === '!resulta') {
        const token = `ST-${Date.now()}-${m.author.id}`;
        sessions.set(m.author.id, { participants: [], cote: null, nb_ennemis: 4, processing: false, session_token: token });
        
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4)
        );
        m.reply({ content: "🏆 **Nouveau combat**\nSélectionnez les participants :", components: [menu] });
    }

    // B. Commande de Backup (Envoi de la DB en message privé)
    if (m.content === '!backup-classement') {
        if (m.author.id !== config.adminId) return m.reply("❌ Seul l'administrateur peut faire ça.");

        const tempFile = `./backup_${Date.now()}.sqlite`;
        fs.copyFile('./database.sqlite', tempFile, async (err) => {
            if (err) return m.reply("❌ Erreur lors de la copie de la base.");
            
            try {
                const attachment = new AttachmentBuilder(tempFile);
                await m.author.send({ content: "📂 Voici ta sauvegarde SQLite :", files: [attachment] });
                m.reply("✅ Sauvegarde envoyée en message privé !");
            } catch (e) {
                m.reply("❌ Impossible de t'envoyer un MP. Vérifie tes paramètres.");
            } finally {
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            }
        });
    }

    // C. Commande de Reset (Avec Confirmation)
    if (m.content === '!reset-classement') {
        if (m.author.id !== config.adminId) return m.reply("❌ Permission refusée.");

        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_reset').setLabel('CONFIRMER LE RESET').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cancel_reset').setLabel('ANNULER').setStyle(ButtonStyle.Secondary)
        );

        m.reply({ 
            content: "⚠️ **ATTENTION** : Voulez-vous vraiment effacer TOUT le classement ? Cette action est irréversible.", 
            components: [confirmRow] 
        });
    }
});

// --- 5. GESTION DES INTERACTIONS (BOUTONS / MENUS) ---
botGestion.on('interactionCreate', async (i) => {
    // Gestion du Reset
    if (i.customId === 'confirm_reset') {
        if (i.user.id !== config.adminId) return i.reply({ content: "Non autorisé.", ephemeral: true });
        
        db.serialize(() => {
            db.run(`DELETE FROM attaques`);
            db.run(`DELETE FROM sqlite_sequence WHERE name='attaques'`);
        });
        return i.update({ content: "✅ Le classement a été réinitialisé à zéro.", components: [] });
    }
    
    if (i.customId === 'cancel_reset') {
        return i.update({ content: "❌ Réinitialisation annulée.", components: [] });
    }

    // Gestion du menu de sélection des participants (Ton code actuel)
    const s = sessions.get(i.user.id);
    if (!s || s.processing) return;

    if (i.isUserSelectMenu() && i.customId === 'u') {
        s.participants = i.users.map(u => ({ id: u.id, name: u.username }));
        // Suite de ta logique d'enregistrement ici...
        await i.reply({ content: `Participants enregistrés : ${s.participants.length}`, ephemeral: true });
    }
});

// --- 6. AUTO-PING (ANTI-SOMMEIL RENDER) ---
setInterval(() => {
    if (!config.urlRender.includes("
