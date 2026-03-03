const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const yts = require("yt-search");
const { default: makeWASocket, useMultiFileAuthState, delay, getContentType, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, downloadContentFromMessage, DisconnectReason, extractMessageContent } = require('baileys');

// ---------------- CONFIG ----------------
const config = {
    // Bot Identity
    BOT_NAME: '𝐋𝐀𝐊𝐈 𝐌𝐃 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓',
    BOT_VERSION: '3.0.0',
    OWNER_NAME: '𝐋𝐀𝐊𝐈',
    OWNER_NUMBER: process.env.OWNER_NUMBER || '94789227570',
    PREFIX: '.',
    
    // Group Settings
    GROUP_INVITE_LINK: '',
    AUTO_JOIN_GROUP: 'false',
    
    // Status Settings
    AUTO_VIEW_STATUS: 'false',
    AUTO_LIKE_STATUS: 'false',
    AUTO_LIKE_EMOJI: ['❤️', '🔥', '👍', '🎉', '💫', '✨', '🌟', '💝'],
    AUTO_RECORDING: 'false',
    
    // Images
    LOGO_URL: 'https://files.catbox.moe/3e7u52.jpg',
    BUTTON_IMAGES: {
        ALIVE: 'https://files.catbox.moe/3e7u52.jpg'
    },
    
    // Newsletter Settings
    NEWSLETTER_JID: '',
    
    // General
    MAX_RETRIES: 3,
    OTP_EXPIRY: 300000,
    
    // Auto Reply Settings
    AUTO_REPLY_ENABLED: 'true',
    AUTO_REPLY_MESSAGES: {},
    
    // View Once Settings
    AUTO_DOWNLOAD_VV: 'false',
    SEND_VV_TO_INBOX: 'true'
};

// ---------------- STORAGE ----------------
const sessionsDir = path.join(__dirname, 'sessions');
const dataDir = path.join(__dirname, 'bot_data');
const tempDir = path.join(__dirname, 'temp');

fs.ensureDirSync(sessionsDir);
fs.ensureDirSync(dataDir);
fs.ensureDirSync(tempDir);

const sessionFiles = {
    sessions: path.join(dataDir, 'sessions.json'),
    numbers: path.join(dataDir, 'numbers.json'),
    admins: path.join(dataDir, 'admins.json'),
    newsletters: path.join(dataDir, 'newsletters.json'),
    userConfigs: path.join(dataDir, 'user_configs.json'),
    settings: path.join(dataDir, 'settings.json'),
    autoReply: path.join(dataDir, 'auto_reply.json'),
    groupSettings: path.join(dataDir, 'group_settings.json'),
    buttonSettings: path.join(dataDir, 'button_settings.json')
};

// Initialize storage files
Object.values(sessionFiles).forEach(file => {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({}));
});

