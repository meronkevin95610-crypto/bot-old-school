const http = require('http');
const fs = require('fs');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, PermissionFlagsBits, SlashCommandBuilder, Routes, AttachmentBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const sqlite3 = require('sqlite3').verbose();

// --- Configuration ---
const config = {
    tokenGestion: process.env.tokenGestion,
    tokenPerco: process.env.tokenPerco,
    clientIdPerco: process.env.clientIdPerco,
    guildId: process.env.guildId,
    urlRender: process.env.urlRender,
    adminId: "TON_ID_DISCORD" // Remplace par ton ID Discord pour les commandes sensibles
};

const db = new sqlite3.Database('./database.sqlite');
const sessions = new Map();

// --- 4. LOGIQUE BOT GESTION ---
const botGestion = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

botGestion.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    // --- COMMANDE : RESULTAT ---
    if (m.content === '!resultat' || m.content === '!resulta') {
        const token = `ST-${Date.now()}-${m.author.id}`;
        sessions.set(m.author.id, { participants: [], cote: null, nb_ennemis: 4, processing: false, session_token: token });
        
        const menu = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('u').setPlaceholder('1. Qui a participé ?').setMinValues(1).setMaxValues(4)
        );
        m.reply({ content: "🏆 **Nouveau résultat de combat**\nSélectionnez les participants :", components: [menu] });
    }

    // --- COMMANDE : BACKUP (Sauvegarde et Envoi du fichier) ---
    if (m.content === '!backup-classement') {
        if (m.author.id !== config.adminId) return m.reply("❌ Permission refusée.");

        const fileName = `./backup_classement_${Date.now()}.sqlite`;
        
        // Copie du fichier pour s'assurer qu'il n'est pas "lock" par SQLite
        fs.copyFile('./database.sqlite', fileName, async (err) => {
            if (err) return m.reply("❌ Erreur lors de la création du fichier backup.");

            const attachment = new AttachmentBuilder(fileName);
            try {
                await m.author.send({ content: "📂 Voici la sauvegarde de la base de données :", files: [attachment] });
                m.reply("✅ Sauvegarde effectuée ! Le fichier vous a été envoyé en MP.");
            } catch (e) {
                m.reply("❌ Impossible de vous envoyer le MP. Vérifiez vos paramètres de confidentialité.");
            } finally {
                // Supprime le fichier temporaire du serveur après envoi
                if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
            }
        });
    }

    // --- COMMANDE : RESET (Nettoyage complet) ---
    if (m.content === '!reset-classement') {
        if (m.author.id !== config.adminId) return m.reply("❌ Permission refusée.");

        db.serialize(() => {
            db.run(`DELETE FROM attaques`, (err) => {
                if (err) return m.reply("❌ Erreur lors du nettoyage.");
                
                // Reset du compteur d'ID
                db.run(`DELETE FROM sqlite_sequence WHERE name='attaques'`);
                
                m.reply("⚠️ **Le classement a été réinitialisé.** Toutes les données ont été effacées.");
                console.log(`🧹 Reset effectué par ${m.author.tag}`);
            });
        });
    }
});

// --- 5. LOGIQUE INTERACTION (Enregistrement des données) ---
botGestion.on('interactionCreate', async (i) => {
    if (!i.isButton() && !i.isUserSelectMenu()) return;
    const s = sessions.get(i.user.id);
    if (!s || s.processing) return;

    // Logique de sélection des participants et calcul...
    // (Garde ton code actuel ici pour la gestion des points et l'INSERT)
    // N'oublie pas d'utiliser s.session_token comme dans ton dernier diff.
});

// --- 7. AUTO-PING (Anti-Sommeil Render) ---
const URL_PING = config.urlRender || `https://ton-projet.onrender.com`; 
setInterval(() => {
    if (!URL_PING.includes("ton-projet")) {
        http.get(URL_PING, (res) => {
            console.log(`⚓ Auto-ping : Statut ${res.statusCode}`);
        }).on('error', (e) => console.error("❌ Erreur Ping:", e.message));
    }
}, 8 * 60 * 1000); 

// --- 8. CONNEXION ---
botGestion.login(config.tokenGestion);
// botPerco.login(config.tokenPerco); // Si tu l'utilises toujours