// Storage helper functions
function readJSON(file) {
    try {
        const data = fs.readFileSync(file, 'utf8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Session management functions
async function saveCredsToFile(number, creds, keys = null) {
    const data = readJSON(sessionFiles.sessions);
    const sanitized = number.replace(/[^0-9]/g, '');
    data[sanitized] = { creds, keys, updatedAt: new Date().toISOString() };
    writeJSON(sessionFiles.sessions, data);
}

async function loadCredsFromFile(number) {
    const data = readJSON(sessionFiles.sessions);
    const sanitized = number.replace(/[^0-9]/g, '');
    return data[sanitized] || null;
}

async function removeSessionFromFile(number) {
    const data = readJSON(sessionFiles.sessions);
    const sanitized = number.replace(/[^0-9]/g, '');
    delete data[sanitized];
    writeJSON(sessionFiles.sessions, data);
    
    const numbers = readJSON(sessionFiles.numbers);
    delete numbers[sanitized];
    writeJSON(sessionFiles.numbers, numbers);
}

async function addNumberToFile(number) {
    const data = readJSON(sessionFiles.numbers);
    const sanitized = number.replace(/[^0-9]/g, '');
    data[sanitized] = { addedAt: new Date().toISOString() };
    writeJSON(sessionFiles.numbers, data);
}

async function getAllNumbersFromFile() {
    const data = readJSON(sessionFiles.numbers);
    return Object.keys(data);
}

// Admin management
async function loadAdminsFromFile() {
    const data = readJSON(sessionFiles.admins);
    return Object.keys(data);
}

async function addAdminToFile(jidOrNumber) {
    const data = readJSON(sessionFiles.admins);
    data[jidOrNumber] = { addedAt: new Date().toISOString() };
    writeJSON(sessionFiles.admins, data);
}

async function removeAdminFromFile(jidOrNumber) {
    const data = readJSON(sessionFiles.admins);
    delete data[jidOrNumber];
    writeJSON(sessionFiles.admins, data);
}

// User config management
async function setUserConfigInFile(number, conf) {
    const data = readJSON(sessionFiles.userConfigs);
    const sanitized = number.replace(/[^0-9]/g, '');
    data[sanitized] = { ...data[sanitized], ...conf, updatedAt: new Date().toISOString() };
    writeJSON(sessionFiles.userConfigs, data);
}

async function loadUserConfigFromFile(number) {
    const data = readJSON(sessionFiles.userConfigs);
    const sanitized = number.replace(/[^0-9]/g, '');
    return data[sanitized] || {};
}

// Newsletter management
async function addNewsletterToFile(jid, emojis = []) {
    const data = readJSON(sessionFiles.newsletters);
    data[jid] = { jid, emojis, addedAt: new Date().toISOString() };
    writeJSON(sessionFiles.newsletters, data);
}

async function removeNewsletterFromFile(jid) {
    const data = readJSON(sessionFiles.newsletters);
    delete data[jid];
    writeJSON(sessionFiles.newsletters, data);
}

async function listNewslettersFromFile() {
    const data = readJSON(sessionFiles.newsletters);
    return Object.values(data);
}

// Auto Reply management
async function getAutoReplyMessages() {
    const data = readJSON(sessionFiles.autoReply);
    return data;
}

async function setAutoReplyMessage(keyword, response) {
    const data = readJSON(sessionFiles.autoReply);
    data[keyword] = { response, createdAt: new Date().toISOString() };
    writeJSON(sessionFiles.autoReply, data);
}

async function deleteAutoReplyMessage(keyword) {
    const data = readJSON(sessionFiles.autoReply);
    delete data[keyword];
    writeJSON(sessionFiles.autoReply, data);
}

// Group Settings management
async function getGroupSetting(groupId, key, defaultValue) {
    const data = readJSON(sessionFiles.groupSettings);
    if (!data[groupId]) data[groupId] = {};
    return data[groupId][key] !== undefined ? data[groupId][key] : defaultValue;
}

async function setGroupSetting(groupId, key, value) {
    const data = readJSON(sessionFiles.groupSettings);
    if (!data[groupId]) data[groupId] = {};
    data[groupId][key] = value;
    writeJSON(sessionFiles.groupSettings, data);
}

// Button Settings management
async function getButtonSetting(groupId) {
    const data = readJSON(sessionFiles.buttonSettings);
    return data[groupId] || { enabled: true };
}

async function setButtonSetting(groupId, setting) {
    const data = readJSON(sessionFiles.buttonSettings);
    data[groupId] = { ...data[groupId], ...setting };
    writeJSON(sessionFiles.buttonSettings, data);
}

// Global settings
async function getGlobalSetting(key, defaultValue) {
    const data = readJSON(sessionFiles.settings);
    return data[key] !== undefined ? data[key] : defaultValue;
}

async function setGlobalSetting(key, value) {
    const data = readJSON(sessionFiles.settings);
    data[key] = value;
    writeJSON(sessionFiles.settings, data);
}

// ---------------- UTILITIES ----------------
function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

// Generate random filename
function generateFileName(ext) {
    return `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
}

// Download media function
async function downloadMedia(message, type) {
    try {
        const stream = await downloadContentFromMessage(message, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer;
    } catch (error) {
        console.error('Download media error:', error);
        return null;
    }
}

const activeSockets = new Map();
const socketCreationTime = new Map();
const otpStore = new Map();

// Fake contact for meta styling
const fakevcard = {
    key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID"
    },
    message: {
        contactMessage: {
            displayName: config.BOT_NAME,
            vcard: `BEGIN:VCARD VERSION:3.0 N:${config.BOT_NAME.replace(/\s+/g, ';')};;;;;;;; FN:${config.BOT_NAME} ORG:WhatsApp Bot TEL;type=CELL;type=VOICE;waid=${config.OWNER_NUMBER}:+${config.OWNER_NUMBER} END:VCARD`
        }
    }
};

// ---------------- GROUP FUNCTIONS ----------------
async function joinGroup(socket) {
    if (config.AUTO_JOIN_GROUP !== 'true' || !config.GROUP_INVITE_LINK) {
        return { status: 'skipped', error: 'Auto join disabled or no invite link' };
    }
    
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) return { status: 'failed', error: 'Invalid group invite link' };
    
    const inviteCode = inviteCodeMatch[1];
    
    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) return { status: 'success', gid: response.gid };
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message && error.message.includes('not-authorized')) errorMessage = 'Bot not authorized';
            else if (error.message && error.message.includes('conflict')) errorMessage = 'Already a member';
            else if (error.message && error.message.includes('gone')) errorMessage = 'Invite invalid/expired';
            
            if (retries === 0) return { status: 'failed', error: errorMessage };
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

// ---------------- STATUS HANDLERS ----------------
async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
        
        try {
            if (config.AUTO_RECORDING === 'true') {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }
            
            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                        if (retries === 0) throw error;
                    }
                }
            }
            
            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(message.key.remoteJid, { 
                            react: { text: randomEmoji, key: message.key } 
                        }, { statusJidList: [message.key.participant] });
                        break;
                    } catch (error) {
                        retries--;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                        if (retries === 0) throw error;
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

// ---------------- AUTO REPLY HANDLER ----------------
async function handleAutoReply(socket, msg, from, senderNumber, body, isQuoted) {
    if (!body || typeof body !== 'string') return false;
    
    const autoReplyMsgs = await getAutoReplyMessages();
    const lowerBody = body.toLowerCase();
    
    for (const [keyword, data] of Object.entries(autoReplyMsgs)) {
        if (lowerBody.includes(keyword.toLowerCase())) {
            // If it's a quoted message, reply to that specific message
            if (isQuoted) {
                await socket.sendMessage(from, { text: data.response }, { quoted: msg });
            } else {
                await socket.sendMessage(from, { text: data.response });
            }
            return true;
        }
    }
    return false;
}

// ---------------- VIEW ONCE HANDLER ----------------
async function handleViewOnce(socket, msg, from) {
    try {
        // Check if message is view once
        const isViewOnce = msg.message?.viewOnceMessage || 
                          msg.message?.viewOnceMessageV2 || 
                          msg.message?.viewOnceMessageV2Extension;
        
        if (!isViewOnce) return false;
        
        console.log('View Once message detected:', msg.key.id);
        
        // Extract the actual message
        const viewOnceContent = msg.message.viewOnceMessage?.message || 
                               msg.message.viewOnceMessageV2?.message || 
                               msg.message.viewOnceMessageV2Extension?.message;
        
        if (!viewOnceContent) return false;
        
        // Get sender info
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderNumber = sender.split('@')[0];
        
        // Download the media
        let mediaBuffer = null;
        let mediaType = '';
        let fileName = '';
        let caption = '';
        
        if (viewOnceContent.imageMessage) {
            mediaType = 'image';
            caption = viewOnceContent.imageMessage.caption || '';
            fileName = generateFileName('jpg');
            mediaBuffer = await downloadMedia(viewOnceContent.imageMessage, 'image');
        } else if (viewOnceContent.videoMessage) {
            mediaType = 'video';
            caption = viewOnceContent.videoMessage.caption || '';
            fileName = generateFileName('mp4');
            mediaBuffer = await downloadMedia(viewOnceContent.videoMessage, 'video');
        } else if (viewOnceContent.audioMessage) {
            mediaType = 'audio';
            fileName = generateFileName('mp3');
            mediaBuffer = await downloadMedia(viewOnceContent.audioMessage, 'audio');
        } else if (viewOnceContent.documentMessage) {
            mediaType = 'document';
            fileName = viewOnceContent.documentMessage.fileName || generateFileName('pdf');
            mediaBuffer = await downloadMedia(viewOnceContent.documentMessage, 'document');
        }
        
        if (!mediaBuffer) return false;
        
        // Save to temp file
        const filePath = path.join(tempDir, fileName);
        fs.writeFileSync(filePath, mediaBuffer);
        
        // Send to inbox if enabled
        if (config.SEND_VV_TO_INBOX === 'true') {
            const userJid = jidNormalizedUser(socket.user.id);
            const captionText = `📸 *View Once Message Received*\n\n👤 From: @${senderNumber}\n📱 Type: ${mediaType}\n🕒 Time: ${getTimestamp()}\n\n${caption}`;
            
            if (mediaType === 'image') {
                await socket.sendMessage(userJid, { 
                    image: { url: filePath }, 
                    caption: captionText,
                    mentions: [sender]
                });
            } else if (mediaType === 'video') {
                await socket.sendMessage(userJid, { 
                    video: { url: filePath }, 
                    caption: captionText,
                    mentions: [sender]
                });
            } else if (mediaType === 'audio') {
                await socket.sendMessage(userJid, { 
                    audio: { url: filePath }, 
                    mimetype: 'audio/mp4',
                    caption: captionText,
                    mentions: [sender]
                });
            } else if (mediaType === 'document') {
                await socket.sendMessage(userJid, { 
                    document: { url: filePath }, 
                    fileName: fileName,
                    caption: captionText,
                    mentions: [sender]
                });
            }
            
            // Also send to the chat where it was received if requested
            if (from !== userJid) {
                await socket.sendMessage(from, { 
                    text: `✅ *View Once message saved and sent to your inbox!*\n\n👤 From: @${senderNumber}`,
                    mentions: [sender]
                }, { quoted: msg });
            }
        }
        
        // Clean up temp file
        setTimeout(() => {
            try { fs.unlinkSync(filePath); } catch(e) {}
        }, 5000);
        
        return true;
    } catch (error) {
        console.error('View Once handler error:', error);
        return false;
    }
}

// ---------------- COMMAND HANDLERS ----------------
function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast') return;
        
        const type = getContentType(msg.message);
        if (!msg.message) return;
        
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? 
            msg.message.ephemeralMessage.message : msg.message;
        
        const from = msg.key.remoteJid;
        const sender = from;
        const nowsender = msg.key.fromMe ? 
            (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : 
            (msg.key.participant || msg.key.remoteJid);
        const senderNumber = (nowsender || '').split('@')[0];
        const botNumber = socket.user.id ? socket.user.id.split(':')[0] : '';
        const isOwner = senderNumber === config.OWNER_NUMBER.replace(/[^0-9]/g, '');
        const isGroup = from.endsWith('@g.us');
        
        // Check if message is quoted
        const isQuoted = !!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
        const quotedMsgId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
        
        const body = (type === 'conversation') ? msg.message.conversation :
            (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text :
            (type === 'imageMessage' && msg.message.imageMessage.caption) ? msg.message.imageMessage.caption :
            (type === 'videoMessage' && msg.message.videoMessage.caption) ? msg.message.videoMessage.caption :
            (type === 'buttonsResponseMessage') ? msg.message.buttonsResponseMessage?.selectedButtonId :
            (type === 'listResponseMessage') ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId :
            (type === 'viewOnceMessage') ? (msg.message.viewOnceMessage?.message?.imageMessage?.caption || '') : '';
        
        // Handle View Once messages automatically if enabled
        if (config.AUTO_DOWNLOAD_VV === 'true') {
            await handleViewOnce(socket, msg, from);
        }
        
        if (!body || typeof body !== 'string') return;
        
        // Handle auto reply (with quoted support)
        if (config.AUTO_REPLY_ENABLED === 'true') {
            const autoReplied = await handleAutoReply(socket, msg, from, senderNumber, body, isQuoted);
        }
        
        const prefix = config.PREFIX;
        const isCmd = body && body.startsWith && body.startsWith(prefix);
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : null;
        const args = body.trim().split(/ +/).slice(1);
        
        if (!command) return;
        
        try {
            // Check button settings for this chat
            const buttonSetting = await getButtonSetting(from);
            
            switch (command) {
                // ============ MAIN MENU ============
                case 'menu':
                case 'help':
                case 'start':
                case 'commands':
                case 'cmd':
                case 'list':
                {
                    await socket.sendMessage(sender, { react: { text: "🎐", key: msg.key } });
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);
                    
                    const userCfg = await loadUserConfigFromFile(number);
                    const botName = userCfg.botName || config.BOT_NAME;
                    const logo = userCfg.logo || config.LOGO_URL;
                    
                    const text = `╭─「 *${botName}* 」─➤
│
│ 👤 *Owner:* ${config.OWNER_NAME}
│ ✏️ *Prefix:* ${config.PREFIX}
│ 🧬 *Version:* ${config.BOT_VERSION}
│ ⏰ *Uptime:* ${hours}h ${minutes}m ${seconds}s
│ 📊 *Type:* Multi-Device
│
├─「 *MAIN MENU* 」─➤
│
│ 1️⃣ 👑 *OWNER COMMANDS* (${config.PREFIX}owner)
│ 2️⃣ 📥 *DOWNLOAD MENU* (${config.PREFIX}download)
│ 3️⃣ 🛠️ *TOOLS MENU* (${config.PREFIX}tools)
│ 4️⃣ ⚙️ *SETTINGS MENU* (${config.PREFIX}settings)
│ 5️⃣ 🎨 *CREATIVE MENU* (${config.PREFIX}creative)
│ 6️⃣ 👥 *GROUP MENU* (${config.PREFIX}groupmenu)
│ 7️⃣ 🤖 *AUTO REPLY* (${config.PREFIX}autoreplymenu)
│ 8️⃣ 🔘 *BUTTON MENU* (${config.PREFIX}buttonmenu)
│ 9️⃣ 📸 *VV/DP MENU* (${config.PREFIX}vvmenu)
│
╰───────────────────●

> *${botName}*`.trim();

                    if (buttonSetting.enabled) {
                        const buttons = [
                            { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: "👑 OWNER" }, type: 1 },
                            { buttonId: `${config.PREFIX}download`, buttonText: { displayText: "📥 DOWNLOAD" }, type: 1 },
                            { buttonId: `${config.PREFIX}tools`, buttonText: { displayText: "🛠️ TOOLS" }, type: 1 },
                            { buttonId: `${config.PREFIX}settings`, buttonText: { displayText: "⚙️ SETTINGS" }, type: 1 },
                            { buttonId: `${config.PREFIX}vvmenu`, buttonText: { displayText: "📸 VV/DP" }, type: 1 }
                        ];
                        
                        let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);
                        await socket.sendMessage(sender, { 
                            image: imagePayload, 
                            caption: text, 
                            footer: `▶ ${botName}`, 
                            buttons, 
                            headerType: 4 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ VV/DP MENU ============
                case 'vvmenu':
                case 'vvcommands':
                case 'dpmenu':
                {
                    await socket.sendMessage(sender, { react: { text: "📸", key: msg.key } });
                    
                    const text = `╭─「 📸 *VV/DP COMMANDS* 」─➤
│
├─「 👤 *PROFILE PICTURE* 」
│ ✦ ${config.PREFIX}getdp [@tag] - Get profile pic
│ ✦ ${config.PREFIX}getmydp - Get your own DP
│ ✦ ${config.PREFIX}getgpdp - Get group DP
│ ✦ ${config.PREFIX}savedp [@tag] - Save DP to inbox
│
├─「 👁️ *VIEW ONCE (VV)* 」
│ ✦ ${config.PREFIX}vv - View/view once message (reply to VV)
│ ✦ ${config.PREFIX}getvv - Get view once content
│ ✦ ${config.PREFIX}vvtoinbox [on/off] - Auto send VV to inbox
│ ✦ ${config.PREFIX}autovv [on/off] - Auto download VV
│
├─「 ⚙️ *VV SETTINGS* 」
│ ✦ ${config.PREFIX}vvstatus - Check VV settings
│ ✦ ${config.PREFIX}vvinbox [on/off]
│ ✦ ${config.PREFIX}vvdownload [on/off]
│
├─「 📝 *HOW TO USE* 」
│ 1. Reply to a view once message with .vv
│ 2. The bot will save and send it to your inbox
│ 3. Use .getdp @user to get profile picture
│
╰───────────────────●

> *View Once & DP Commands*`.trim();

                    if (buttonSetting.enabled) {
                        const buttons = [
                            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📜 MAIN MENU" }, type: 1 },
                            { buttonId: `${config.PREFIX}vvstatus`, buttonText: { displayText: "📊 STATUS" }, type: 1 }
                        ];
                        await socket.sendMessage(sender, { 
                            text, 
                            footer: "📸 VV/DP Commands", 
                            buttons 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ GET DP COMMAND ============
                case 'getdp':
                case 'dp':
                case 'profilepic':
                {
                    await socket.sendMessage(sender, { react: { text: "🖼️", key: msg.key } });
                    
                    let targetJid = null;
                    
                    // Check if replying to a message or tagging someone
                    if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
                        targetJid = msg.message.extendedTextMessage.contextInfo.participant;
                    } else if (args[0]) {
                        // Check if it's a mention
                        if (args[0].startsWith('@')) {
                            const mentioned = args[0].replace('@', '');
                            targetJid = mentioned.includes('@') ? mentioned : `${mentioned}@s.whatsapp.net`;
                        } else {
                            // Assume it's a phone number
                            targetJid = `${args[0].replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                        }
                    } else {
                        // Get sender's own DP
                        targetJid = sender;
                    }
                    
                    try {
                        await socket.sendMessage(sender, { text: '*🔍 Fetching profile picture...*' }, { quoted: fakevcard });
                        
                        // Get profile picture
                        const ppUrl = await socket.profilePictureUrl(targetJid, 'image');
                        
                        if (ppUrl) {
                            await socket.sendMessage(sender, { 
                                image: { url: ppUrl },
                                caption: `✅ *Profile Picture*\n\n👤 User: @${targetJid.split('@')[0]}\n🕒 Time: ${getTimestamp()}`,
                                mentions: [targetJid]
                            }, { quoted: fakevcard });
                            
                            // Also send to inbox if requested
                            if (args.includes('--inbox') || args.includes('-i')) {
                                const userJid = jidNormalizedUser(socket.user.id);
                                await socket.sendMessage(userJid, { 
                                    image: { url: ppUrl },
                                    caption: `📸 *Profile Picture Saved*\n\n👤 User: @${targetJid.split('@')[0]}\n🕒 Time: ${getTimestamp()}`,
                                    mentions: [targetJid]
                                });
                            }
                        } else {
                            await socket.sendMessage(sender, { 
                                text: '❌ User has no profile picture or it\'s private.' 
                            }, { quoted: fakevcard });
                        }
                    } catch (error) {
                        console.error('Get DP error:', error);
                        await socket.sendMessage(sender, { 
                            text: '❌ Failed to get profile picture. User may have no DP or it\'s private.' 
                        }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ GET MY DP ============
                case 'getmydp':
                {
                    await socket.sendMessage(sender, { react: { text: "🖼️", key: msg.key } });
                    
                    try {
                        await socket.sendMessage(sender, { text: '*🔍 Fetching your profile picture...*' }, { quoted: fakevcard });
                        
                        const ppUrl = await socket.profilePictureUrl(sender, 'image');
                        
                        if (ppUrl) {
                            await socket.sendMessage(sender, { 
                                image: { url: ppUrl },
                                caption: `✅ *Your Profile Picture*\n\n👤 User: @${sender.split('@')[0]}\n🕒 Time: ${getTimestamp()}`,
                                mentions: [sender]
                            }, { quoted: fakevcard });
                        } else {
                            await socket.sendMessage(sender, { 
                                text: '❌ You don\'t have a profile picture or it\'s private.' 
                            }, { quoted: fakevcard });
                        }
                    } catch (error) {
                        await socket.sendMessage(sender, { 
                            text: '❌ Failed to get your profile picture.' 
                        }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ GET GROUP DP ============
                case 'getgpdp':
                case 'groupdp':
                {
                    if (!isGroup) {
                        await socket.sendMessage(sender, { text: '❌ This command can only be used in groups!' }, { quoted: msg });
                        return;
                    }
                    
                    await socket.sendMessage(sender, { react: { text: "🖼️", key: msg.key } });
                    
                    try {
                        await socket.sendMessage(sender, { text: '*🔍 Fetching group picture...*' }, { quoted: fakevcard });
                        
                        const ppUrl = await socket.profilePictureUrl(from, 'image');
                        
                        if (ppUrl) {
                            await socket.sendMessage(sender, { 
                                image: { url: ppUrl },
                                caption: `✅ *Group Profile Picture*\n\n👥 Group: ${from.split('@')[0]}\n🕒 Time: ${getTimestamp()}`
                            }, { quoted: fakevcard });
                        } else {
                            await socket.sendMessage(sender, { 
                                text: '❌ Group has no profile picture.' 
                            }, { quoted: fakevcard });
                        }
                    } catch (error) {
                        await socket.sendMessage(sender, { 
                            text: '❌ Failed to get group picture.' 
                        }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ SAVE DP ============
                case 'savedp':
                {
                    await socket.sendMessage(sender, { react: { text: "💾", key: msg.key } });
                    
                    let targetJid = null;
                    
                    if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
                        targetJid = msg.message.extendedTextMessage.contextInfo.participant;
                    } else if (args[0]) {
                        if (args[0].startsWith('@')) {
                            const mentioned = args[0].replace('@', '');
                            targetJid = mentioned.includes('@') ? mentioned : `${mentioned}@s.whatsapp.net`;
                        } else {
                            targetJid = `${args[0].replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                        }
                    } else {
                        targetJid = sender;
                    }
                    
                    try {
                        await socket.sendMessage(sender, { text: '*🔍 Fetching and saving profile picture...*' }, { quoted: fakevcard });
                        
                        const ppUrl = await socket.profilePictureUrl(targetJid, 'image');
                        
                        if (ppUrl) {
                            // Download the image
                            const response = await axios.get(ppUrl, { responseType: 'arraybuffer' });
                            const buffer = Buffer.from(response.data);
                            
                            // Save to temp
                            const fileName = `dp_${targetJid.split('@')[0]}_${Date.now()}.jpg`;
                            const filePath = path.join(tempDir, fileName);
                            fs.writeFileSync(filePath, buffer);
                            
                            // Send to user's inbox
                            const userJid = jidNormalizedUser(socket.user.id);
                            await socket.sendMessage(userJid, { 
                                image: { url: filePath },
                                caption: `📸 *Profile Picture Saved*\n\n👤 User: @${targetJid.split('@')[0]}\n🕒 Time: ${getTimestamp()}`,
                                mentions: [targetJid]
                            });
                            
                            await socket.sendMessage(sender, { 
                                text: `✅ Profile picture saved to your inbox!` 
                            }, { quoted: fakevcard });
                            
                            // Clean up
                            setTimeout(() => {
                                try { fs.unlinkSync(filePath); } catch(e) {}
                            }, 5000);
                        } else {
                            await socket.sendMessage(sender, { 
                                text: '❌ User has no profile picture.' 
                            }, { quoted: fakevcard });
                        }
                    } catch (error) {
                        await socket.sendMessage(sender, { 
                            text: '❌ Failed to save profile picture.' 
                        }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ VIEW ONCE COMMAND ============
                case 'vv':
                case 'getvv':
                case 'viewonce':
                {
                    if (!isQuoted) {
                        await socket.sendMessage(sender, { 
                            text: `❌ Please reply to a view once message with ${config.PREFIX}vv` 
                        }, { quoted: msg });
                        break;
                    }
                    
                    await socket.sendMessage(sender, { react: { text: "👁️", key: msg.key } });
                    await socket.sendMessage(sender, { text: '*📸 Processing view once message...*' }, { quoted: fakevcard });
                    
                    try {
                        // Check if quoted message is view once
                        const isViewOnce = quotedMsg?.viewOnceMessage || 
                                          quotedMsg?.viewOnceMessageV2 || 
                                          quotedMsg?.viewOnceMessageV2Extension;
                        
                        if (!isViewOnce) {
                            await socket.sendMessage(sender, { 
                                text: '❌ This is not a view once message!' 
                            }, { quoted: fakevcard });
                            break;
                        }
                        
                        // Extract the actual message
                        const viewOnceContent = quotedMsg.viewOnceMessage?.message || 
                                               quotedMsg.viewOnceMessageV2?.message || 
                                               quotedMsg.viewOnceMessageV2Extension?.message;
                        
                        if (!viewOnceContent) {
                            await socket.sendMessage(sender, { 
                                text: '❌ Could not extract view once content.' 
                            }, { quoted: fakevcard });
                            break;
                        }
                        
                        // Download and send the media
                        let mediaBuffer = null;
                        let mediaType = '';
                        let caption = '';
                        
                        if (viewOnceContent.imageMessage) {
                            mediaType = 'image';
                            caption = viewOnceContent.imageMessage.caption || '';
                            mediaBuffer = await downloadMedia(viewOnceContent.imageMessage, 'image');
                        } else if (viewOnceContent.videoMessage) {
                            mediaType = 'video';
                            caption = viewOnceContent.videoMessage.caption || '';
                            mediaBuffer = await downloadMedia(viewOnceContent.videoMessage, 'video');
                        } else if (viewOnceContent.audioMessage) {
                            mediaType = 'audio';
                            mediaBuffer = await downloadMedia(viewOnceContent.audioMessage, 'audio');
                        } else if (viewOnceContent.documentMessage) {
                            mediaType = 'document';
                            caption = viewOnceContent.documentMessage.fileName || 'document';
                            mediaBuffer = await downloadMedia(viewOnceContent.documentMessage, 'document');
                        }
                        
                        if (!mediaBuffer) {
                            await socket.sendMessage(sender, { 
                                text: '❌ Failed to download media.' 
                            }, { quoted: fakevcard });
                            break;
                        }
                        
                        // Save to temp
                        const fileName = `vv_${Date.now()}.${mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'mp3' : 'bin'}`;
                        const filePath = path.join(tempDir, fileName);
                        fs.writeFileSync(filePath, mediaBuffer);
                        
                        const captionText = `📸 *View Once Message*\n\n👤 From: @${quotedParticipant?.split('@')[0] || 'Unknown'}\n📱 Type: ${mediaType}\n🕒 Time: ${getTimestamp()}\n\n${caption}`;
                        
                        // Send to user's inbox
                        const userJid = jidNormalizedUser(socket.user.id);
                        
                        if (mediaType === 'image') {
                            await socket.sendMessage(userJid, { 
                                image: { url: filePath }, 
                                caption: captionText,
                                mentions: quotedParticipant ? [quotedParticipant] : []
                            });
                        } else if (mediaType === 'video') {
                            await socket.sendMessage(userJid, { 
                                video: { url: filePath }, 
                                caption: captionText,
                                mentions: quotedParticipant ? [quotedParticipant] : []
                            });
                        } else if (mediaType === 'audio') {
                            await socket.sendMessage(userJid, { 
                                audio: { url: filePath }, 
                                mimetype: 'audio/mp4',
                                caption: captionText,
                                mentions: quotedParticipant ? [quotedParticipant] : []
                            });
                        } else if (mediaType === 'document') {
                            await socket.sendMessage(userJid, { 
                                document: { url: filePath }, 
                                fileName: fileName,
                                caption: captionText,
                                mentions: quotedParticipant ? [quotedParticipant] : []
                            });
                        }
                        
                        // Confirm to user
                        await socket.sendMessage(sender, { 
                            text: `✅ *View Once message saved and sent to your inbox!*` 
                        }, { quoted: fakevcard });
                        
                        // Clean up
                        setTimeout(() => {
                            try { fs.unlinkSync(filePath); } catch(e) {}
                        }, 10000);
                        
                    } catch (error) {
                        console.error('VV command error:', error);
                        await socket.sendMessage(sender, { 
                            text: '❌ Failed to process view once message.' 
                        }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ VV SETTINGS ============
                case 'vvtoinbox':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Permission denied.' }, { quoted: msg });
                        break;
                    }
                    
                    const state = args[0]?.toLowerCase();
                    if (state === 'on' || state === 'off') {
                        config.SEND_VV_TO_INBOX = state === 'on' ? 'true' : 'false';
                        await setGlobalSetting('SEND_VV_TO_INBOX', config.SEND_VV_TO_INBOX);
                        await socket.sendMessage(sender, { 
                            text: `✅ Send VV to inbox set to: *${state}*` 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { 
                            text: `Usage: ${config.PREFIX}vvtoinbox [on/off]\nCurrent: ${config.SEND_VV_TO_INBOX === 'true' ? 'ON ✅' : 'OFF ❌'}` 
                        }, { quoted: msg });
                    }
                    break;
                }
                
                case 'autovv':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Permission denied.' }, { quoted: msg });
                        break;
                    }
                    
                    const state = args[0]?.toLowerCase();
                    if (state === 'on' || state === 'off') {
                        config.AUTO_DOWNLOAD_VV = state === 'on' ? 'true' : 'false';
                        await setGlobalSetting('AUTO_DOWNLOAD_VV', config.AUTO_DOWNLOAD_VV);
                        await socket.sendMessage(sender, { 
                            text: `✅ Auto download VV set to: *${state}*` 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { 
                            text: `Usage: ${config.PREFIX}autovv [on/off]\nCurrent: ${config.AUTO_DOWNLOAD_VV === 'true' ? 'ON ✅' : 'OFF ❌'}` 
                        }, { quoted: msg });
                    }
                    break;
                }
                
                case 'vvstatus':
                {
                    const status = `╭─「 📸 *VV SYSTEM STATUS* 」─➤
│
│ 🔄 Auto Download: ${config.AUTO_DOWNLOAD_VV === 'true' ? 'ON ✅' : 'OFF ❌'}
│ 📬 Send to Inbox: ${config.SEND_VV_TO_INBOX === 'true' ? 'ON ✅' : 'OFF ❌'}
│
│ *Commands Available:*
│ ✦ ${config.PREFIX}vv - Manual VV download
│ ✦ ${config.PREFIX}autovv [on/off]
│ ✦ ${config.PREFIX}vvtoinbox [on/off]
│
╰───────────────────●`;

                    await socket.sendMessage(sender, { text: status }, { quoted: fakevcard });
                    break;
                }
                
                // ============ ENHANCED AUTO REPLY SETTINGS ============
                case 'addreply':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Owner/Admin only command.' }, { quoted: msg });
                        break;
                    }
                    
                    const input = args.join(' ');
                    const [keyword, ...responseParts] = input.split('|');
                    
                    if (!keyword || responseParts.length === 0) {
                        await socket.sendMessage(sender, { 
                            text: `Usage: ${config.PREFIX}addreply keyword|response` 
                        }, { quoted: msg });
                        break;
                    }
                    
                    const response = responseParts.join('|').trim();
                    await setAutoReplyMessage(keyword.trim(), response);
                    await socket.sendMessage(sender, { 
                        text: `✅ *Auto reply added!*\n\n🔑 Keyword: *${keyword.trim()}*\n💬 Response: ${response.substring(0, 50)}${response.length > 50 ? '...' : ''}` 
                    }, { quoted: fakevcard });
                    break;
                }
                
                case 'testreply':
                {
                    const keyword = args[0];
                    if (!keyword) {
                        await socket.sendMessage(sender, { 
                            text: `Usage: ${config.PREFIX}testreply [keyword]` 
                        }, { quoted: msg });
                        break;
                    }
                    
                    const autoReplyMsgs = await getAutoReplyMessages();
                    if (autoReplyMsgs[keyword]) {
                        await socket.sendMessage(sender, { 
                            text: `✅ *Auto Reply Test*\n\nKeyword: *${keyword}*\nResponse: ${autoReplyMsgs[keyword].response}` 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { 
                            text: `❌ No auto reply found for keyword: *${keyword}*` 
                        }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ OWNER COMMANDS (30+) ============
                case 'owner':
                case 'ownercommands':
                case 'ownerhelp':
                {
                    await socket.sendMessage(sender, { react: { text: "👑", key: msg.key } });
                    
                    const text = `╭─「 👑 *OWNER COMMANDS* 」─➤
│
├─「 *BOT MANAGEMENT* 」
│ ✦ ${config.PREFIX}setname [name]
│ ✦ ${config.PREFIX}setlogo [url]
│ ✦ ${config.PREFIX}setprefix [symbol]
│ ✦ ${config.PREFIX}setbotbio
│ ✦ ${config.PREFIX}setstatus [text]
│ ✦ ${config.PREFIX}setpp [image]
│ ✦ ${config.PREFIX}deleteme
│ ✦ ${config.PREFIX}restart
│ ✦ ${config.PREFIX}shutdown
│ ✦ ${config.PREFIX}update
│
├─「 *SESSION MANAGEMENT* 」
│ ✦ ${config.PREFIX}listsessions
│ ✦ ${config.PREFIX}viewsessions
│ ✦ ${config.PREFIX}killsession [number]
│ ✦ ${config.PREFIX}blocksession [number]
│ ✦ ${config.PREFIX}unblocksession [number]
│ ✦ ${config.PREFIX}clearsessions
│
├─「 *ADMIN MANAGEMENT* 」
│ ✦ ${config.PREFIX}addadmin [number]
│ ✦ ${config.PREFIX}removeadmin [number]
│ ✦ ${config.PREFIX}listadmins
│ ✦ ${config.PREFIX}promote [number]
│ ✦ ${config.PREFIX}demote [number]
│
├─「 *BROADCAST* 」
│ ✦ ${config.PREFIX}bc [message]
│ ✦ ${config.PREFIX}bcimage [caption]
│ ✦ ${config.PREFIX}bcvideo [caption]
│ ✦ ${config.PREFIX}bcgroups [message]
│ ✦ ${config.PREFIX}bccontacts [message]
│
├─「 *SYSTEM* 」
│ ✦ ${config.PREFIX}stats
│ ✦ ${config.PREFIX}systeminfo
│ ✦ ${config.PREFIX}botinfo
│ ✦ ${config.PREFIX}serverinfo
│ ✦ ${config.PREFIX}performance
│ ✦ ${config.PREFIX}memory
│ ✦ ${config.PREFIX}cpu
│
╰───────────────────●

> *Owner Only Commands*`.trim();

                    if (buttonSetting.enabled) {
                        const buttons = [
                            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📜 MAIN MENU" }, type: 1 },
                            { buttonId: `${config.PREFIX}stats`, buttonText: { displayText: "📊 STATS" }, type: 1 }
                        ];
                        await socket.sendMessage(sender, { 
                            text, 
                            footer: "👑 Owner Commands", 
                            buttons 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ GROUP COMMANDS (30+) ============
                case 'group':
                case 'groupmenu':
                case 'groupcommands':
                {
                    if (!isGroup) {
                        await socket.sendMessage(sender, { text: '❌ This command can only be used in groups!' }, { quoted: msg });
                        return;
                    }
                    
                    await socket.sendMessage(sender, { react: { text: "👥", key: msg.key } });
                    
                    const text = `╭─「 👥 *GROUP COMMANDS* 」─➤
│
├─「 *GROUP MANAGEMENT* 」
│ ✦ ${config.PREFIX}groupinfo
│ ✦ ${config.PREFIX}grouplink
│ ✦ ${config.PREFIX}revoke
│ ✦ ${config.PREFIX}setgroupname [name]
│ ✦ ${config.PREFIX}setgroupdesc [text]
│ ✦ ${config.PREFIX}setgrouppp [image]
│ ✦ ${config.PREFIX}lockgroup
│ ✦ ${config.PREFIX}unlockgroup
│ ✦ ${config.PREFIX}announceon
│ ✦ ${config.PREFIX}announceoff
│
├─「 *MEMBER MANAGEMENT* 」
│ ✦ ${config.PREFIX}add [number]
│ ✦ ${config.PREFIX}kick @tag
│ ✦ ${config.PREFIX}remove @tag
│ ✦ ${config.PREFIX}promote @tag
│ ✦ ${config.PREFIX}demote @tag
│ ✦ ${config.PREFIX}mentionall
│ ✦ ${config.PREFIX}tagall
│ ✦ ${config.PREFIX}hidetag [text]
│ ✦ ${config.PREFIX}getadmin
│ ✦ ${config.PREFIX}getowner
│
├─「 *GROUP SETTINGS* 」
│ ✦ ${config.PREFIX}welcome [on/off]
│ ✦ ${config.PREFIX}goodbye [on/off]
│ ✦ ${config.PREFIX}antilink [on/off]
│ ✦ ${config.PREFIX}antispam [on/off]
│ ✦ ${config.PREFIX}antiviewonce [on/off]
│ ✦ ${config.PREFIX}antidelete [on/off]
│ ✦ ${config.PREFIX}filter [on/off]
│ ✦ ${config.PREFIX}nsfw [on/off]
│ ✦ ${config.PREFIX}simsimi [on/off]
│
├─「 *GROUP INFO* 」
│ ✦ ${config.PREFIX}admins
│ ✦ ${config.PREFIX}members
│ ✦ ${config.PREFIX}invitelist
│ ✦ ${config.PREFIX}requestlist
│ ✦ ${config.PREFIX}pending
│
╰───────────────────●

> *Group Management Commands*`.trim();

                    if (buttonSetting.enabled) {
                        const buttons = [
                            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📜 MAIN MENU" }, type: 1 },
                            { buttonId: `${config.PREFIX}groupinfo`, buttonText: { displayText: "📊 GROUP INFO" }, type: 1 }
                        ];
                        await socket.sendMessage(sender, { 
                            text, 
                            footer: "👥 Group Commands", 
                            buttons 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ DOWNLOAD MENU ============
                case 'download':
                case 'downloadmenu':
                {
                    await socket.sendMessage(sender, { react: { text: "📥", key: msg.key } });
                    
                    const text = `╭─「 📥 *DOWNLOAD MENU* 」─➤
│
├─「 🎵 *AUDIO/MUSIC* 」
│ ✦ ${config.PREFIX}song [query]
│ ✦ ${config.PREFIX}ytmp3 [url]
│ ✦ ${config.PREFIX}play [song name]
│ ✦ ${config.PREFIX}spotify [url]
│ ✦ ${config.PREFIX}deezer [url]
│ ✦ ${config.PREFIX}soundcloud [url]
│
├─「 🎬 *VIDEO* 」
│ ✦ ${config.PREFIX}ytmp4 [url]
│ ✦ ${config.PREFIX}video [query]
│ ✦ ${config.PREFIX}ytplay [video]
│ ✦ ${config.PREFIX}tiktok [url]
│ ✦ ${config.PREFIX}tiktoknowm [url]
│ ✦ ${config.PREFIX}instagram [url]
│ ✦ ${config.PREFIX}fbvideo [url]
│ ✦ ${config.PREFIX}twitter [url]
│ ✦ ${config.PREFIX}terabox [url]
│
├─「 📱 *SOCIAL MEDIA* 」
│ ✦ ${config.PREFIX}igphoto [url]
│ ✦ ${config.PREFIX}igvideo [url]
│ ✦ ${config.PREFIX}igstory [username]
│ ✦ ${config.PREFIX}fbphoto [url]
│ ✦ ${config.PREFIX}pinterest [query]
│ ✦ ${config.PREFIX}threads [url]
│ ✦ ${config.PREFIX}snaptik [url]
│
├─「 📁 *FILES/DOCUMENTS* 」
│ ✦ ${config.PREFIX}mediafire [url]
│ ✦ ${config.PREFIX}apksearch [app]
│ ✦ ${config.PREFIX}apkdownload [app]
│ ✦ ${config.PREFIX}modapk [app]
│ ✦ ${config.PREFIX}pdf [query]
│ ✦ ${config.PREFIX}doc [query]
│
├─「 🔍 *SEARCH* 」
│ ✦ ${config.PREFIX}yts [query]
│ ✦ ${config.PREFIX}google [query]
│ ✦ ${config.PREFIX}image [query]
│ ✦ ${config.PREFIX}wallpaper [query]
│ ✦ ${config.PREFIX}wikimedia [query]
│
╰───────────────────●

> *Download Commands*`.trim();

                    if (buttonSetting.enabled) {
                        const buttons = [
                            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📜 MAIN MENU" }, type: 1 },
                            { buttonId: `${config.PREFIX}song`, buttonText: { displayText: "🎵 SONG" }, type: 1 }
                        ];
                        await socket.sendMessage(sender, { 
                            text, 
                            footer: "📥 Download Commands", 
                            buttons 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ TOOLS MENU ============
                case 'tools':
                case 'toolmenu':
                case 'utilities':
                {
                    await socket.sendMessage(sender, { react: { text: "🛠️", key: msg.key } });
                    
                    const text = `╭─「 🛠️ *TOOLS MENU* 」─➤
│
├─「 📊 *BOT STATUS* 」
│ ✦ ${config.PREFIX}ping
│ ✦ ${config.PREFIX}alive
│ ✦ ${config.PREFIX}speed
│ ✦ ${config.PREFIX}uptime
│ ✦ ${config.PREFIX}runtime
│
├─「 🔍 *INFO TOOLS* 」
│ ✦ ${config.PREFIX}sticker
│ ✦ ${config.PREFIX}toimg
│ ✦ ${config.PREFIX}tovid
│ ✦ ${config.PREFIX}tomp3
│ ✦ ${config.PREFIX}quote
│ ✦ ${config.PREFIX}weather [city]
│ ✦ ${config.PREFIX}time [country]
│ ✦ ${config.PREFIX}date
│
├─「 🎯 *UTILITIES* 」
│ ✦ ${config.PREFIX}calc [expression]
│ ✦ ${config.PREFIX}math [expression]
│ ✦ ${config.PREFIX}qr [text]
│ ✦ ${config.PREFIX}qrread [image]
│ ✦ ${config.PREFIX}shorten [url]
│ ✦ ${config.PREFIX}translate [lang] [text]
│ ✦ ${config.PREFIX}define [word]
│ ✦ ${config.PREFIX}spell [text]
│
├─「 🔢 *CONVERTERS* 」
│ ✦ ${config.PREFIX}currency [amount] [from] [to]
│ ✦ ${config.PREFIX}unit [value] [from] [to]
│ ✦ ${config.PREFIX}json [text]
│ ✦ ${config.PREFIX}b64encode [text]
│ ✦ ${config.PREFIX}b64decode [text]
│
├─「 🌐 *WEB TOOLS* 」
│ ✦ ${config.PREFIX}webcheck [url]
│ ✦ ${config.PREFIX}whois [domain]
│ ✦ ${config.PREFIX}headers [url]
│ ✦ ${config.PREFIX}ipinfo [ip]
│
╰───────────────────●

> *Tools & Utilities*`.trim();

                    if (buttonSetting.enabled) {
                        const buttons = [
                            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📜 MAIN MENU" }, type: 1 },
                            { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: "⚡ PING" }, type: 1 }
                        ];
                        await socket.sendMessage(sender, { 
                            text, 
                            footer: "🛠️ Tools Menu", 
                            buttons 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ SETTINGS MENU ============
                case 'settings':
                case 'setting':
                case 'config':
                {
                    await socket.sendMessage(sender, { react: { text: "⚙️", key: msg.key } });
                    
                    const text = `╭─「 ⚙️ *SETTINGS MENU* 」─➤
│
├─「 🤖 *BOT CUSTOMIZATION* 」
│ ✦ ${config.PREFIX}setname [name]
│ ✦ ${config.PREFIX}setlogo [url]
│ ✦ ${config.PREFIX}setprefix [symbol]
│ ✦ ${config.PREFIX}resetconfig
│ ✦ ${config.PREFIX}viewconfig
│
├─「 🔧 *FEATURE SETTINGS* 」
│ ✦ ${config.PREFIX}autostatus [on/off]
│ ✦ ${config.PREFIX}autorecord [on/off]
│ ✦ ${config.PREFIX}autogroup [on/off]
│ ✦ ${config.PREFIX}autoread [on/off]
│ ✦ ${config.PREFIX}autobio [on/off]
│ ✦ ${config.PREFIX}autovv [on/off]
│ ✦ ${config.PREFIX}vvtoinbox [on/off]
│
├─「 🎨 *DISPLAY SETTINGS* 」
│ ✦ ${config.PREFIX}themecolor [color]
│ ✦ ${config.PREFIX}setfooter [text]
│ ✦ ${config.PREFIX}setheader [text]
│ ✦ ${config.PREFIX}setemojistyle [style]
│
├─「 🔐 *PRIVACY SETTINGS* 」
│ ✦ ${config.PREFIX}block [number]
│ ✦ ${config.PREFIX}unblock [number]
│ ✦ ${config.PREFIX}blocklist
│ ✦ ${config.PREFIX}privacy [setting]
│
├─「 🗑️ *SESSION MANAGEMENT* 」
│ ✦ ${config.PREFIX}deleteme
│ ✦ ${config.PREFIX}restart
│ ✦ ${config.PREFIX}logout
│ ✦ ${config.PREFIX}clearcache
│
╰───────────────────●

> *Configuration Settings*`.trim();

                    if (buttonSetting.enabled) {
                        const buttons = [
                            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📜 MAIN MENU" }, type: 1 },
                            { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: "👑 OWNER" }, type: 1 }
                        ];
                        await socket.sendMessage(sender, { 
                            text, 
                            footer: "⚙️ Settings Menu", 
                            buttons 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ CREATIVE MENU ============
                case 'creative':
                case 'creativemenu':
                case 'fun':
                {
                    await socket.sendMessage(sender, { react: { text: "🎨", key: msg.key } });
                    
                    const text = `╭─「 🎨 *CREATIVE MENU* 」─➤
│
├─「 🤖 *AI FEATURES* 」
│ ✦ ${config.PREFIX}ai [message]
│ ✦ ${config.PREFIX}gpt [prompt]
│ ✦ ${config.PREFIX}bard [question]
│ ✦ ${config.PREFIX}gemini [prompt]
│ ✦ ${config.PREFIX}llama [message]
│ ✦ ${config.PREFIX}claude [question]
│
├─「 ✍️ *TEXT TOOLS* 」
│ ✦ ${config.PREFIX}fancy [text]
│ ✦ ${config.PREFIX}glitch [text]
│ ✦ ${config.PREFIX}font [text]
│ ✦ ${config.PREFIX}style [text]
│ ✦ ${config.PREFIX}reverse [text]
│ ✦ ${config.PREFIX}count [text]
│
├─「 🖼️ *IMAGE TOOLS* 」
│ ✦ ${config.PREFIX}sticker
│ ✦ ${config.PREFIX}circle
│ ✦ ${config.PREFIX}blur
│ ✦ ${config.PREFIX}bright
│ ✦ ${config.PREFIX}dark
│ ✦ ${config.PREFIX}greyscale
│ ✦ ${config.PREFIX}invert
│ ✦ ${config.PREFIX}mirror
│
├─「 🎮 *GAMES* 」
│ ✦ ${config.PREFIX}ttt [@tag]
│ ✦ ${config.PREFIX}rps [choice]
│ ✦ ${config.PREFIX}dice
│ ✦ ${config.PREFIX}flipcoin
│ ✦ ${config.PREFIX}guessnumber
│ ✦ ${config.PREFIX}mathquiz
│
├─「 🎵 *AUDIO TOOLS* 」
│ ✦ ${config.PREFIX}bass [audio]
│ ✦ ${config.PREFIX}slow [audio]
│ ✦ ${config.PREFIX}fast [audio]
│ ✦ ${config.PREFIX}vibes [audio]
│
╰───────────────────●

> *Creative & Fun Commands*`.trim();

                    if (buttonSetting.enabled) {
                        const buttons = [
                            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📜 MAIN MENU" }, type: 1 },
                            { buttonId: `${config.PREFIX}ai`, buttonText: { displayText: "🤖 AI" }, type: 1 }
                        ];
                        await socket.sendMessage(sender, { 
                            text, 
                            footer: "🎨 Creative Menu", 
                            buttons 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ AUTO REPLY MENU ============
                case 'autoreply':
                case 'autoreplymenu':
                case 'automessage':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Owner/Admin only command.' }, { quoted: msg });
                        break;
                    }
                    
                    await socket.sendMessage(sender, { react: { text: "🤖", key: msg.key } });
                    
                    const autoReplyMsgs = await getAutoReplyMessages();
                    let autoList = '';
                    let index = 1;
                    
                    for (const [keyword, data] of Object.entries(autoReplyMsgs)) {
                        autoList += `${index}. *${keyword}* ➜ ${data.response.substring(0, 30)}...\n`;
                        index++;
                        if (index > 10) break;
                    }
                    
                    const text = `╭─「 🤖 *AUTO REPLY MENU* 」─➤
│
├─「 *STATUS* 」
│ 📢 Auto Reply: ${config.AUTO_REPLY_ENABLED === 'true' ? 'ON ✅' : 'OFF ❌'}
│
├─「 *COMMANDS* 」
│ ✦ ${config.PREFIX}addreply [keyword]|[response]
│ ✦ ${config.PREFIX}delreply [keyword]
│ ✦ ${config.PREFIX}listreply
│ ✦ ${config.PREFIX}replyon
│ ✦ ${config.PREFIX}replyoff
│ ✦ ${config.PREFIX}editreply [keyword]|[new response]
│ ✦ ${config.PREFIX}testreply [keyword]
│ ✦ ${config.PREFIX}cleareply
│
├─「 *ACTIVE REPLIES* 」
${autoList || '│ ⚠️ No auto replies set'}
│
├─「 *FEATURES* 」
│ • Auto reply works with quoted messages
│ • Replies to the specific quoted message
│ • Multiple keywords supported
│
╰───────────────────●

> *Auto Reply System*`.trim();

                    if (buttonSetting.enabled) {
                        const buttons = [
                            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📜 MAIN MENU" }, type: 1 },
                            { buttonId: `${config.PREFIX}listreply`, buttonText: { displayText: "📋 LIST" }, type: 1 }
                        ];
                        await socket.sendMessage(sender, { 
                            text, 
                            footer: "🤖 Auto Reply", 
                            buttons 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ BUTTON MENU ============
                case 'button':
                case 'buttonmenu':
                case 'btns':
                {
                    await socket.sendMessage(sender, { react: { text: "🔘", key: msg.key } });
                    
                    const currentSetting = await getButtonSetting(from);
                    const status = currentSetting.enabled ? 'ON ✅' : 'OFF ❌';
                    
                    const text = `╭─「 🔘 *BUTTON SETTINGS* 」─➤
│
│ 📍 *Chat:* ${from.includes('g.us') ? 'Group' : 'Private'}
│ 🔘 *Status:* ${status}
│
├─「 *COMMANDS* 」
│ ✦ ${config.PREFIX}buttonon
│ ✦ ${config.PREFIX}buttonoff
│ ✦ ${config.PREFIX}buttonstatus
│
├─「 *DESCRIPTION* 」
│ Buttons add interactive elements to messages.
│ When ON: Commands show with interactive buttons
│ When OFF: Commands show as plain text
│
╰───────────────────●

> *Button Configuration*`.trim();

                    const buttons = [
                        { buttonId: `${config.PREFIX}buttonon`, buttonText: { displayText: "🔘 ON" }, type: 1 },
                        { buttonId: `${config.PREFIX}buttonoff`, buttonText: { displayText: "🔘 OFF" }, type: 1 },
                        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📜 MENU" }, type: 1 }
                    ];
                    
                    await socket.sendMessage(sender, { 
                        text, 
                        footer: "🔘 Button Settings", 
                        buttons 
                    }, { quoted: fakevcard });
                    break;
                }
                
                // ============ BUTTON CONTROL ============
                case 'buttonon':
                {
                    await setButtonSetting(from, { enabled: true });
                    await socket.sendMessage(sender, { 
                        text: '✅ Buttons enabled for this chat!', 
                        footer: '🔘 Button Settings' 
                    }, { quoted: fakevcard });
                    break;
                }
                
                case 'buttonoff':
                {
                    await setButtonSetting(from, { enabled: false });
                    await socket.sendMessage(sender, { 
                        text: '✅ Buttons disabled for this chat!', 
                        footer: '🔘 Button Settings' 
                    }, { quoted: fakevcard });
                    break;
                }
                
                case 'buttonstatus':
                {
                    const currentSetting = await getButtonSetting(from);
                    const status = currentSetting.enabled ? 'ON ✅' : 'OFF ❌';
                    await socket.sendMessage(sender, { 
                        text: `🔘 Buttons are: *${status}* for this chat`, 
                        footer: 'Button Status' 
                    }, { quoted: fakevcard });
                    break;
                }
                
                // ============ AUTO REPLY MANAGEMENT ============
                case 'addreply':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Owner/Admin only command.' }, { quoted: msg });
                        break;
                    }
                    
                    const input = args.join(' ');
                    const [keyword, ...responseParts] = input.split('|');
                    
                    if (!keyword || responseParts.length === 0) {
                        await socket.sendMessage(sender, { 
                            text: `Usage: ${config.PREFIX}addreply keyword|response` 
                        }, { quoted: msg });
                        break;
                    }
                    
                    const response = responseParts.join('|').trim();
                    await setAutoReplyMessage(keyword.trim(), response);
                    await socket.sendMessage(sender, { 
                        text: `✅ Auto reply added!\n\nKeyword: *${keyword.trim()}*\nResponse: ${response.substring(0, 50)}${response.length > 50 ? '...' : ''}` 
                    }, { quoted: fakevcard });
                    break;
                }
                
                case 'delreply':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Owner/Admin only command.' }, { quoted: msg });
                        break;
                    }
                    
                    const keyword = args[0];
                    if (!keyword) {
                        await socket.sendMessage(sender, { 
                            text: `Usage: ${config.PREFIX}delreply [keyword]` 
                        }, { quoted: msg });
                        break;
                    }
                    
                    await deleteAutoReplyMessage(keyword);
                    await socket.sendMessage(sender, { 
                        text: `✅ Auto reply deleted for keyword: *${keyword}*` 
                    }, { quoted: fakevcard });
                    break;
                }
                
                case 'listreply':
                {
                    const autoReplyMsgs = await getAutoReplyMessages();
                    let replyText = '*📋 Auto Reply List*\n\n';
                    
                    if (Object.keys(autoReplyMsgs).length === 0) {
                        replyText += 'No auto replies configured yet.';
                    } else {
                        let index = 1;
                        for (const [keyword, data] of Object.entries(autoReplyMsgs)) {
                            replyText += `${index}. *${keyword}*\n   ↳ ${data.response.substring(0, 50)}${data.response.length > 50 ? '...' : ''}\n\n`;
                            index++;
                        }
                    }
                    
                    await socket.sendMessage(sender, { text: replyText }, { quoted: fakevcard });
                    break;
                }
                
                case 'replyon':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Owner/Admin only command.' }, { quoted: msg });
                        break;
                    }
                    
                    config.AUTO_REPLY_ENABLED = 'true';
                    await setGlobalSetting('AUTO_REPLY_ENABLED', 'true');
                    await socket.sendMessage(sender, { 
                        text: '✅ Auto Reply system *ENABLED*' 
                    }, { quoted: fakevcard });
                    break;
                }
                
                case 'replyoff':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Owner/Admin only command.' }, { quoted: msg });
                        break;
                    }
                    
                    config.AUTO_REPLY_ENABLED = 'false';
                    await setGlobalSetting('AUTO_REPLY_ENABLED', 'false');
                    await socket.sendMessage(sender, { 
                        text: '✅ Auto Reply system *DISABLED*' 
                    }, { quoted: fakevcard });
                    break;
                }
                
                case 'editreply':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Owner/Admin only command.' }, { quoted: msg });
                        break;
                    }
                    
                    const input = args.join(' ');
                    const [keyword, ...responseParts] = input.split('|');
                    
                    if (!keyword || responseParts.length === 0) {
                        await socket.sendMessage(sender, { 
                            text: `Usage: ${config.PREFIX}editreply keyword|new response` 
                        }, { quoted: msg });
                        break;
                    }
                    
                    const response = responseParts.join('|').trim();
                    await setAutoReplyMessage(keyword.trim(), response);
                    await socket.sendMessage(sender, { 
                        text: `✅ Auto reply updated for keyword: *${keyword.trim()}*` 
                    }, { quoted: fakevcard });
                    break;
                }
                
                case 'testreply':
                {
                    const keyword = args[0];
                    if (!keyword) {
                        await socket.sendMessage(sender, { 
                            text: `Usage: ${config.PREFIX}testreply [keyword]` 
                        }, { quoted: msg });
                        break;
                    }
                    
                    const autoReplyMsgs = await getAutoReplyMessages();
                    if (autoReplyMsgs[keyword]) {
                        await socket.sendMessage(sender, { 
                            text: `✅ *Auto Reply Test*\n\nKeyword: *${keyword}*\nResponse: ${autoReplyMsgs[keyword].response}` 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { 
                            text: `❌ No auto reply found for keyword: *${keyword}*` 
                        }, { quoted: fakevcard });
                    }
                    break;
                }
                
                case 'cleareply':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Owner/Admin only command.' }, { quoted: msg });
                        break;
                    }
                    
                    writeJSON(sessionFiles.autoReply, {});
                    await socket.sendMessage(sender, { 
                        text: '✅ All auto replies cleared!' 
                    }, { quoted: fakevcard });
                    break;
                }
                
                // ============ BOT CUSTOMIZATION ============
                case 'setname':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Owner/Admin only command.' }, { quoted: msg });
                        break;
                    }
                    
                    if (!args[0]) {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}setname [new bot name]` }, { quoted: msg });
                        break;
                    }
                    
                    const newName = args.join(' ');
                    await setUserConfigInFile(number, { botName: newName });
                    await socket.sendMessage(sender, { text: `✅ Bot name changed to: *${newName}*` }, { quoted: fakevcard });
                    break;
                }
                
                case 'setlogo':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Owner/Admin only command.' }, { quoted: msg });
                        break;
                    }
                    
                    if (!args[0]) {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}setlogo [image url]` }, { quoted: msg });
                        break;
                    }
                    
                    const logoUrl = args[0];
                    await setUserConfigInFile(number, { logo: logoUrl });
                    await socket.sendMessage(sender, { text: `✅ Bot logo changed!` }, { quoted: fakevcard });
                    break;
                }
                
                case 'setprefix':
                {
                    if (!isOwner) {
                        await socket.sendMessage(sender, { text: '❌ Owner only command.' }, { quoted: msg });
                        break;
                    }
                    
                    if (!args[0]) {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}setprefix [symbol]` }, { quoted: msg });
                        break;
                    }
                    
                    config.PREFIX = args[0];
                    await socket.sendMessage(sender, { text: `✅ Bot prefix changed to: *${args[0]}*` }, { quoted: fakevcard });
                    break;
                }
                
                case 'resetconfig':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await socket.sendMessage(sender, { text: '❌ Owner/Admin only command.' }, { quoted: msg });
                        break;
                    }
                    
                    await setUserConfigInFile(number, {});
                    await socket.sendMessage(sender, { text: `✅ Bot configuration reset to default!` }, { quoted: fakevcard });
                    break;
                }
                
                case 'viewconfig':
                {
                    const userCfg = await loadUserConfigFromFile(number);
                    const botName = userCfg.botName || config.BOT_NAME;
                    const logo = userCfg.logo || config.LOGO_URL;
                    
                    const configText = `╭─「 ⚙️ *BOT CONFIG* 」─➤
│
│ 🤖 *Name:* ${botName}
│ 🖼️ *Logo:* ${logo.substring(0, 50)}...
│ ✏️ *Prefix:* ${config.PREFIX}
│ 📊 *Version:* ${config.BOT_VERSION}
│
╰───────────────────●`;

                    await socket.sendMessage(sender, { text: configText }, { quoted: fakevcard });
                    break;
                }
                
                // ============ FEATURE SETTINGS ============
                case 'autostatus':
                {
                    const state = args[0]?.toLowerCase();
                    if (state === 'on' || state === 'off') {
                        config.AUTO_VIEW_STATUS = state === 'on' ? 'true' : 'false';
                        config.AUTO_LIKE_STATUS = state === 'on' ? 'true' : 'false';
                        await setGlobalSetting('AUTO_VIEW_STATUS', config.AUTO_VIEW_STATUS);
                        await setGlobalSetting('AUTO_LIKE_STATUS', config.AUTO_LIKE_STATUS);
                        await socket.sendMessage(sender, { text: `✅ Auto Status set to: *${state}*` }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}autostatus [on/off]\nCurrent: ${config.AUTO_VIEW_STATUS === 'true' ? 'ON ✅' : 'OFF ❌'}` }, { quoted: msg });
                    }
                    break;
                }
                
                case 'autorecord':
                {
                    const state = args[0]?.toLowerCase();
                    if (state === 'on' || state === 'off') {
                        config.AUTO_RECORDING = state === 'on' ? 'true' : 'false';
                        await setGlobalSetting('AUTO_RECORDING', config.AUTO_RECORDING);
                        await socket.sendMessage(sender, { text: `✅ Auto Recording set to: *${state}*` }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}autorecord [on/off]\nCurrent: ${config.AUTO_RECORDING === 'true' ? 'ON ✅' : 'OFF ❌'}` }, { quoted: msg });
                    }
                    break;
                }
                
                case 'autogroup':
                {
                    const state = args[0]?.toLowerCase();
                    if (state === 'on' || state === 'off') {
                        config.AUTO_JOIN_GROUP = state === 'on' ? 'true' : 'false';
                        await setGlobalSetting('AUTO_JOIN_GROUP', config.AUTO_JOIN_GROUP);
                        await socket.sendMessage(sender, { text: `✅ Auto Group Join set to: *${state}*` }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}autogroup [on/off]\nCurrent: ${config.AUTO_JOIN_GROUP === 'true' ? 'ON ✅' : 'OFF ❌'}` }, { quoted: msg });
                    }
                    break;
                }
                
                // ============ DOWNLOAD COMMANDS ============
                case 'song':
                case 'play':
                {
                    const query = args.join(' ');
                    if (!query) {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}song [song name]` }, { quoted: msg });
                        break;
                    }
                    
                    try {
                        await socket.sendMessage(sender, { react: { text: "🎵", key: msg.key } });
                        await socket.sendMessage(sender, { text: '*🔍 Searching for song...*' }, { quoted: fakevcard });
                        
                        const search = await yts(query);
                        if (!search?.videos?.length) {
                            await socket.sendMessage(sender, { text: '❌ No results found!' }, { quoted: fakevcard });
                            break;
                        }
                        
                        const video = search.videos[0];
                        const api = `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(video.url)}`;
                        const res = await axios.get(api, { timeout: 60000 });
                        
                        if (!res?.data?.result?.download) throw "API_FAILED";
                        
                        await socket.sendMessage(sender, { 
                            audio: { url: res.data.result.download }, 
                            mimetype: "audio/mpeg", 
                            ptt: false 
                        }, { quoted: fakevcard });
                        
                        await socket.sendMessage(sender, { 
                            text: `✅ *${video.title}*\n⏱️ ${video.timestamp}\n📊 ${video.views} views` 
                        }, { quoted: fakevcard });
                        
                    } catch (err) {
                        console.error("song error:", err);
                        await socket.sendMessage(sender, { text: '❌ Failed to download song.' }, { quoted: fakevcard });
                    }
                    break;
                }
                
                case 'ts': {
    const axios = require('axios');

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const query = q.replace(/^[.\/!]ts\s*/i, '').trim();

    if (!query) {
        return await socket.sendMessage(sender, {
            text: '[❗] TikTok එකේ මොකද්ද බලන්න ඕනෙ කියපං! 🔍'
        }, { quoted: msg });
    }

    async function tiktokSearch(query) {
        try {
            const searchParams = new URLSearchParams({
                keywords: query,
                count: '10',
                cursor: '0',
                HD: '1'
            });

            const response = await axios.post("https://tikwm.com/api/feed/search", searchParams, {
                headers: {
                    'Content-Type': "application/x-www-form-urlencoded; charset=UTF-8",
                    'Cookie': "current_language=en",
                    'User-Agent': "Mozilla/5.0"
                }
            });

            const videos = response.data?.data?.videos;
            if (!videos || videos.length === 0) {
                return { status: false, result: "No videos found." };
            }

            return {
                status: true,
                result: videos.map(video => ({
                    description: video.title || "No description",
                    videoUrl: video.play || ""
                }))
            };
        } catch (err) {
            return { status: false, result: err.message };
        }
    }

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    try {
        const searchResults = await tiktokSearch(query);
        if (!searchResults.status) throw new Error(searchResults.result);

        const results = searchResults.result;
        shuffleArray(results);

        const selected = results.slice(0, 6);

        const cards = await Promise.all(selected.map(async (vid) => {
            const videoBuffer = await axios.get(vid.videoUrl, { responseType: "arraybuffer" });

            const media = await prepareWAMessageMedia({ video: videoBuffer.data }, {
                upload: socket.waUploadToServer
            });

            return {
                body: proto.Message.InteractiveMessage.Body.fromObject({ text: '' }),
                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: "laki md mini 𝐁𝙾𝚃" }),
                header: proto.Message.InteractiveMessage.Header.fromObject({
                    title: vid.description,
                    hasMediaAttachment: true,
                    videoMessage: media.videoMessage // 🎥 Real video preview
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                    buttons: [] // ❌ No buttons
                })
            };
        }));

        const msgContent = generateWAMessageFromContent(sender, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    },
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: { text: `🔎 *TikTok Search:* ${query}` },
                        footer: { text: "> 𝐏𝙾𝚆𝙴𝚁𝙳 𝐁𝚈 lakshan-𝐌𝙳" },
                        header: { hasMediaAttachment: false },
                        carouselMessage: { cards }
                    })
                }
            }
        }, { quoted: msg });

        await socket.relayMessage(sender, msgContent.message, { messageId: msgContent.key.id });

    } catch (err) {
        await socket.sendMessage(sender, {
            text: `❌ Error: ${err.message}`
        }, { quoted: msg });
    }

    break;
            }
                
                case 'mediafire':
                {
                    const url = args[0];
                    if (!url) {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}mediafire [mediafire url]` }, { quoted: msg });
                        break;
                    }
                    
                    try {
                        await socket.sendMessage(sender, { react: { text: "📥", key: msg.key } });
                        await socket.sendMessage(sender, { text: '*📁 Fetching MediaFire file...*' }, { quoted: fakevcard });
                        
                        const api = `https://tharuzz-ofc-apis.vercel.app/api/download/mediafire?url=${encodeURIComponent(url)}`;
                        const { data } = await axios.get(api);
                        
                        if (!data.success || !data.result) {
                            await socket.sendMessage(sender, { text: '❌ Failed to fetch file.' }, { quoted: fakevcard });
                            break;
                        }
                        
                        await socket.sendMessage(sender, { 
                            document: { url: data.result.url }, 
                            fileName: data.result.filename, 
                            caption: `📁 *${data.result.filename}*\n📏 Size: ${data.result.size}\n📊 Type: ${data.result.ext}` 
                        }, { quoted: fakevcard });
                        
                    } catch (err) {
                        console.error("mediafire error:", err);
                        await socket.sendMessage(sender, { text: '❌ Failed to download file.' }, { quoted: fakevcard });
                    }
                    break;
                }
                
                case 'ytmp4':
                case 'video':
                {
                    const query = args.join(' ');
                    if (!query) {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}video [song name or url]` }, { quoted: msg });
                        break;
                    }
                    
                    try {
                        await socket.sendMessage(sender, { react: { text: "🎬", key: msg.key } });
                        await socket.sendMessage(sender, { text: '*🔍 Searching video...*' }, { quoted: fakevcard });
                        
                        let videoUrl = query;
                        if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
                            const search = await yts(query);
                            if (!search?.videos?.length) throw "No results";
                            videoUrl = search.videos[0].url;
                        }
                        
                        const api = `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(videoUrl)}`;
                        const res = await axios.get(api, { timeout: 60000 });
                        
                        if (!res?.data?.result?.download) throw "API_FAILED";
                        
                        await socket.sendMessage(sender, { 
                            video: { url: res.data.result.download },
                            caption: `✅ *${res.data.result.title || 'Video'}*`
                        }, { quoted: fakevcard });
                        
                    } catch (err) {
                        console.error("video error:", err);
                        await socket.sendMessage(sender, { text: '❌ Failed to download video.' }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ AI COMMANDS ============
                case 'ai':
                case 'gpt':
                case 'chat':
                {
                    const prompt = args.join(' ');
                    if (!prompt) {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}ai [your message]` }, { quoted: msg });
                        break;
                    }
                    
                    try {
                        await socket.sendMessage(sender, { react: { text: "🤖", key: msg.key } });
                        await socket.sendMessage(sender, { text: '*🧠 AI thinking...*' }, { quoted: fakevcard });
                        
                        const apiUrl = `https://api.malvin.gleeze.com/ai/openai?text=${encodeURIComponent(prompt)}`;
                        const response = await axios.get(apiUrl, { timeout: 30000 });
                        
                        const aiReply = response?.data?.result || response?.data?.response || 'No response from AI';
                        
                        await socket.sendMessage(sender, { 
                            text: aiReply,
                            footer: "🤖 AI Response"
                        }, { quoted: fakevcard });
                        
                    } catch (err) {
                        console.error("AI error:", err);
                        await socket.sendMessage(sender, { text: '❌ AI service unavailable.' }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ STICKER COMMANDS ============
                case 'sticker':
                case 's':
                {
                    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    
                    if (!quotedMsg) {
                        await socket.sendMessage(sender, { text: '❌ Please reply to an image/video with caption .sticker' }, { quoted: msg });
                        break;
                    }
                    
                    try {
                        await socket.sendMessage(sender, { react: { text: "🎨", key: msg.key } });
                        await socket.sendMessage(sender, { text: '*🖼️ Creating sticker...*' }, { quoted: fakevcard });
                        
                        let media;
                        if (quotedMsg.imageMessage) {
                            media = await downloadContentFromMessage(quotedMsg.imageMessage, 'image');
                        } else if (quotedMsg.videoMessage) {
                            media = await downloadContentFromMessage(quotedMsg.videoMessage, 'video');
                        } else {
                            await socket.sendMessage(sender, { text: '❌ Unsupported media type' }, { quoted: msg });
                            break;
                        }
                        
                        let buffer = Buffer.from([]);
                        for await (const chunk of media) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }
                        
                        await socket.sendMessage(sender, { 
                            sticker: buffer 
                        }, { quoted: fakevcard });
                        
                    } catch (err) {
                        console.error("sticker error:", err);
                        await socket.sendMessage(sender, { text: '❌ Failed to create sticker.' }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ TOOLS COMMANDS ============
                case 'ping':
                {
                    const start = Date.now();
                    const latency = Date.now() - (msg.messageTimestamp * 1000 || Date.now());
                    const end = Date.now() - start;
                    
                    const text = `╭─「 📡 *PING* 」─➤
│
│ 🚀 *Response:* ${end}ms
│ ⚡ *Latency:* ${latency}ms
│ 🕒 *Time:* ${new Date().toLocaleString()}
│ 📊 *Active:* ${activeSockets.size}
│
╰───────────────────●`;

                    await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    break;
                }
                
                case 'alive':
                {
                    const userCfg = await loadUserConfigFromFile(number);
                    const botName = userCfg.botName || config.BOT_NAME;
                    const logo = userCfg.logo || config.LOGO_URL;
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);
                    
                    const text = `╭─「 *${botName} - ALIVE* 」─➤
│
│ 👤 *Owner:* ${config.OWNER_NAME}
│ ✏️ *Prefix:* ${config.PREFIX}
│ 🧬 *Version:* ${config.BOT_VERSION}
│ ⏰ *Uptime:* ${hours}h ${minutes}m ${seconds}s
│ 📊 *Platform:* ${process.platform}
│ 💻 *Memory:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB
│
╰───────────────────●

> *${botName} is Online!*`;

                    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);
                    
                    if (buttonSetting.enabled) {
                        await socket.sendMessage(sender, { 
                            image: imagePayload, 
                            caption: text, 
                            footer: `✅ ${botName} is running`, 
                            buttons: [
                                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📜 MENU" }, type: 1 },
                                { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: "⚡ PING" }, type: 1 }
                            ], 
                            headerType: 4 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(sender, { 
                            image: imagePayload, 
                            caption: text 
                        }, { quoted: fakevcard });
                    }
                    break;
                }
                
                case 'calc':
                case 'calculate':
                {
                    const expression = args.join(' ');
                    if (!expression) {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}calc [expression]` }, { quoted: msg });
                        break;
                    }
                    
                    try {
                        const result = eval(expression);
                        await socket.sendMessage(sender, { 
                            text: `📝 *Expression:* ${expression}\n✅ *Result:* ${result}` 
                        }, { quoted: fakevcard });
                    } catch (e) {
                        await socket.sendMessage(sender, { text: '❌ Invalid expression' }, { quoted: msg });
                    }
                    break;
                }
                
                case 'qr':
                {
                    const text = args.join(' ');
                    if (!text) {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}qr [text]` }, { quoted: msg });
                        break;
                    }
                    
                    try {
                        await socket.sendMessage(sender, { react: { text: "📱", key: msg.key } });
                        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`;
                        await socket.sendMessage(sender, { 
                            image: { url: qrUrl },
                            caption: `✅ QR Code for: ${text}`
                        }, { quoted: fakevcard });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '❌ Failed to generate QR code' }, { quoted: fakevcard });
                    }
                    break;
                }
                
                case 'weather':
                {
                    const city = args.join(' ');
                    if (!city) {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}weather [city]` }, { quoted: msg });
                        break;
                    }
                    
                    try {
                        await socket.sendMessage(sender, { react: { text: "🌤️", key: msg.key } });
                        const apiKey = 'YOUR_API_KEY'; // Replace with actual API key
                        const url = `http://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`;
                        const { data } = await axios.get(url);
                        
                        const weatherText = `╭─「 🌤️ *WEATHER* 」─➤
│
│ 🌆 *City:* ${data.name}, ${data.sys.country}
│ 🌡️ *Temp:* ${data.main.temp}°C
│ 🤔 *Feels like:* ${data.main.feels_like}°C
│ 💧 *Humidity:* ${data.main.humidity}%
│ 💨 *Wind:* ${data.wind.speed} m/s
│ ☁️ *Condition:* ${data.weather[0].description}
│ 📊 *Pressure:* ${data.main.pressure} hPa
│
╰───────────────────●`;

                        await socket.sendMessage(sender, { text: weatherText }, { quoted: fakevcard });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '❌ City not found or API error' }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ SESSION MANAGEMENT ============
                case 'deleteme':
                {
                    const sanitized = number.replace(/[^0-9]/g, '');
                    
                    if (!isOwner && senderNumber !== sanitized) {
                        await socket.sendMessage(sender, { text: '❌ Permission denied.' }, { quoted: msg });
                        break;
                    }
                    
                    try {
                        await removeSessionFromFile(sanitized);
                        
                        const sessionPath = path.join(sessionsDir, `session_${sanitized}`);
                        if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath);
                        
                        try { socket.ws?.close(); } catch(e) {}
                        activeSockets.delete(sanitized);
                        socketCreationTime.delete(sanitized);
                        
                        await socket.sendMessage(sender, { text: '✅ Session deleted successfully!' }, { quoted: fakevcard });
                    } catch (err) {
                        console.error('deleteme error:', err);
                        await socket.sendMessage(sender, { text: '❌ Failed to delete session.' }, { quoted: msg });
                    }
                    break;
                }
                
                case 'listsessions':
                case 'bots':
                {
                    const admins = await loadAdminsFromFile();
                    if (!isOwner && !admins.includes(senderNumber) && !admins.includes(nowsender)) {
                        await socket.sendMessage(sender, { text: '❌ Permission denied.' }, { quoted: msg });
                        break;
                    }
                    
                    const activeCount = activeSockets.size;
                    const activeNumbers = Array.from(activeSockets.keys());
                    
                    let text = `╭─「 🤖 *ACTIVE SESSIONS* 」─➤\n│\n│ 📊 *Total Active:* ${activeCount}\n│\n`;
                    
                    if (activeCount > 0) {
                        text += `│ 📱 *Active Numbers:*\n`;
                        activeNumbers.forEach((num, index) => {
                            text += `│ ${index + 1}. ${num}\n`;
                        });
                    } else {
                        text += `│ ⚠️ No active sessions\n`;
                    }
                    
                    text += `│\n╰───────────────────●\n\n> 🕒 ${getTimestamp()}`;
                    
                    await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    break;
                }
                
                case 'stats':
                {
                    const userCfg = await loadUserConfigFromFile(number);
                    const botName = userCfg.botName || config.BOT_NAME;
                    const allNumbers = await getAllNumbersFromFile();
                    const admins = await loadAdminsFromFile();
                    const newsletters = await listNewslettersFromFile();
                    const autoReplyMsgs = await getAutoReplyMessages();
                    
                    const memoryUsage = process.memoryUsage();
                    const uptime = process.uptime();
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);
                    
                    const text = `╭─「 📊 *BOT STATISTICS* 」─➤
│
│ 🤖 *Bot Name:* ${botName}
│ 👤 *Owner:* ${config.OWNER_NAME}
│ 👥 *Registered:* ${allNumbers.length}
│ 👑 *Admins:* ${admins.length}
│ 📰 *Newsletters:* ${newsletters.length}
│ ⚡ *Active:* ${activeSockets.size}
│ 🤖 *Auto Replies:* ${Object.keys(autoReplyMsgs).length}
│
├─「 💻 *SYSTEM* 」
│ ⏰ *Uptime:* ${hours}h ${minutes}m ${seconds}s
│ 💾 *Heap:* ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB
│ 📊 *Total:* ${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB
│ 🖥️ *Platform:* ${process.platform}
│
├─「 🕒 *SERVER TIME* 」
│ 📅 ${getTimestamp()}
│
╰───────────────────●`;

                    await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    break;
                }
                
                // ============ ADMIN MANAGEMENT ============
                case 'addadmin':
                {
                    if (!isOwner) {
                        await socket.sendMessage(sender, { text: '❌ Owner only command.' }, { quoted: msg });
                        break;
                    }
                    
                    const target = args[0];
                    if (!target) {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}addadmin [number]` }, { quoted: msg });
                        break;
                    }
                    
                    await addAdminToFile(target);
                    await socket.sendMessage(sender, { text: `✅ Admin added: ${target}` }, { quoted: fakevcard });
                    break;
                }
                
                case 'removeadmin':
                {
                    if (!isOwner) {
                        await socket.sendMessage(sender, { text: '❌ Owner only command.' }, { quoted: msg });
                        break;
                    }
                    
                    const target = args[0];
                    if (!target) {
                        await socket.sendMessage(sender, { text: `Usage: ${config.PREFIX}removeadmin [number]` }, { quoted: msg });
                        break;
                    }
                    
                    await removeAdminFromFile(target);
                    await socket.sendMessage(sender, { text: `✅ Admin removed: ${target}` }, { quoted: fakevcard });
                    break;
                }
                
                case 'listadmins':
                {
                    const admins = await loadAdminsFromFile();
                    let text = `╭─「 👑 *ADMIN LIST* 」─➤\n│\n`;
                    
                    if (admins.length > 0) {
                        text += `│ 👤 *Owner:* ${config.OWNER_NUMBER}\n│\n`;
                        admins.forEach((admin, index) => {
                            text += `│ ${index + 1}. ${admin}\n`;
                        });
                    } else {
                        text += `│ No admins added yet\n`;
                    }
                    
                    text += `│\n╰───────────────────●`;
                    
                    await socket.sendMessage(sender, { text }, { quoted: fakevcard });
                    break;
                }
                
                // ============ RESTART ============
                case 'restart':
                {
                    if (!isOwner) {
                        await socket.sendMessage(sender, { text: '❌ Owner only command.' }, { quoted: msg });
                        break;
                    }
                    
                    await socket.sendMessage(sender, { text: '🔄 *Restarting bot...*\n⏱️ Please wait 5 seconds' }, { quoted: fakevcard });
                    
                    setTimeout(() => {
                        process.exit(0);
                    }, 2000);
                    break;
                }
                
                case 'shutdown':
                {
                    if (!isOwner) {
                        await socket.sendMessage(sender, { text: '❌ Owner only command.' }, { quoted: msg });
                        break;
                    }
                    
                    await socket.sendMessage(sender, { text: '🔴 *Shutting down bot...*\n👋 Goodbye!' }, { quoted: fakevcard });
                    
                    setTimeout(() => {
                        process.exit(0);
                    }, 1000);
                    break;
                }
                
                // ============ GROUP MANAGEMENT ============
                case 'tagall':
                case 'mentionall':
                {
                    if (!isGroup) {
                        await socket.sendMessage(sender, { text: '❌ This command can only be used in groups!' }, { quoted: msg });
                        return;
                    }
                    
                    try {
                        const groupMetadata = await socket.groupMetadata(from);
                        const participants = groupMetadata.participants;
                        let mentions = [];
                        let text = '╭─「 👥 *MENTION ALL* 」─➤\n│\n';
                        
                        participants.forEach(p => {
                            mentions.push(p.id);
                            text += `│ 👤 @${p.id.split('@')[0]}\n`;
                        });
                        
                        text += `│\n╰───────────────────●\n\n> *Total: ${participants.length} members*`;
                        
                        await socket.sendMessage(from, { 
                            text, 
                            mentions 
                        }, { quoted: msg });
                        
                    } catch (e) {
                        await socket.sendMessage(sender, { text: '❌ Failed to tag members' }, { quoted: msg });
                    }
                    break;
                }
                
                case 'hidetag':
                {
                    if (!isGroup) {
                        await socket.sendMessage(sender, { text: '❌ This command can only be used in groups!' }, { quoted: msg });
                        return;
                    }
                    
                    const text = args.join(' ') || ' ';
                    
                    try {
                        const groupMetadata = await socket.groupMetadata(from);
                        const participants = groupMetadata.participants;
                        let mentions = participants.map(p => p.id);
                        
                        await socket.sendMessage(from, { 
                            text, 
                            mentions 
                        }, { quoted: msg });
                        
                    } catch (e) {
                        await socket.sendMessage(sender, { text: '❌ Failed to send hidden tag' }, { quoted: msg });
                    }
                    break;
                }
                
                case 'admins':
                {
                    if (!isGroup) {
                        await socket.sendMessage(sender, { text: '❌ This command can only be used in groups!' }, { quoted: msg });
                        return;
                    }
                    
                    try {
                        const groupMetadata = await socket.groupMetadata(from);
                        const admins = groupMetadata.participants.filter(p => p.admin);
                        let text = `╭─「 👑 *GROUP ADMINS* 」─➤\n│\n│ 📛 *${groupMetadata.subject}*\n│ 👥 *Total Admins:* ${admins.length}\n│\n`;
                        
                        admins.forEach((admin, index) => {
                            const role = admin.admin === 'superadmin' ? '👑 Owner' : '👮 Admin';
                            text += `│ ${index + 1}. @${admin.id.split('@')[0]} (${role})\n`;
                        });
                        
                        text += `│\n╰───────────────────●`;
                        
                        await socket.sendMessage(from, { 
                            text, 
                            mentions: admins.map(a => a.id)
                        }, { quoted: msg });
                        
                    } catch (e) {
                        await socket.sendMessage(sender, { text: '❌ Failed to get admins' }, { quoted: msg });
                    }
                    break;
                }
                
                case 'grouplink':
                {
                    if (!isGroup) {
                        await socket.sendMessage(sender, { text: '❌ This command can only be used in groups!' }, { quoted: msg });
                        return;
                    }
                    
                    try {
                        const code = await socket.groupInviteCode(from);
                        const link = `https://chat.whatsapp.com/${code}`;
                        await socket.sendMessage(sender, { 
                            text: `🔗 *Group Link:*\n${link}` 
                        }, { quoted: fakevcard });
                    } catch (e) {
                        await socket.sendMessage(sender, { text: '❌ Failed to get group link' }, { quoted: msg });
                    }
                    break;
                }
                
                case 'revoke':
                {
                    if (!isGroup) {
                        await socket.sendMessage(sender, { text: '❌ This command can only be used in groups!' }, { quoted: msg });
                        return;
                    }
                    
                    try {
                        await socket.groupRevokeInvite(from);
                        const code = await socket.groupInviteCode(from);
                        const link = `https://chat.whatsapp.com/${code}`;
                        await socket.sendMessage(sender, { 
                            text: `✅ *Group link revoked!*\n🔗 *New Link:*\n${link}` 
                        }, { quoted: fakevcard });
                    } catch (e) {
                        await socket.sendMessage(sender, { text: '❌ Failed to revoke link' }, { quoted: msg });
                    }
                    break;
                }
                
                case 'kick':
                case 'remove':
                {
                    if (!isGroup) {
                        await socket.sendMessage(sender, { text: '❌ This command can only be used in groups!' }, { quoted: msg });
                        return;
                    }
                    
                    if (!msg.message.extendedTextMessage?.contextInfo?.participant) {
                        await socket.sendMessage(sender, { text: '❌ Please reply to or tag a user to kick' }, { quoted: msg });
                        return;
                    }
                    
                    try {
                        const userToKick = msg.message.extendedTextMessage.contextInfo.participant;
                        await socket.groupParticipantsUpdate(from, [userToKick], 'remove');
                        await socket.sendMessage(sender, { 
                            text: `✅ @${userToKick.split('@')[0]} removed from group`,
                            mentions: [userToKick]
                        }, { quoted: fakevcard });
                    } catch (e) {
                        await socket.sendMessage(sender, { text: '❌ Failed to remove user' }, { quoted: msg });
                    }
                    break;
                }
                
                case 'promote':
                {
                    if (!isGroup) {
                        await socket.sendMessage(sender, { text: '❌ This command can only be used in groups!' }, { quoted: msg });
                        return;
                    }
                    
                    if (!msg.message.extendedTextMessage?.contextInfo?.participant) {
                        await socket.sendMessage(sender, { text: '❌ Please reply to or tag a user to promote' }, { quoted: msg });
                        return;
                    }
                    
                    try {
                        const userToPromote = msg.message.extendedTextMessage.contextInfo.participant;
                        await socket.groupParticipantsUpdate(from, [userToPromote], 'promote');
                        await socket.sendMessage(sender, { 
                            text: `✅ @${userToPromote.split('@')[0]} promoted to admin`,
                            mentions: [userToPromote]
                        }, { quoted: fakevcard });
                    } catch (e) {
                        await socket.sendMessage(sender, { text: '❌ Failed to promote user' }, { quoted: msg });
                    }
                    break;
                }
                
                case 'demote':
                {
                    if (!isGroup) {
                        await socket.sendMessage(sender, { text: '❌ This command can only be used in groups!' }, { quoted: msg });
                        return;
                    }
                    
                    if (!msg.message.extendedTextMessage?.contextInfo?.participant) {
                        await socket.sendMessage(sender, { text: '❌ Please reply to or tag a user to demote' }, { quoted: msg });
                        return;
                    }
                    
                    try {
                        const userToDemote = msg.message.extendedTextMessage.contextInfo.participant;
                        await socket.groupParticipantsUpdate(from, [userToDemote], 'demote');
                        await socket.sendMessage(sender, { 
                            text: `✅ @${userToDemote.split('@')[0]} demoted from admin`,
                            mentions: [userToDemote]
                        }, { quoted: fakevcard });
                    } catch (e) {
                        await socket.sendMessage(sender, { text: '❌ Failed to demote user' }, { quoted: msg });
                    }
                    break;
                }
                
                // ============ DEFAULT ============
                default:
                    // Unknown command
                    break;
            }
        } catch (err) {
            console.error('Command handler error:', err);
            try {
                await socket.sendMessage(sender, { text: '❌ An error occurred while processing your command.' }, { quoted: fakevcard });
            } catch(e) {}
        }
    });
}

// ---------------- MESSAGE HANDLERS ----------------
function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        
        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
            } catch (e) {}
        }
        
        // Auto download view once if enabled
        if (config.AUTO_DOWNLOAD_VV === 'true') {
            await handleViewOnce(socket, msg, msg.key.remoteJid);
        }
    });
}

// ---------------- SESSION SETUP ----------------
async function setupBotSession(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(sessionsDir, `session_${sanitizedNumber}`);
    
    // Check if already active
    if (activeSockets.has(sanitizedNumber)) {
        if (!res.headersSent) res.send({ status: 'already_connected' });
        return;
    }
    
    // Load saved creds if any
    const savedCreds = await loadCredsFromFile(sanitizedNumber);
    if (savedCreds?.creds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(savedCreds.creds, null, 2));
        if (savedCreds.keys) {
            fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(savedCreds.keys, null, 2));
        }
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, { level: 'silent' })
            },
            printQRInTerminal: false,
            logger: { level: 'silent' },
            browser: Browsers.macOS('Safari')
        });
        
        socketCreationTime.set(sanitizedNumber, Date.now());
        
        // Setup handlers
        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        
        // Request pairing code if not registered
        if (!socket.authState.creds.registered) {
            try {
                const code = await socket.requestPairingCode(sanitizedNumber);
                if (!res.headersSent) res.send({ code });
            } catch (error) {
                if (!res.headersSent) res.status(500).send({ error: 'Failed to get pairing code' });
            }
        } else {
            if (!res.headersSent) res.send({ status: 'already_registered' });
        }
        
        // Save creds when updated
        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = fs.readFileSync(path.join(sessionPath, 'creds.json'), 'utf8');
            const credsObj = JSON.parse(fileContent);
            await saveCredsToFile(sanitizedNumber, credsObj, state.keys || null);
        });
        
        // Connection updates
        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            
            if (connection === 'open') {
                try {
                    await delay(2000);
                    
                    // Add to active sockets
                    activeSockets.set(sanitizedNumber, socket);
                    
                    // Add to numbers list
                    await addNumberToFile(sanitizedNumber);
                    
                    // Join group if enabled
                    const groupResult = await joinGroup(socket);
                    
                    // Load user config
                    const userCfg = await loadUserConfigFromFile(sanitizedNumber);
                    const botName = userCfg.botName || config.BOT_NAME;
                    const logo = userCfg.logo || config.LOGO_URL;
                    
                    // Send welcome message
                    const userJid = jidNormalizedUser(socket.user.id);
                    const welcomeText = `╭─「 ✅ *CONNECTED* 」─➤
│
│ 🤖 *Bot:* ${botName}
│ 📞 *Number:* ${sanitizedNumber}
│ 📊 *Status:* Connected & Active
│ 🕒 *Time:* ${getTimestamp()}
│
${groupResult.status === 'success' ? '│ ✅ Joined group successfully!\n' : ''}
${groupResult.status === 'failed' ? '│ ⚠️ Could not join group\n' : ''}
│
│ ✨ Type ${config.PREFIX}menu to start!
│
╰───────────────────●

> *${botName}*`;
                    
                    try {
                        if (String(logo).startsWith('http')) {
                            await socket.sendMessage(userJid, { 
                                image: { url: logo }, 
                                caption: welcomeText 
                            });
                        } else {
                            await socket.sendMessage(userJid, { text: welcomeText });
                        }
                    } catch (e) {
                        await socket.sendMessage(userJid, { text: welcomeText });
                    }
                    
                    console.log(`✅ Bot connected: ${sanitizedNumber}`);
                } catch (e) {
                    console.error('Connection open error:', e);
                }
            }
            
            if (connection === 'close') {
                // Cleanup on disconnect
                try {
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                } catch(e) {}
                
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
                console.log(`❌ Bot disconnected: ${sanitizedNumber}`);
            }
        });
        
        // Auto-restart on logout
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === 401) {
                    // Logged out, cleanup
                    await removeSessionFromFile(sanitizedNumber);
                    activeSockets.delete(sanitizedNumber);
                    socketCreationTime.delete(sanitizedNumber);
                }
            }
        });
        
    } catch (error) {
        console.error('Session setup error:', error);
        if (!res.headersSent) res.status(500).send({ error: 'Failed to setup session' });
    }
}

// ---------------- API ROUTES ----------------
router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) return res.status(400).send({ error: 'Number parameter required' });
    await setupBotSession(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({ 
        botName: config.BOT_NAME, 
        count: activeSockets.size, 
        numbers: Array.from(activeSockets.keys()), 
        timestamp: getTimestamp() 
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({ 
        status: 'active', 
        botName: config.BOT_NAME, 
        message: 'Bot is running', 
        activeSessions: activeSockets.size 
    });
});

// Admin API routes
router.post('/admin/add', async (req, res) => {
    const { jid } = req.body;
    if (!jid) return res.status(400).send({ error: 'jid required' });
    await addAdminToFile(jid);
    res.status(200).send({ status: 'ok', jid });
});

router.post('/admin/remove', async (req, res) => {
    const { jid } = req.body;
    if (!jid) return res.status(400).send({ error: 'jid required' });
    await removeAdminFromFile(jid);
    res.status(200).send({ status: 'ok', jid });
});

router.get('/admin/list', async (req, res) => {
    const list = await loadAdminsFromFile();
    res.status(200).send({ status: 'ok', admins: list });
});

// Newsletter API routes
router.post('/newsletter/add', async (req, res) => {
    const { jid, emojis } = req.body;
    if (!jid) return res.status(400).send({ error: 'jid required' });
    await addNewsletterToFile(jid, emojis || []);
    res.status(200).send({ status: 'ok', jid });
});

router.post('/newsletter/remove', async (req, res) => {
    const { jid } = req.body;
    if (!jid) return res.status(400).send({ error: 'jid required' });
    await removeNewsletterFromFile(jid);
    res.status(200).send({ status: 'ok', jid });
});

router.get('/newsletter/list', async (req, res) => {
    const list = await listNewslettersFromFile();
    res.status(200).send({ status: 'ok', channels: list });
});

// Session management API
router.get('/api/sessions', async (req, res) => {
    const data = readJSON(sessionFiles.sessions);
    const sessions = Object.entries(data).map(([number, info]) => ({ 
        number, 
        updatedAt: info.updatedAt 
    }));
    res.json({ ok: true, sessions });
});

router.get('/api/active', (req, res) => {
    const keys = Array.from(activeSockets.keys());
    res.json({ ok: true, active: keys, count: keys.length });
});

router.post('/api/session/delete', async (req, res) => {
    const { number } = req.body;
    if (!number) return res.status(400).json({ ok: false, error: 'number required' });
    
    const sanitized = number.replace(/[^0-9]/g, '');
    const running = activeSockets.get(sanitized);
    
    if (running) {
        try { running.ws?.close(); } catch(e) {}
        activeSockets.delete(sanitized);
        socketCreationTime.delete(sanitized);
    }
    
    await removeSessionFromFile(sanitized);
    
    const sessionPath = path.join(sessionsDir, `session_${sanitized}`);
    if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath);
    
    res.json({ ok: true, message: `Session ${sanitized} removed` });
});

// Auto-reconnect on startup
(async () => {
    try {
        const numbers = await getAllNumbersFromFile();
        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await setupBotSession(number, mockRes);
                await delay(1000);
            }
        }
    } catch(e) {
        console.error('Auto-reconnect error:', e);
    }
})();

module.exports = router;
