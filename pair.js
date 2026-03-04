const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const moment = require('moment-timezone');
const axios = require('axios');
const yts = require("yt-search");
const config = require('./config');
const { makeid } = require('./Id');
const { sms } = require('./msg');

const { default: makeWASocket, useMultiFileAuthState, delay, getContentType, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, downloadContentFromMessage, DisconnectReason } = require('baileys');

// ---------------- STORAGE PATHS ----------------
const sessionsDir = path.join(__dirname, 'sessions');
const dataDir = path.join(__dirname, 'bot_data');
const tempDir = path.join(__dirname, 'temp');
const mediaDir = path.join(__dirname, 'media');

fs.ensureDirSync(sessionsDir);
fs.ensureDirSync(dataDir);
fs.ensureDirSync(tempDir);
fs.ensureDirSync(mediaDir);

const sessionFiles = {
    sessions: path.join(dataDir, 'sessions.json'),
    numbers: path.join(dataDir, 'numbers.json'),
    admins: path.join(dataDir, 'admins.json'),
    newsletters: path.join(dataDir, 'newsletters.json'),
    userConfigs: path.join(dataDir, 'user_configs.json'),
    settings: path.join(dataDir, 'settings.json'),
    autoReply: path.join(dataDir, 'auto_reply.json'),
    groupSettings: path.join(dataDir, 'group_settings.json'),
    buttonSettings: path.join(dataDir, 'button_settings.json'),
    statusSettings: path.join(dataDir, 'status_settings.json'),
    presenceSettings: path.join(dataDir, 'presence_settings.json'),
    userPresets: path.join(dataDir, 'user_presets.json')
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

// ---------------- AI FUNCTIONS (SoftOrbits) ----------------
function generateRandomId(length = 16) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function askSoftOrbitsAI(q) {
    const url = 'https://cf-worker.pr-2da.workers.dev/api/chat';
    const id = "DEFAULT_THREAD_ID";
    const mId = generateRandomId();
    
    const payload = {
        id: id,
        messages: [
            {
                role: "user",
                parts: [{ type: "text", text: q }],
                id: mId
            }
        ],
        metadata: {},
        tools: {},
        trigger: "submit-message"
    };

    const headers = {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Origin': 'https://www.softorbits.net',
        'Referer': 'https://www.softorbits.net/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Sec-GPC': '1',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site'
    };

    try {
        const response = await axios.post(url, payload, { 
            headers, 
            responseType: 'stream' 
        });
        
        let fullReply = "";
        
        response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            for (let line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const jsonStr = line.replace('data: ', '');
                        const parsed = JSON.parse(jsonStr);
                        if (parsed.type === 'text-delta') {
                            fullReply += parsed.delta;
                        }
                    } catch (e) {}
                }
            }
        });

        return new Promise((resolve) => {
            response.data.on('end', () => {
                resolve({
                    status: true,
                    reply: fullReply.trim()
                });
            });
        });

    } catch (err) {
        return {
            status: false,
            error: err.response ? `HTTP ${err.response.status}` : err.message
        };
    }
}

// ---------------- SESSION MANAGEMENT ----------------
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

// ---------------- ADMIN MANAGEMENT ----------------
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

// ---------------- USER CONFIG MANAGEMENT ----------------
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

// ---------------- AUTO REPLY MANAGEMENT ----------------
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

async function updateAutoReplyMessage(keyword, newResponse) {
    const data = readJSON(sessionFiles.autoReply);
    if (data[keyword]) {
        data[keyword].response = newResponse;
        data[keyword].updatedAt = new Date().toISOString();
        writeJSON(sessionFiles.autoReply, data);
        return true;
    }
    return false;
}

// ---------------- BUTTON SETTINGS ----------------
async function getButtonSetting(chatId) {
    const data = readJSON(sessionFiles.buttonSettings);
    return data[chatId] || { enabled: true };
}

async function setButtonSetting(chatId, setting) {
    const data = readJSON(sessionFiles.buttonSettings);
    data[chatId] = { ...data[chatId], ...setting };
    writeJSON(sessionFiles.buttonSettings, data);
}

// ---------------- SETTINGS MANAGEMENT (NEW) ----------------
async function getGlobalSetting(key, defaultValue) {
    const data = readJSON(sessionFiles.settings);
    return data[key] !== undefined ? data[key] : defaultValue;
}

async function setGlobalSetting(key, value) {
    const data = readJSON(sessionFiles.settings);
    data[key] = value;
    writeJSON(sessionFiles.settings, data);
}

async function getChatSetting(chatId, key, defaultValue) {
    const data = readJSON(sessionFiles.groupSettings);
    if (!data[chatId]) data[chatId] = {};
    return data[chatId][key] !== undefined ? data[chatId][key] : defaultValue;
}

async function setChatSetting(chatId, key, value) {
    const data = readJSON(sessionFiles.groupSettings);
    if (!data[chatId]) data[chatId] = {};
    data[chatId][key] = value;
    writeJSON(sessionFiles.groupSettings, data);
}

// ---------------- PRESENCE SETTINGS (NEW) ----------------
async function getPresenceSetting(chatId, key, defaultValue) {
    const data = readJSON(sessionFiles.presenceSettings);
    if (!data[chatId]) data[chatId] = {};
    return data[chatId][key] !== undefined ? data[chatId][key] : defaultValue;
}

async function setPresenceSetting(chatId, key, value) {
    const data = readJSON(sessionFiles.presenceSettings);
    if (!data[chatId]) data[chatId] = {};
    data[chatId][key] = value;
    writeJSON(sessionFiles.presenceSettings, data);
}

// ---------------- STATUS SETTINGS (NEW) ----------------
async function getStatusSetting(chatId, key, defaultValue) {
    const data = readJSON(sessionFiles.statusSettings);
    if (!data[chatId]) data[chatId] = {};
    return data[chatId][key] !== undefined ? data[chatId][key] : defaultValue;
}

async function setStatusSetting(chatId, key, value) {
    const data = readJSON(sessionFiles.statusSettings);
    if (!data[chatId]) data[chatId] = {};
    data[chatId][key] = value;
    writeJSON(sessionFiles.statusSettings, data);
}

// ---------------- USER PRESETS (NEW) ----------------
async function getUserPreset(number) {
    const data = readJSON(sessionFiles.userPresets);
    const sanitized = number.replace(/[^0-9]/g, '');
    return data[sanitized] || {
        botName: config.BOT_NAME,
        logo: config.LOGO_URL,
        footer: config.BOT_FOOTER,
        autoReply: {},
        settings: {}
    };
}

async function saveUserPreset(number, preset) {
    const data = readJSON(sessionFiles.userPresets);
    const sanitized = number.replace(/[^0-9]/g, '');
    data[sanitized] = { ...data[sanitized], ...preset, updatedAt: new Date().toISOString() };
    writeJSON(sessionFiles.userPresets, data);
}

// ---------------- MODE CHECK (NEW) ----------------
async function isPublicMode() {
    return await getGlobalSetting('PUBLIC_MODE', config.PUBLIC_MODE || 'true') === 'true';
}

async function hasPermission(senderNumber, isOwner) {
    if (isOwner) return true;
    
    const admins = await loadAdminsFromFile();
    if (admins.includes(senderNumber)) return true;
    
    const publicMode = await isPublicMode();
    return publicMode;
}

// ---------------- PRESENCE FUNCTIONS (NEW) ----------------
async function setPresence(socket, chatId, type) {
    try {
        await socket.sendPresenceUpdate(type, chatId);
    } catch (e) {}
}

// ---------------- HTML COLOR TO CODE (NEW) ----------------
function htmlColorToCode(color) {
    const colors = {
        'red': '#FF0000',
        'blue': '#0000FF',
        'green': '#00FF00',
        'yellow': '#FFFF00',
        'black': '#000000',
        'white': '#FFFFFF',
        'purple': '#800080',
        'orange': '#FFA500',
        'pink': '#FFC0CB',
        'brown': '#A52A2A',
        'cyan': '#00FFFF',
        'magenta': '#FF00FF',
        'lime': '#00FF00',
        'maroon': '#800000',
        'navy': '#000080',
        'olive': '#808000',
        'teal': '#008080',
        'gold': '#FFD700',
        'silver': '#C0C0C0',
        'gray': '#808080',
        'indigo': '#4B0082',
        'violet': '#EE82EE',
        'coral': '#FF7F50',
        'tomato': '#FF6347',
        'salmon': '#FA8072',
        'khaki': '#F0E68C',
        'plum': '#DDA0DD',
        'orchid': '#DA70D6'
    };
    return colors[color.toLowerCase()] || color;
}

// ---------------- UTILITIES ----------------
function getTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

function generateFileName(ext) {
    return `${Date.now()}-${makeid(6)}.${ext}`;
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

// Fake contact for styling
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
        return { status: 'skipped' };
    }
    
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) return { status: 'failed', error: 'Invalid group invite link' };
    
    const inviteCode = inviteCodeMatch[1];
    
    try {
        const response = await socket.groupAcceptInvite(inviteCode);
        if (response?.gid) return { status: 'success', gid: response.gid };
        return { status: 'failed' };
    } catch (error) {
        return { status: 'failed', error: error.message };
    }
}

// ---------------- STATUS HANDLERS ----------------
async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
        
        try {
            const statusSettings = await getStatusSetting('global', 'status', {});
            
            if (statusSettings.autoRecording === true || config.AUTO_RECORDING === 'true') {
                await setPresence(socket, message.key.remoteJid, 'recording');
            }
            
            if (statusSettings.autoView === true || config.AUTO_VIEW_STATUS === 'true') {
                await socket.readMessages([message.key]);
            }
            
            if (statusSettings.autoLike === true || config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                await socket.sendMessage(message.key.remoteJid, { 
                    react: { text: randomEmoji, key: message.key } 
                }, { statusJidList: [message.key.participant] });
            }
            
            // Save status if enabled
            if (statusSettings.saveStatus === true) {
                // Save status logic here
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
        const isViewOnce = msg.message?.viewOnceMessage || 
                          msg.message?.viewOnceMessageV2 || 
                          msg.message?.viewOnceMessageV2Extension;
        
        if (!isViewOnce) return false;
        
        const viewOnceContent = msg.message.viewOnceMessage?.message || 
                               msg.message.viewOnceMessageV2?.message || 
                               msg.message.viewOnceMessageV2Extension?.message;
        
        if (!viewOnceContent) return false;
        
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderNumber = sender.split('@')[0];
        
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
        }
        
        if (!mediaBuffer) return false;
        
        const filePath = path.join(tempDir, fileName);
        fs.writeFileSync(filePath, mediaBuffer);
        
        const vvSettings = await getGlobalSetting('vv_settings', {
            autoDownload: config.AUTO_DOWNLOAD_VV === 'true',
            sendToInbox: config.SEND_VV_TO_INBOX === 'true'
        });
        
        if (vvSettings.sendToInbox) {
            const userJid = jidNormalizedUser(socket.user.id);
            const captionText = `📸 *View Once Message*\n\n👤 From: @${senderNumber}\n📱 Type: ${mediaType}\n🕒 Time: ${getTimestamp()}\n\n${caption}`;
            
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
            }
        }
        
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
        
        // Use msg.js helper
        const m = sms(socket, msg);
        
        const from = m.chat;
        const sender = m.sender;
        const senderNumber = m.sender.split('@')[0];
        const isOwner = senderNumber === config.OWNER_NUMBER.replace(/[^0-9]/g, '');
        const isGroup = m.isGroup;
        const isQuoted = !!m.quoted;
        const body = m.body || '';
        
        // Check permission
        const hasPerm = await hasPermission(senderNumber, isOwner);
        if (!hasPerm && !isOwner) {
            // Private mode - only owner/admin can use commands
            return;
        }
        
        // Auto download VV if enabled
        const vvSettings = await getGlobalSetting('vv_settings', {
            autoDownload: config.AUTO_DOWNLOAD_VV === 'true'
        });
        if (vvSettings.autoDownload) {
            await handleViewOnce(socket, msg, from);
        }
        
        if (!body || typeof body !== 'string') return;
        
        // Auto reply if enabled
        const autoReplyEnabled = await getGlobalSetting('auto_reply_enabled', config.AUTO_REPLY_ENABLED === 'true');
        if (autoReplyEnabled) {
            await handleAutoReply(socket, msg, from, senderNumber, body, isQuoted);
        }
        
        const prefix = config.PREFIX;
        const isCmd = body.startsWith(prefix);
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : null;
        const args = body.trim().split(/ +/).slice(1);
        
        if (!command) return;
        
        try {
            const buttonSetting = await getButtonSetting(from);
            const userPreset = await getUserPreset(number);
            const botName = userPreset.botName || config.BOT_NAME;
            const logo = userPreset.logo || config.LOGO_URL;
            const footer = userPreset.footer || config.BOT_FOOTER;
            
            // Presence settings
            const presenceSettings = await getChatSetting(from, 'presence', {
                typing: false,
                recording: false,
                online: false
            });
            
            // Set presence based on settings
            if (presenceSettings.typing) {
                await setPresence(socket, from, 'composing');
            } else if (presenceSettings.recording) {
                await setPresence(socket, from, 'recording');
            } else if (presenceSettings.online) {
                await setPresence(socket, from, 'available');
            }
            
            switch (command) {
                // ============ PAIR COMMAND (NEW) ============
                case 'pair':
                {
                    if (!isOwner) {
                        await m.reply('❌ Owner only command.');
                        break;
                    }
                    
                    const targetNumber = args[0];
                    if (!targetNumber) {
                        await m.reply(`Usage: ${prefix}pair [number]\nExample: ${prefix}pair 94789227570`);
                        break;
                    }
                    
                    m.react("🔗");
                    await m.reply('*🔄 Generating pair code...*');
                    
                    try {
                        const sanitized = targetNumber.replace(/[^0-9]/g, '');
                        const sessionPath = path.join(sessionsDir, `session_${sanitized}`);
                        
                        const { state } = await useMultiFileAuthState(sessionPath);
                        const pairSocket = makeWASocket({
                            auth: state,
                            printQRInTerminal: false,
                            logger: { level: 'silent' }
                        });
                        
                        const code = await pairSocket.requestPairingCode(sanitized);
                        
                        await socket.sendMessage(from, {
                            image: { url: logo },
                            caption: `🔐 *Pairing Code*\n\n📱 Number: ${sanitized}\n🔑 Code: *${code}*\n\n🕒 Time: ${getTimestamp()}\n\n> Open WhatsApp > Linked Devices > Link with phone number`,
                            footer: footer
                        }, { quoted: m });
                        
                        pairSocket.ws.close();
                        
                    } catch (err) {
                        await m.reply('❌ Failed to generate pair code.');
                    }
                    break;
                }
                
                // ============ MAIN MENU ============
                case 'menu':
                case 'help':
                case 'start':
                {
                    m.react("🎐");
                    
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = uptime % 60;
                    
                    const publicMode = await isPublicMode();
                    const modeText = publicMode ? 'PUBLIC ✅' : 'PRIVATE 👑';
                    
                    const text = `╭─「 🤖 ${botName} 」─➤
│
│ 👤 Owner: ${config.OWNER_NAME}
│ ✏️ Prefix: ${config.PREFIX}
│ 🧬 Version: ${config.BOT_VERSION}
│ ⏰ Uptime: ${hours}h ${minutes}m ${seconds}s
│ 🔐 Mode: ${modeText}
│
├─「 MAIN MENU 」─➤
│
│ 1️⃣ 👑 OWNER (${prefix}owner)
│ 2️⃣ 📥 DOWNLOAD (${prefix}download)
│ 3️⃣ 🛠️ TOOLS (${prefix}tools)
│ 4️⃣ ⚙️ SETTINGS (${prefix}settings)
│ 5️⃣ 🎨 CREATIVE (${prefix}creative)
│ 6️⃣ 👥 GROUP (${prefix}group)
│ 7️⃣ 🤖 AUTO REPLY (${prefix}autoreply)
│ 8️⃣ 🔘 BUTTONS (${prefix}button)
│ 9️⃣ 📸 VV/DP (${prefix}vvmenu)
│ 🔟 ⚡ PRESENCE (${prefix}presence)
│
╰──────●●➤

${footer}`;

                    if (buttonSetting.enabled) {
                        const buttons = [
                            { buttonId: `${prefix}owner`, buttonText: { displayText: "👑 OWNER" }, type: 1 },
                            { buttonId: `${prefix}settings`, buttonText: { displayText: "⚙️ SETTINGS" }, type: 1 },
                            { buttonId: `${prefix}presence`, buttonText: { displayText: "⚡ PRESENCE" }, type: 1 }
                        ];
                        
                        await socket.sendMessage(from, { 
                            image: { url: logo }, 
                            caption: text, 
                            footer: footer, 
                            buttons, 
                            headerType: 4 
                        }, { quoted: fakevcard });
                    } else {
                        await socket.sendMessage(from, { image: { url: logo }, caption: text }, { quoted: fakevcard });
                    }
                    break;
                }
                
                // ============ PRESENCE MENU (NEW) ============
                case 'presence':
                {
                    m.react("⚡");
                    
                    const presence = await getChatSetting(from, 'presence', {
                        typing: false,
                        recording: false,
                        online: false
                    });
                    
                    const text = `╭─「 ⚡ PRESENCE SETTINGS 」─➤
│
│ 📍 Chat: ${isGroup ? 'Group' : 'Private'}
│
├─「 CURRENT STATUS 」
│ ✦ Typing: ${presence.typing ? 'ON ✅' : 'OFF ❌'}
│ ✦ Recording: ${presence.recording ? 'ON ✅' : 'OFF ❌'}
│ ✦ Online: ${presence.online ? 'ON ✅' : 'OFF ❌'}
│
├─「 COMMANDS 」
│ ✦ ${prefix}typing [on/off]
│ ✦ ${prefix}recording [on/off]
│ ✦ ${prefix}online [on/off]
│ ✦ ${prefix}presenceoff (turn all off)
│
├─「 DESCRIPTION 」
│ • Typing: Shows "typing..." status
│ • Recording: Shows "recording..." status
│ • Online: Shows "online" status
│
╰──────●●➤

${footer}`;

                    await m.reply(text);
                    break;
                }
                
                case 'typing':
                {
                    const state = args[0]?.toLowerCase();
                    if (!state || (state !== 'on' && state !== 'off')) {
                        await m.reply(`Usage: ${prefix}typing [on/off]`);
                        break;
                    }
                    
                    const presence = await getChatSetting(from, 'presence', {});
                    presence.typing = state === 'on';
                    if (presence.typing) {
                        presence.recording = false;
                        presence.online = false;
                    }
                    await setChatSetting(from, 'presence', presence);
                    
                    await m.reply(`✅ Typing ${state === 'on' ? 'enabled' : 'disabled'} for this chat.`);
                    break;
                }
                
                case 'recording':
                {
                    const state = args[0]?.toLowerCase();
                    if (!state || (state !== 'on' && state !== 'off')) {
                        await m.reply(`Usage: ${prefix}recording [on/off]`);
                        break;
                    }
                    
                    const presence = await getChatSetting(from, 'presence', {});
                    presence.recording = state === 'on';
                    if (presence.recording) {
                        presence.typing = false;
                        presence.online = false;
                    }
                    await setChatSetting(from, 'presence', presence);
                    
                    await m.reply(`✅ Recording ${state === 'on' ? 'enabled' : 'disabled'} for this chat.`);
                    break;
                }
                
                case 'online':
                {
                    const state = args[0]?.toLowerCase();
                    if (!state || (state !== 'on' && state !== 'off')) {
                        await m.reply(`Usage: ${prefix}online [on/off]`);
                        break;
                    }
                    
                    const presence = await getChatSetting(from, 'presence', {});
                    presence.online = state === 'on';
                    if (presence.online) {
                        presence.typing = false;
                        presence.recording = false;
                    }
                    await setChatSetting(from, 'presence', presence);
                    
                    await m.reply(`✅ Online ${state === 'on' ? 'enabled' : 'disabled'} for this chat.`);
                    break;
                }
                
                case 'presenceoff':
                {
                    await setChatSetting(from, 'presence', {
                        typing: false,
                        recording: false,
                        online: false
                    });
                    
                    await m.reply('✅ All presence settings disabled for this chat.');
                    break;
                }
                
                // ============ MODE COMMANDS (NEW) ============
                case 'mode':
                {
                    if (!isOwner) {
                        await m.reply('❌ Owner only command.');
                        break;
                    }
                    
                    const currentMode = await isPublicMode();
                    
                    const text = `╭─「 🔐 BOT MODE 」─➤
│
│ Current Mode: ${currentMode ? 'PUBLIC ✅' : 'PRIVATE 👑'}
│
├─「 COMMANDS 」
│ ✦ ${prefix}public - Switch to public mode
│ ✦ ${prefix}private - Switch to private mode
│
├─「 DESCRIPTION 」
│ • Public: Everyone can use commands
│ • Private: Only owner/admins can use commands
│
╰──────●●➤`;

                    await m.reply(text);
                    break;
                }
                
                case 'public':
                {
                    if (!isOwner) {
                        await m.reply('❌ Owner only command.');
                        break;
                    }
                    
                    await setGlobalSetting('PUBLIC_MODE', 'true');
                    await m.reply('✅ Bot switched to *PUBLIC* mode. Everyone can use commands.');
                    break;
                }
                
                case 'private':
                {
                    if (!isOwner) {
                        await m.reply('❌ Owner only command.');
                        break;
                    }
                    
                    await setGlobalSetting('PUBLIC_MODE', 'false');
                    await m.reply('✅ Bot switched to *PRIVATE* mode. Only owner/admins can use commands.');
                    break;
                }
                
                // ============ VV/DP MENU ============
                case 'vvmenu':
                {
                    m.react("📸");
                    
                    const vvSettings = await getGlobalSetting('vv_settings', {
                        autoDownload: config.AUTO_DOWNLOAD_VV === 'true',
                        sendToInbox: config.SEND_VV_TO_INBOX === 'true'
                    });
                    
                    const text = `╭─「 📸 VV/DP COMMANDS 」─➤
│
├─「 👤 PROFILE PICTURE 」
│ ✦ ${prefix}getdp [@tag]
│ ✦ ${prefix}getmydp
│ ✦ ${prefix}getgpdp
│ ✦ ${prefix}savedp [@tag]
│
├─「 👁️ VIEW ONCE (VV) 」
│ ✦ ${prefix}vv (reply to VV)
│ ✦ ${prefix}vvauto [on/off]
│ ✦ ${prefix}vvinbox [on/off]
│ ✦ ${prefix}vvstatus
│
├─「 ⚙️ CURRENT SETTINGS 」
│ ✦ Auto Download: ${vvSettings.autoDownload ? 'ON ✅' : 'OFF ❌'}
│ ✦ Send to Inbox: ${vvSettings.sendToInbox ? 'ON ✅' : 'OFF ❌'}
│
╰──────●●➤

${footer}`;

                    await m.reply(text);
                    break;
                }
                
                case 'vvauto':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await m.reply('❌ Permission denied.');
                        break;
                    }
                    
                    const state = args[0]?.toLowerCase();
                    if (state !== 'on' && state !== 'off') {
                        await m.reply(`Usage: ${prefix}vvauto [on/off]`);
                        break;
                    }
                    
                    const vvSettings = await getGlobalSetting('vv_settings', {});
                    vvSettings.autoDownload = state === 'on';
                    await setGlobalSetting('vv_settings', vvSettings);
                    
                    await m.reply(`✅ Auto download VV set to: *${state}*`);
                    break;
                }
                
                case 'vvinbox':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await m.reply('❌ Permission denied.');
                        break;
                    }
                    
                    const state = args[0]?.toLowerCase();
                    if (state !== 'on' && state !== 'off') {
                        await m.reply(`Usage: ${prefix}vvinbox [on/off]`);
                        break;
                    }
                    
                    const vvSettings = await getGlobalSetting('vv_settings', {});
                    vvSettings.sendToInbox = state === 'on';
                    await setGlobalSetting('vv_settings', vvSettings);
                    
                    await m.reply(`✅ Send VV to inbox set to: *${state}*`);
                    break;
                }
                
                case 'vvstatus':
                {
                    const vvSettings = await getGlobalSetting('vv_settings', {
                        autoDownload: config.AUTO_DOWNLOAD_VV === 'true',
                        sendToInbox: config.SEND_VV_TO_INBOX === 'true'
                    });
                    
                    const status = `╭─「 📸 VV SYSTEM STATUS 」─➤
│
│ 🔄 Auto Download: ${vvSettings.autoDownload ? 'ON ✅' : 'OFF ❌'}
│ 📬 Send to Inbox: ${vvSettings.sendToInbox ? 'ON ✅' : 'OFF ❌'}
│
│ *Commands:*
│ ✦ ${prefix}vvauto [on/off]
│ ✦ ${prefix}vvinbox [on/off]
│
╰──────●●➤`;

                    await m.reply(status);
                    break;
                }
                
                // ============ GET DP ============
                case 'getdp':
                {
                    m.react("🖼️");
                    
                    let targetJid = m.quoted?.sender || sender;
                    
                    if (args[0] && args[0].startsWith('@')) {
                        const mentioned = args[0].replace('@', '');
                        targetJid = mentioned.includes('@') ? mentioned : `${mentioned}@s.whatsapp.net`;
                    }
                    
                    try {
                        await m.reply('*🔍 Fetching profile picture...*');
                        
                        const ppUrl = await socket.profilePictureUrl(targetJid, 'image');
                        
                        if (ppUrl) {
                            await socket.sendMessage(from, { 
                                image: { url: ppUrl },
                                caption: `✅ *Profile Picture*\n\n👤 User: @${targetJid.split('@')[0]}`,
                                mentions: [targetJid]
                            }, { quoted: m });
                        } else {
                            await m.reply('❌ User has no profile picture.');
                        }
                    } catch (error) {
                        await m.reply('❌ Failed to get profile picture.');
                    }
                    break;
                }
                
                case 'getmydp':
                {
                    m.react("🖼️");
                    
                    try {
                        await m.reply('*🔍 Fetching your profile picture...*');
                        
                        const ppUrl = await socket.profilePictureUrl(sender, 'image');
                        
                        if (ppUrl) {
                            await socket.sendMessage(from, { 
                                image: { url: ppUrl },
                                caption: `✅ *Your Profile Picture*\n\n👤 User: @${sender.split('@')[0]}`,
                                mentions: [sender]
                            }, { quoted: m });
                        } else {
                            await m.reply('❌ You don\'t have a profile picture.');
                        }
                    } catch (error) {
                        await m.reply('❌ Failed to get your profile picture.');
                    }
                    break;
                }
                
                case 'getgpdp':
                {
                    if (!isGroup) {
                        await m.reply('❌ This command can only be used in groups!');
                        break;
                    }
                    
                    m.react("🖼️");
                    
                    try {
                        await m.reply('*🔍 Fetching group picture...*');
                        
                        const ppUrl = await socket.profilePictureUrl(from, 'image');
                        
                        if (ppUrl) {
                            await socket.sendMessage(from, { 
                                image: { url: ppUrl },
                                caption: `✅ *Group Profile Picture*\n\n👥 Group: ${from.split('@')[0]}`
                            }, { quoted: m });
                        } else {
                            await m.reply('❌ Group has no profile picture.');
                        }
                    } catch (error) {
                        await m.reply('❌ Failed to get group picture.');
                    }
                    break;
                }
                
                case 'savedp':
                {
                    m.react("💾");
                    
                    let targetJid = m.quoted?.sender || sender;
                    
                    if (args[0] && args[0].startsWith('@')) {
                        const mentioned = args[0].replace('@', '');
                        targetJid = mentioned.includes('@') ? mentioned : `${mentioned}@s.whatsapp.net`;
                    }
                    
                    try {
                        await m.reply('*🔍 Fetching and saving profile picture...*');
                        
                        const ppUrl = await socket.profilePictureUrl(targetJid, 'image');
                        
                        if (ppUrl) {
                            const response = await axios.get(ppUrl, { responseType: 'arraybuffer' });
                            const buffer = Buffer.from(response.data);
                            
                            const fileName = `dp_${targetJid.split('@')[0]}_${Date.now()}.jpg`;
                            const filePath = path.join(mediaDir, fileName);
                            fs.writeFileSync(filePath, buffer);
                            
                            const userJid = jidNormalizedUser(socket.user.id);
                            await socket.sendMessage(userJid, { 
                                image: { url: filePath },
                                caption: `📸 *Profile Picture Saved*\n\n👤 User: @${targetJid.split('@')[0]}\n🕒 Time: ${getTimestamp()}`,
                                mentions: [targetJid]
                            });
                            
                            await m.reply(`✅ Profile picture saved to your inbox!`);
                            
                            setTimeout(() => {
                                try { fs.unlinkSync(filePath); } catch(e) {}
                            }, 5000);
                        } else {
                            await m.reply('❌ User has no profile picture.');
                        }
                    } catch (error) {
                        await m.reply('❌ Failed to save profile picture.');
                    }
                    break;
                }
                
                // ============ VIEW ONCE COMMAND ============
                case 'vv':
                {
                    if (!isQuoted) {
                        await m.reply(`❌ Reply to a view once message with ${prefix}vv`);
                        break;
                    }
                    
                    m.react("👁️");
                    
                    const thinkingMsg = await socket.sendMessage(from, { 
                        text: '*📸 Processing view once message...*' 
                    }, { quoted: m });
                    
                    try {
                        const quotedMsg = m.quoted;
                        const isViewOnce = quotedMsg?.viewOnceMessage || 
                                          quotedMsg?.viewOnceMessageV2;
                        
                        if (!isViewOnce) {
                            await socket.sendMessage(from, { delete: thinkingMsg.key });
                            await m.reply('❌ This is not a view once message!');
                            break;
                        }
                        
                        const viewOnceContent = quotedMsg.viewOnceMessage?.message || 
                                               quotedMsg.viewOnceMessageV2?.message;
                        
                        if (!viewOnceContent) {
                            await socket.sendMessage(from, { delete: thinkingMsg.key });
                            await m.reply('❌ Could not extract content.');
                            break;
                        }
                        
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
                        }
                        
                        if (!mediaBuffer) {
                            await socket.sendMessage(from, { delete: thinkingMsg.key });
                            await m.reply('❌ Failed to download.');
                            break;
                        }
                        
                        await socket.sendMessage(from, { delete: thinkingMsg.key });
                        
                        const fileName = `vv_${Date.now()}.${mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : 'mp3'}`;
                        const filePath = path.join(tempDir, fileName);
                        fs.writeFileSync(filePath, mediaBuffer);
                        
                        const userJid = jidNormalizedUser(socket.user.id);
                        const captionText = `📸 *View Once Message*\n\n👤 From: @${m.quoted.sender.split('@')[0]}\n📱 Type: ${mediaType}\n🕒 Time: ${getTimestamp()}\n\n${caption}`;
                        
                        if (mediaType === 'image') {
                            await socket.sendMessage(userJid, { 
                                image: { url: filePath }, 
                                caption: captionText,
                                mentions: [m.quoted.sender]
                            });
                        } else if (mediaType === 'video') {
                            await socket.sendMessage(userJid, { 
                                video: { url: filePath }, 
                                caption: captionText,
                                mentions: [m.quoted.sender]
                            });
                        } else if (mediaType === 'audio') {
                            await socket.sendMessage(userJid, { 
                                audio: { url: filePath }, 
                                mimetype: 'audio/mp4',
                                caption: captionText,
                                mentions: [m.quoted.sender]
                            });
                        }
                        
                        await m.reply(`✅ View Once saved to your inbox!`);
                        
                        setTimeout(() => {
                            try { fs.unlinkSync(filePath); } catch(e) {}
                        }, 10000);
                        
                    } catch (error) {
                        await socket.sendMessage(from, { delete: thinkingMsg.key });
                        await m.reply('❌ Failed to process.');
                    }
                    break;
                }
                
                // ============ AUTO REPLY MENU ============
                case 'autoreply':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await m.reply('❌ Owner/Admin only.');
                        break;
                    }
                    
                    m.react("🤖");
                    
                    const autoReplyMsgs = await getAutoReplyMessages();
                    const autoReplyEnabled = await getGlobalSetting('auto_reply_enabled', config.AUTO_REPLY_ENABLED === 'true');
                    
                    let autoList = '';
                    let index = 1;
                    
                    for (const [keyword, data] of Object.entries(autoReplyMsgs)) {
                        autoList += `${index}. *${keyword}* → ${data.response.substring(0, 30)}...\n`;
                        index++;
                        if (index > 10) break;
                    }
                    
                    const text = `╭─「 🤖 AUTO REPLY SYSTEM 」─➤
│
│ 📢 Status: ${autoReplyEnabled ? 'ON ✅' : 'OFF ❌'}
│ 📊 Total: ${Object.keys(autoReplyMsgs).length}
│
├─「 📝 COMMANDS 」
│ ✦ ${prefix}addreply keyword|response
│ ✦ ${prefix}delreply [keyword]
│ ✦ ${prefix}editreply keyword|new response
│ ✦ ${prefix}listreply
│ ✦ ${prefix}replyon
│ ✦ ${prefix}replyoff
│ ✦ ${prefix}testreply [keyword]
│ ✦ ${prefix}clearreply
│
├─「 📋 ACTIVE REPLIES 」
${autoList || '│ ⚠️ No auto replies set'}
│
├─「 ✨ FEATURES 」
│ • Works with quoted messages
│ • Customize input/output messages
│ • User can add/edit/delete
│
╰──────●●➤

${footer}`;

                    await m.reply(text);
                    break;
                }
                
                case 'addreply':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await m.reply('❌ Owner/Admin only.');
                        break;
                    }
                    
                    const input = args.join(' ');
                    const [keyword, ...responseParts] = input.split('|');
                    
                    if (!keyword || responseParts.length === 0) {
                        await m.reply(`*Usage:* ${prefix}addreply keyword|response\n\n*Example:*\n${prefix}addreply hi|Hello! How can I help you?`);
                        break;
                    }
                    
                    const response = responseParts.join('|').trim();
                    await setAutoReplyMessage(keyword.trim(), response);
                    
                    await socket.sendMessage(from, {
                        image: { url: logo },
                        caption: `✅ *Auto Reply Added*\n\n🔑 *Keyword:* ${keyword.trim()}\n💬 *Response:* ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}\n\n> You can test with: ${prefix}testreply ${keyword.trim()}`,
                        footer: footer
                    }, { quoted: m });
                    break;
                }
                
                case 'editreply':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await m.reply('❌ Owner/Admin only.');
                        break;
                    }
                    
                    const input = args.join(' ');
                    const [keyword, ...responseParts] = input.split('|');
                    
                    if (!keyword || responseParts.length === 0) {
                        await m.reply(`*Usage:* ${prefix}editreply keyword|new response\n\n*Example:*\n${prefix}editreply hi|Hello! Welcome to our bot!`);
                        break;
                    }
                    
                    const response = responseParts.join('|').trim();
                    const updated = await updateAutoReplyMessage(keyword.trim(), response);
                    
                    if (updated) {
                        await m.reply(`✅ Auto reply updated for keyword: *${keyword.trim()}*`);
                    } else {
                        await m.reply(`❌ No auto reply found for keyword: *${keyword.trim()}*`);
                    }
                    break;
                }
                
                case 'listreply':
                {
                    const autoReplyMsgs = await getAutoReplyMessages();
                    
                    if (Object.keys(autoReplyMsgs).length === 0) {
                        await m.reply('📋 *No auto replies configured yet.*\n\nUse `.addreply keyword|response` to add one.');
                        break;
                    }
                    
                    let replyText = '*📋 Auto Reply List*\n\n';
                    let index = 1;
                    
                    for (const [keyword, data] of Object.entries(autoReplyMsgs)) {
                        replyText += `${index}. *${keyword}*\n   ↳ ${data.response.substring(0, 100)}${data.response.length > 100 ? '...' : ''}\n\n`;
                        index++;
                    }
                    
                    // Split if too long
                    if (replyText.length > 4000) {
                        const chunks = replyText.match(/.{1,4000}/g) || [];
                        for (let i = 0; i < chunks.length; i++) {
                            await socket.sendMessage(from, { 
                                text: `*📋 Auto Reply List (Part ${i+1}/${chunks.length})*\n\n${chunks[i]}` 
                            }, { quoted: m });
                        }
                    } else {
                        await m.reply(replyText);
                    }
                    break;
                }
                
                case 'delreply':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await m.reply('❌ Owner/Admin only.');
                        break;
                    }
                    
                    const keyword = args[0];
                    if (!keyword) {
                        await m.reply(`Usage: ${prefix}delreply [keyword]`);
                        break;
                    }
                    
                    await deleteAutoReplyMessage(keyword);
                    await m.reply(`✅ Auto reply deleted for keyword: *${keyword}*`);
                    break;
                }
                
                case 'replyon':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await m.reply('❌ Owner/Admin only.');
                        break;
                    }
                    
                    await setGlobalSetting('auto_reply_enabled', true);
                    await m.reply('✅ Auto Reply system *ENABLED*');
                    break;
                }
                
                case 'replyoff':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await m.reply('❌ Owner/Admin only.');
                        break;
                    }
                    
                    await setGlobalSetting('auto_reply_enabled', false);
                    await m.reply('✅ Auto Reply system *DISABLED*');
                    break;
                }
                
                case 'testreply':
                {
                    const keyword = args[0];
                    if (!keyword) {
                        await m.reply(`Usage: ${prefix}testreply [keyword]`);
                        break;
                    }
                    
                    const autoReplyMsgs = await getAutoReplyMessages();
                    if (autoReplyMsgs[keyword]) {
                        await socket.sendMessage(from, {
                            image: { url: logo },
                            caption: `*🤖 Auto Reply Test*\n\n🔑 *Keyword:* ${keyword}\n💬 *Response:*\n\n${autoReplyMsgs[keyword].response}`,
                            footer: footer
                        }, { quoted: m });
                    } else {
                        await m.reply(`❌ No auto reply found for keyword: *${keyword}*`);
                    }
                    break;
                }
                
                case 'clearreply':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await m.reply('❌ Owner/Admin only.');
                        break;
                    }
                    
                    writeJSON(sessionFiles.autoReply, {});
                    await m.reply('✅ All auto replies cleared!');
                    break;
                }
                
                // ============ BUTTON MENU ============
                case 'button':
                {
                    m.react("🔘");
                    
                    const currentSetting = await getButtonSetting(from);
                    const status = currentSetting.enabled ? 'ON ✅' : 'OFF ❌';
                    
                    const text = `╭─「 🔘 BUTTON SETTINGS 」─➤
│
│ 📍 Chat: ${isGroup ? 'Group' : 'Private'}
│ 🔘 Status: ${status}
│
├─「 📝 COMMANDS 」
│ ✦ ${prefix}buttonon
│ ✦ ${prefix}buttonoff
│ ✦ ${prefix}buttonstatus
│
├─「 ✨ DESCRIPTION 」
│ • ON: Menus show with interactive buttons
│ • OFF: Menus show as plain text
│
╰──────●●➤

${footer}`;

                    const buttons = [
                        { buttonId: `${prefix}buttonon`, buttonText: { displayText: "🔘 ON" }, type: 1 },
                        { buttonId: `${prefix}buttonoff`, buttonText: { displayText: "🔘 OFF" }, type: 1 },
                        { buttonId: `${prefix}menu`, buttonText: { displayText: "📜 MENU" }, type: 1 }
                    ];
                    
                    await socket.sendMessage(from, { 
                        text, 
                        footer: footer, 
                        buttons 
                    }, { quoted: m });
                    break;
                }
                
                case 'buttonon':
                {
                    await setButtonSetting(from, { enabled: true });
                    await m.reply('✅ Buttons enabled for this chat!');
                    break;
                }
                
                case 'buttonoff':
                {
                    await setButtonSetting(from, { enabled: false });
                    await m.reply('✅ Buttons disabled for this chat!');
                    break;
                }
                
                case 'buttonstatus':
                {
                    const currentSetting = await getButtonSetting(from);
                    const status = currentSetting.enabled ? 'ON ✅' : 'OFF ❌';
                    await m.reply(`🔘 Buttons are: *${status}* for this chat`);
                    break;
                }
                
                // ============ OWNER MENU ============
                case 'owner':
                {
                    m.react("👑");
                    
                    const text = `╭─「 👑 OWNER COMMANDS 」─➤
│
├─「 🤖 BOT MANAGEMENT 」
│ ✦ ${prefix}setname [name]
│ ✦ ${prefix}setlogo [url]
│ ✦ ${prefix}setfooter [text]
│ ✦ ${prefix}setprefix [symbol]
│ ✦ ${prefix}pair [number]
│
├─「 🔐 MODE CONTROL 」
│ ✦ ${prefix}mode
│ ✦ ${prefix}public
│ ✦ ${prefix}private
│
├─「 👥 ADMIN MANAGEMENT 」
│ ✦ ${prefix}addadmin [number]
│ ✦ ${prefix}removeadmin [number]
│ ✦ ${prefix}listadmins
│
├─「 📊 SESSION MANAGEMENT 」
│ ✦ ${prefix}listsessions
│ ✦ ${prefix}viewsessions
│ ✦ ${prefix}killsession [number]
│ ✦ ${prefix}clearsessions
│
├─「 📢 BROADCAST 」
│ ✦ ${prefix}bc [message]
│ ✦ ${prefix}bcimage [caption]
│
├─「 ⚙️ SYSTEM 」
│ ✦ ${prefix}stats
│ ✦ ${prefix}restart
│ ✦ ${prefix}shutdown
│
╰──────●●➤

${footer}`;

                    await m.reply(text);
                    break;
                }
                
                // ============ GROUP MENU ============
                case 'group':
                {
                    if (!isGroup) {
                        await m.reply('❌ This command can only be used in groups!');
                        break;
                    }
                    
                    m.react("👥");
                    
                    const text = `╭─「 👥 GROUP COMMANDS 」─➤
│
├─「 👥 MANAGEMENT 」
│ ✦ ${prefix}tagall
│ ✦ ${prefix}hidetag [text]
│ ✦ ${prefix}admins
│ ✦ ${prefix}grouplink
│ ✦ ${prefix}revoke
│
├─「 👤 MEMBERS 」
│ ✦ ${prefix}kick @tag
│ ✦ ${prefix}add [number]
│ ✦ ${prefix}promote @tag
│ ✦ ${prefix}demote @tag
│
├─「 ⚙️ SETTINGS 」
│ ✦ ${prefix}welcome [on/off]
│ ✦ ${prefix}goodbye [on/off]
│ ✦ ${prefix}antilink [on/off]
│
├─「 ℹ️ INFO 」
│ ✦ ${prefix}groupinfo
│ ✦ ${prefix}members
│ ✦ ${prefix}invitelist
│
╰──────●●➤

${footer}`;

                    await m.reply(text);
                    break;
                }
                
                case 'tagall':
                {
                    if (!isGroup) {
                        await m.reply('❌ Groups only!');
                        return;
                    }
                    
                    try {
                        const groupMetadata = await socket.groupMetadata(from);
                        const participants = groupMetadata.participants;
                        let mentions = [];
                        let text = '╭─「 👥 MENTION ALL 」─➤\n│\n';
                        
                        participants.forEach(p => {
                            mentions.push(p.id);
                            text += `│ 👤 @${p.id.split('@')[0]}\n`;
                        });
                        
                        text += `│\n╰──────●●➤\n\n> Total: ${participants.length} members`;
                        
                        await socket.sendMessage(from, { 
                            text, 
                            mentions 
                        }, { quoted: m });
                        
                    } catch (e) {
                        await m.reply('❌ Failed to tag members');
                    }
                    break;
                }
                
                case 'hidetag':
                {
                    if (!isGroup) {
                        await m.reply('❌ Groups only!');
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
                        }, { quoted: m });
                        
                    } catch (e) {
                        await m.reply('❌ Failed to send');
                    }
                    break;
                }
                
                case 'admins':
                {
                    if (!isGroup) {
                        await m.reply('❌ Groups only!');
                        return;
                    }
                    
                    try {
                        const groupMetadata = await socket.groupMetadata(from);
                        const admins = groupMetadata.participants.filter(p => p.admin);
                        let text = `╭─「 👑 GROUP ADMINS 」─➤\n│ 📛 *${groupMetadata.subject}*\n│ 👥 Total: ${admins.length}\n│\n`;
                        
                        admins.forEach((admin, index) => {
                            const role = admin.admin === 'superadmin' ? '👑 Owner' : '👮 Admin';
                            text += `│ ${index + 1}. @${admin.id.split('@')[0]} (${role})\n`;
                        });
                        
                        text += `│\n╰──────●●➤`;
                        
                        await socket.sendMessage(from, { 
                            text, 
                            mentions: admins.map(a => a.id)
                        }, { quoted: m });
                        
                    } catch (e) {
                        await m.reply('❌ Failed to get admins');
                    }
                    break;
                }
                
                case 'grouplink':
                {
                    if (!isGroup) {
                        await m.reply('❌ Groups only!');
                        return;
                    }
                    
                    try {
                        const code = await socket.groupInviteCode(from);
                        const link = `https://chat.whatsapp.com/${code}`;
                        
                        await socket.sendMessage(from, {
                            image: { url: logo },
                            caption: `🔗 *Group Link*\n\n📛 *${groupMetadata?.subject || 'Group'}*\n🔗 ${link}\n\n🕒 ${getTimestamp()}`,
                            footer: footer
                        }, { quoted: m });
                    } catch (e) {
                        await m.reply('❌ Failed to get link');
                    }
                    break;
                }
                
                case 'revoke':
                {
                    if (!isGroup) {
                        await m.reply('❌ Groups only!');
                        return;
                    }
                    
                    try {
                        await socket.groupRevokeInvite(from);
                        const code = await socket.groupInviteCode(from);
                        const link = `https://chat.whatsapp.com/${code}`;
                        await m.reply(`✅ *Link revoked!*\n\n🔗 *New Link:*\n${link}`);
                    } catch (e) {
                        await m.reply('❌ Failed to revoke');
                    }
                    break;
                }
                
                case 'kick':
                {
                    if (!isGroup) {
                        await m.reply('❌ Groups only!');
                        return;
                    }
                    
                    if (!m.quoted) {
                        await m.reply('❌ Reply to user');
                        return;
                    }
                    
                    try {
                        const userToKick = m.quoted.sender;
                        await socket.groupParticipantsUpdate(from, [userToKick], 'remove');
                        await m.reply(`✅ Removed @${userToKick.split('@')[0]}`);
                    } catch (e) {
                        await m.reply('❌ Failed to remove');
                    }
                    break;
                }
                
                case 'promote':
                {
                    if (!isGroup) {
                        await m.reply('❌ Groups only!');
                        return;
                    }
                    
                    if (!m.quoted) {
                        await m.reply('❌ Reply to user');
                        return;
                    }
                    
                    try {
                        const userToPromote = m.quoted.sender;
                        await socket.groupParticipantsUpdate(from, [userToPromote], 'promote');
                        await m.reply(`✅ Promoted @${userToPromote.split('@')[0]}`);
                    } catch (e) {
                        await m.reply('❌ Failed to promote');
                    }
                    break;
                }
                
                case 'demote':
                {
                    if (!isGroup) {
                        await m.reply('❌ Groups only!');
                        return;
                    }
                    
                    if (!m.quoted) {
                        await m.reply('❌ Reply to user');
                        return;
                    }
                    
                    try {
                        const userToDemote = m.quoted.sender;
                        await socket.groupParticipantsUpdate(from, [userToDemote], 'demote');
                        await m.reply(`✅ Demoted @${userToDemote.split('@')[0]}`);
                    } catch (e) {
                        await m.reply('❌ Failed to demote');
                    }
                    break;
                }
                
                // ============ DOWNLOAD MENU ============
                case 'download':
                {
                    m.react("📥");
                    
                    const text = `╭─「 📥 DOWNLOAD MENU 」─➤
│
├─「 🎵 AUDIO 」
│ ✦ ${prefix}song [query]
│ ✦ ${prefix}play [name]
│ ✦ ${prefix}ytmp3 [url]
│
├─「 🎬 VIDEO 」
│ ✦ ${prefix}video [query]
│ ✦ ${prefix}ytmp4 [url]
│ ✦ ${prefix}tiktok [url]
│ ✦ ${prefix}instagram [url]
│
├─「 📁 FILES 」
│ ✦ ${prefix}mediafire [url]
│ ✦ ${prefix}apk [app name]
│
├─「 🔍 SEARCH 」
│ ✦ ${prefix}yts [query]
│ ✦ ${prefix}google [query]
│
╰──────●●➤

${footer}`;

                    await m.reply(text);
                    break;
                }
                
                case 'song':
                case 'play':
                {
                    const query = args.join(' ');
                    if (!query) {
                        await m.reply(`Usage: ${prefix}song [song name]\n\nExample: ${prefix}song Shape of You`);
                        break;
                    }
                    
                    try {
                        m.react("🎵");
                        
                        const thinkingMsg = await socket.sendMessage(from, { 
                            text: '*🔍 Searching for song...*' 
                        }, { quoted: m });
                        
                        const search = await yts(query);
                        if (!search?.videos?.length) {
                            await socket.sendMessage(from, { delete: thinkingMsg.key });
                            await m.reply('❌ No results found!');
                            break;
                        }
                        
                        const video = search.videos[0];
                        const api = `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(video.url)}`;
                        const res = await axios.get(api, { timeout: 60000 });
                        
                        if (!res?.data?.result?.download) throw "API_FAILED";
                        
                        await socket.sendMessage(from, { delete: thinkingMsg.key });
                        
                        await socket.sendMessage(from, { 
                            audio: { url: res.data.result.download }, 
                            mimetype: "audio/mpeg", 
                            ptt: false 
                        }, { quoted: m });
                        
                        await socket.sendMessage(from, {
                            image: { url: logo },
                            caption: `✅ *Downloaded*\n\n🎵 *Title:* ${video.title}\n⏱️ *Duration:* ${video.timestamp}\n👁️ *Views:* ${video.views}`,
                            footer: footer
                        }, { quoted: m });
                        
                    } catch (err) {
                        await m.reply('❌ Failed to download song.');
                    }
                    break;
                }
                
                case 'tiktok':
                {
                    const url = args[0];
                    if (!url || !url.includes("tiktok.com")) {
                        await m.reply(`Usage: ${prefix}tiktok [tiktok url]\n\nExample: ${prefix}tiktok https://tiktok.com/@user/video/123456`);
                        break;
                    }
                    
                    try {
                        m.react("🎵");
                        
                        const thinkingMsg = await socket.sendMessage(from, { 
                            text: '*📥 Downloading TikTok video...*' 
                        }, { quoted: m });
                        
                        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(url)}`;
                        const { data } = await axios.get(apiUrl);
                        
                        if (!data.status || !data.data) throw "API_FAILED";
                        
                        const videoUrl = data.data.meta.media.find(v => v.type === "video").org;
                        
                        await socket.sendMessage(from, { delete: thinkingMsg.key });
                        
                        await socket.sendMessage(from, { 
                            video: { url: videoUrl }, 
                            caption: `✅ *TikTok Downloaded*\n\n👤 *Author:* ${data.data.author.nickname}\n👍 *Likes:* ${data.data.like}\n💬 *Comments:* ${data.data.comment}\n🔄 *Shares:* ${data.data.share}`,
                            footer: footer
                        }, { quoted: m });
                        
                    } catch (err) {
                        await m.reply('❌ Failed to download TikTok.');
                    }
                    break;
                }
                
                case 'mediafire':
                {
                    const url = args[0];
                    if (!url) {
                        await m.reply(`Usage: ${prefix}mediafire [mediafire url]`);
                        break;
                    }
                    
                    try {
                        m.react("📥");
                        
                        const thinkingMsg = await socket.sendMessage(from, { 
                            text: '*📁 Fetching MediaFire file...*' 
                        }, { quoted: m });
                        
                        const api = `https://tharuzz-ofc-apis.vercel.app/api/download/mediafire?url=${encodeURIComponent(url)}`;
                        const { data } = await axios.get(api);
                        
                        if (!data.success || !data.result) throw "API_FAILED";
                        
                        await socket.sendMessage(from, { delete: thinkingMsg.key });
                        
                        await socket.sendMessage(from, { 
                            document: { url: data.result.url }, 
                            fileName: data.result.filename, 
                            caption: `📁 *${data.result.filename}*\n📏 *Size:* ${data.result.size}\n📊 *Type:* ${data.result.ext}`,
                            footer: footer
                        }, { quoted: m });
                        
                    } catch (err) {
                        await m.reply('❌ Failed to download file.');
                    }
                    break;
                }
                
                // ============ TOOLS MENU ============
                case 'tools':
                {
                    m.react("🛠️");
                    
                    const text = `╭─「 🛠️ TOOLS MENU 」─➤
│
├─「 📊 BOT STATUS 」
│ ✦ ${prefix}ping
│ ✦ ${prefix}alive
│ ✦ ${prefix}uptime
│
├─「 🔍 INFO 」
│ ✦ ${prefix}sticker
│ ✦ ${prefix}toimg
│ ✦ ${prefix}tomp3
│ ✦ ${prefix}weather [city]
│
├─「 🎯 UTILITIES 」
│ ✦ ${prefix}calc [expression]
│ ✦ ${prefix}qr [text]
│ ✦ ${prefix}shorten [url]
│ ✦ ${prefix}chr [text]
│
├─「 🎨 HTML COLOR 」
│ ✦ ${prefix}htmlcolor [color name]
│
├─「 🔄 CONVERTERS 」
│ ✦ ${prefix}currency [amount] [from] [to]
│ ✦ ${prefix}b64encode [text]
│ ✦ ${prefix}b64decode [text]
│
╰──────●●➤

${footer}`;

                    await m.reply(text);
                    break;
                }
                
                // ============ PING COMMAND (NEW) ============
                case 'ping':
                {
                    const start = Date.now();
                    const latency = Date.now() - (msg.messageTimestamp * 1000 || Date.now());
                    const end = Date.now() - start;
                    
                    const text = `╭─「 📡 PING 」─➤
│
│ 🚀 *Response:* ${end}ms
│ ⚡ *Latency:* ${latency}ms
│ 🕒 *Time:* ${moment().format('HH:mm:ss')}
│ 📊 *Active:* ${activeSockets.size}
│
├─「 📊 SERVER 」
│ 💻 *Platform:* ${process.platform}
│ 💾 *Memory:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB
│ ⏰ *Uptime:* ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m
│
╰──────●●➤

${footer}`;

                    await socket.sendMessage(from, {
                        image: { url: logo },
                        caption: text,
                        footer: footer
                    }, { quoted: m });
                    break;
                }
                
                // ============ ALIVE COMMAND ============
                case 'alive':
                {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = uptime % 60;
                    
                    const text = `╭─「 🤖 ALIVE 」─➤
│
│ 👤 *Owner:* ${config.OWNER_NAME}
│ ✏️ *Prefix:* ${config.PREFIX}
│ 🧬 *Version:* ${config.BOT_VERSION}
│ ⏰ *Uptime:* ${hours}h ${minutes}m ${seconds}s
│ 💻 *Memory:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB
│ 📊 *Active:* ${activeSockets.size}
│
╰──────●●➤

${footer}`;

                    await socket.sendMessage(from, { 
                        image: { url: logo }, 
                        caption: text,
                        footer: footer
                    }, { quoted: m });
                    break;
                }
                
                // ============ CHR COMMAND (NEW) ============
                case 'chr':
                case 'count':
                {
                    const text = args.join(' ');
                    if (!text) {
                        await m.reply(`Usage: ${prefix}chr [text]\n\nExample: ${prefix}chr Hello World`);
                        break;
                    }
                    
                    const charCount = text.length;
                    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
                    const lineCount = text.split('\n').length;
                    const spaceCount = (text.match(/\s/g) || []).length;
                    const letterCount = (text.match(/[a-zA-Z]/g) || []).length;
                    const numberCount = (text.match(/[0-9]/g) || []).length;
                    
                    const result = `╭─「 📊 CHARACTER COUNTER 」─➤
│
│ 📝 *Text:* "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"
│
├─「 📈 STATISTICS 」
│ ✦ *Total Characters:* ${charCount}
│ ✦ *Total Words:* ${wordCount}
│ ✦ *Total Lines:* ${lineCount}
│ ✦ *Spaces:* ${spaceCount}
│ ✦ *Letters:* ${letterCount}
│ ✦ *Numbers:* ${numberCount}
│
╰──────●●➤`;

                    await m.reply(result);
                    break;
                }
                
                // ============ HTML COLOR COMMAND (NEW) ============
                case 'htmlcolor':
                case 'color':
                {
                    const colorName = args[0];
                    if (!colorName) {
                        await m.reply(`Usage: ${prefix}htmlcolor [color name]\n\nExample: ${prefix}htmlcolor red\n\nAvailable colors: red, blue, green, yellow, black, white, purple, orange, pink, brown, cyan, magenta, lime, maroon, navy, olive, teal, gold, silver, gray, indigo, violet, coral, tomato, salmon, khaki, plum, orchid`);
                        break;
                    }
                    
                    const colorCode = htmlColorToCode(colorName);
                    
                    if (colorCode === colorName) {
                        await m.reply(`❌ Unknown color: *${colorName}*\n\nTry: red, blue, green, yellow, etc.`);
                    } else {
                        const text = `╭─「 🎨 HTML COLOR 」─➤
│
│ 🏷️ *Name:* ${colorName}
│ 🔢 *Code:* ${colorCode}
│
├─「 🖼️ PREVIEW 」
│
╰──────●●➤

> Copy this code: *${colorCode}*`;

                        // Create a colored image preview (optional)
                        // For now, just send the code
                        await m.reply(text);
                    }
                    break;
                }
                
                // ============ STICKER COMMAND ============
                case 'sticker':
                case 's':
                {
                    if (!m.quoted) {
                        await m.reply(`❌ Reply to an image/video with ${prefix}sticker`);
                        break;
                    }
                    
                    try {
                        m.react("🎨");
                        
                        const thinkingMsg = await socket.sendMessage(from, { 
                            text: '*🖼️ Creating sticker...*' 
                        }, { quoted: m });
                        
                        let media;
                        if (m.quoted.imageMessage) {
                            media = await downloadContentFromMessage(m.quoted.imageMessage, 'image');
                        } else if (m.quoted.videoMessage) {
                            media = await downloadContentFromMessage(m.quoted.videoMessage, 'video');
                        } else {
                            await socket.sendMessage(from, { delete: thinkingMsg.key });
                            await m.reply('❌ Unsupported media');
                            break;
                        }
                        
                        let buffer = Buffer.from([]);
                        for await (const chunk of media) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }
                        
                        await socket.sendMessage(from, { delete: thinkingMsg.key });
                        
                        await socket.sendMessage(from, { 
                            sticker: buffer 
                        }, { quoted: m });
                        
                    } catch (err) {
                        await m.reply('❌ Failed to create sticker.');
                    }
                    break;
                }
                
                // ============ CALC COMMAND ============
                case 'calc':
                {
                    const expression = args.join(' ');
                    if (!expression) {
                        await m.reply(`Usage: ${prefix}calc [expression]\n\nExample: ${prefix}calc 2+2*5`);
                        break;
                    }
                    
                    try {
                        const result = eval(expression);
                        await m.reply(`📝 *${expression}* = *${result}*`);
                    } catch (e) {
                        await m.reply('❌ Invalid expression');
                    }
                    break;
                }
                
                // ============ QR COMMAND ============
                case 'qr':
                {
                    const text = args.join(' ');
                    if (!text) {
                        await m.reply(`Usage: ${prefix}qr [text]\n\nExample: ${prefix}qr Hello World`);
                        break;
                    }
                    
                    try {
                        m.react("📱");
                        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`;
                        await socket.sendMessage(from, { 
                            image: { url: qrUrl },
                            caption: `✅ QR Code for: ${text}`,
                            footer: footer
                        }, { quoted: m });
                    } catch (err) {
                        await m.reply('❌ Failed to generate');
                    }
                    break;
                }
                
                // ============ AI COMMAND (SoftOrbits) ============
                case 'ai':
                case 'gpt':
                case 'ask':
                case 'chat':
                {
                    const prompt = args.join(' ');
                    if (!prompt) {
                        await m.reply(`*🤖 AI Command*\n\nUsage: ${prefix}ai [your question]\n\n*Examples:*\n• ${prefix}ai who is Tony Khan\n• ${prefix}ai what is JavaScript\n• ${prefix}ai tell me a joke`);
                        break;
                    }
                    
                    // Send typing indicator
                    await setPresence(socket, from, 'composing');
                    
                    try {
                        m.react("🤖");
                        
                        // Show thinking message
                        const thinkingMsg = await socket.sendMessage(from, { 
                            text: '*🧠 Thinking...*' 
                        }, { quoted: m });
                        
                        // Call SoftOrbits AI
                        const result = await askSoftOrbitsAI(prompt);
                        
                        // Delete thinking message
                        if (thinkingMsg) {
                            await socket.sendMessage(from, {
                                delete: thinkingMsg.key
                            });
                        }
                        
                        if (result.status && result.reply) {
                            const replyText = result.reply;
                            
                            // Format the response nicely
                            const formattedResponse = `*🤖 AI Response*\n\n${replyText}\n\n${footer}`;
                            
                            // Send in chunks if too long (WhatsApp limit ~64k chars)
                            if (replyText.length > 4000) {
                                const chunks = replyText.match(/.{1,4000}/g) || [];
                                await socket.sendMessage(from, { 
                                    text: `*🤖 AI Response (Part 1/${chunks.length})*\n\n${chunks[0]}` 
                                }, { quoted: m });
                                
                                for (let i = 1; i < chunks.length; i++) {
                                    await socket.sendMessage(from, { 
                                        text: `*Part ${i+1}/${chunks.length}*\n\n${chunks[i]}` 
                                    });
                                    await delay(500);
                                }
                            } else {
                                await socket.sendMessage(from, { 
                                    text: formattedResponse 
                                }, { quoted: m });
                            }
                        } else {
                            await socket.sendMessage(from, { 
                                text: '❌ *AI Service Unavailable*\n\nPlease try again later or use another command.' 
                            }, { quoted: m });
                        }
                        
                    } catch (err) {
                        console.error('AI command error:', err);
                        await socket.sendMessage(from, { 
                            text: '❌ *Error*\n\nFailed to get AI response. Please try again.' 
                        }, { quoted: m });
                    }
                    
                    // Stop typing indicator
                    await setPresence(socket, from, 'paused');
                    break;
                }
                
                // ============ SETTINGS MENU ============
                case 'settings':
                {
                    m.react("⚙️");
                    
                    const publicMode = await isPublicMode();
                    
                    const text = `╭─「 ⚙️ SETTINGS MENU 」─➤
│
├─「 🤖 BOT CUSTOMIZATION 」
│ ✦ ${prefix}setname [name]
│ ✦ ${prefix}setlogo [url]
│ ✦ ${prefix}setfooter [text]
│ ✦ ${prefix}viewconfig
│
├─「 🔧 FEATURE SETTINGS 」
│ ✦ ${prefix}autostatus [on/off]
│ ✦ ${prefix}autorecord [on/off]
│ ✦ ${prefix}autovv [on/off]
│ ✦ ${prefix}vvinbox [on/off]
│
├─「 🔐 MODE SETTINGS 」
│ ✦ ${prefix}mode (current: ${publicMode ? 'PUBLIC' : 'PRIVATE'})
│ ✦ ${prefix}public
│ ✦ ${prefix}private
│
├─「 ⚡ PRESENCE SETTINGS 」
│ ✦ ${prefix}typing [on/off]
│ ✦ ${prefix}recording [on/off]
│ ✦ ${prefix}online [on/off]
│
├─「 🗑️ SESSION 」
│ ✦ ${prefix}deleteme
│ ✦ ${prefix}restart
│
╰──────●●➤

${footer}`;

                    await m.reply(text);
                    break;
                }
                
                // ============ BOT CUSTOMIZATION ============
                case 'setname':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await m.reply('❌ Permission denied.');
                        break;
                    }
                    
                    if (!args[0]) {
                        await m.reply(`Usage: ${prefix}setname [new bot name]`);
                        break;
                    }
                    
                    const newName = args.join(' ');
                    await saveUserPreset(number, { botName: newName });
                    
                    await socket.sendMessage(from, {
                        image: { url: logo },
                        caption: `✅ *Bot Name Changed*\n\n📛 *Old:* ${botName}\n📛 *New:* ${newName}`,
                        footer: footer
                    }, { quoted: m });
                    break;
                }
                
                case 'setlogo':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await m.reply('❌ Permission denied.');
                        break;
                    }
                    
                    if (!args[0]) {
                        await m.reply(`Usage: ${prefix}setlogo [image url]`);
                        break;
                    }
                    
                    const logoUrl = args[0];
                    await saveUserPreset(number, { logo: logoUrl });
                    
                    await socket.sendMessage(from, {
                        image: { url: logoUrl },
                        caption: `✅ *Bot Logo Changed*\n\n🖼️ *New Logo:* ${logoUrl.substring(0, 50)}...`,
                        footer: footer
                    }, { quoted: m });
                    break;
                }
                
                case 'setfooter':
                {
                    if (!isOwner && !(await loadAdminsFromFile()).includes(senderNumber)) {
                        await m.reply('❌ Permission denied.');
                        break;
                    }
                    
                    if (!args[0]) {
                        await m.reply(`Usage: ${prefix}setfooter [footer text]`);
                        break;
                    }
                    
                    const newFooter = args.join(' ');
                    await saveUserPreset(number, { footer: newFooter });
                    
                    await m.reply(`✅ *Footer Changed*\n\n📝 *New Footer:* ${newFooter}`);
                    break;
                }
                
                case 'setprefix':
                {
                    if (!isOwner) {
                        await m.reply('❌ Owner only.');
                        break;
                    }
                    
                    if (!args[0]) {
                        await m.reply(`Usage: ${prefix}setprefix [symbol]`);
                        break;
                    }
                    
                    config.PREFIX = args[0];
                    await m.reply(`✅ Prefix changed to: *${args[0]}*`);
                    break;
                }
                
                case 'viewconfig':
                {
                    const userPreset = await getUserPreset(number);
                    
                    const text = `╭─「 ⚙️ CURRENT CONFIG 」─➤
│
│ 🤖 *Name:* ${userPreset.botName || config.BOT_NAME}
│ 🖼️ *Logo:* ${(userPreset.logo || config.LOGO_URL).substring(0, 50)}...
│ 📝 *Footer:* ${userPreset.footer || config.BOT_FOOTER}
│ ✏️ *Prefix:* ${config.PREFIX}
│
╰──────●●➤`;

                    await m.reply(text);
                    break;
                }
                
                // ============ FEATURE SETTINGS ============
                case 'autostatus':
                {
                    const state = args[0]?.toLowerCase();
                    if (state !== 'on' && state !== 'off') {
                        await m.reply(`Usage: ${prefix}autostatus [on/off]\nCurrent: ${config.AUTO_VIEW_STATUS === 'true' ? 'ON' : 'OFF'}`);
                        break;
                    }
                    
                    config.AUTO_VIEW_STATUS = state === 'on' ? 'true' : 'false';
                    config.AUTO_LIKE_STATUS = state === 'on' ? 'true' : 'false';
                    
                    await setGlobalSetting('AUTO_VIEW_STATUS', config.AUTO_VIEW_STATUS);
                    await setGlobalSetting('AUTO_LIKE_STATUS', config.AUTO_LIKE_STATUS);
                    
                    await m.reply(`✅ Auto Status set to: *${state}*`);
                    break;
                }
                
                case 'autorecord':
                {
                    const state = args[0]?.toLowerCase();
                    if (state !== 'on' && state !== 'off') {
                        await m.reply(`Usage: ${prefix}autorecord [on/off]\nCurrent: ${config.AUTO_RECORDING === 'true' ? 'ON' : 'OFF'}`);
                        break;
                    }
                    
                    config.AUTO_RECORDING = state === 'on' ? 'true' : 'false';
                    await setGlobalSetting('AUTO_RECORDING', config.AUTO_RECORDING);
                    
                    await m.reply(`✅ Auto Recording set to: *${state}*`);
                    break;
                }
                
                // ============ CREATIVE MENU ============
                case 'creative':
                {
                    m.react("🎨");
                    
                    const text = `╭─「 🎨 CREATIVE MENU 」─➤
│
├─「 🤖 AI (SoftOrbits) 」
│ ✦ ${prefix}ai [question]
│ ✦ ${prefix}ask [question]
│ ✦ ${prefix}chat [message]
│
├─「 ✍️ TEXT TOOLS 」
│ ✦ ${prefix}fancy [text]
│ ✦ ${prefix}reverse [text]
│ ✦ ${prefix}chr [text]
│
├─「 🎮 GAMES 」
│ ✦ ${prefix}dice
│ ✦ ${prefix}flipcoin
│ ✦ ${prefix}rps [rock/paper/scissors]
│
├─「 🖼️ IMAGE 」
│ ✦ ${prefix}sticker
│ ✦ ${prefix}circle
│ ✦ ${prefix}blur
│
╰──────●●➤

${footer}`;

                    await m.reply(text);
                    break;
                }
                
                // ============ ADMIN MANAGEMENT ============
                case 'addadmin':
                {
                    if (!isOwner) {
                        await m.reply('❌ Owner only.');
                        break;
                    }
                    
                    const target = args[0];
                    if (!target) {
                        await m.reply(`Usage: ${prefix}addadmin [number]`);
                        break;
                    }
                    
                    await addAdminToFile(target);
                    await m.reply(`✅ Admin added: ${target}`);
                    break;
                }
                
                case 'removeadmin':
                {
                    if (!isOwner) {
                        await m.reply('❌ Owner only.');
                        break;
                    }
                    
                    const target = args[0];
                    if (!target) {
                        await m.reply(`Usage: ${prefix}removeadmin [number]`);
                        break;
                    }
                    
                    await removeAdminFromFile(target);
                    await m.reply(`✅ Admin removed: ${target}`);
                    break;
                }
                
                case 'listadmins':
                {
                    const admins = await loadAdminsFromFile();
                    let text = `╭─「 👑 ADMIN LIST 」─➤\n│\n│ 👤 *Owner:* ${config.OWNER_NUMBER}\n│\n`;
                    
                    if (admins.length > 0) {
                        admins.forEach((admin, index) => {
                            text += `│ ${index + 1}. ${admin}\n`;
                        });
                    } else {
                        text += `│ No admins added yet\n`;
                    }
                    
                    text += `│\n╰──────●●➤`;
                    
                    await m.reply(text);
                    break;
                }
                
                // ============ SESSION MANAGEMENT ============
                case 'listsessions':
                case 'bots':
                {
                    const admins = await loadAdminsFromFile();
                    if (!isOwner && !admins.includes(senderNumber)) {
                        await m.reply('❌ Permission denied.');
                        break;
                    }
                    
                    const activeCount = activeSockets.size;
                    const activeNumbers = Array.from(activeSockets.keys());
                    
                    let text = `╭─「 🤖 ACTIVE SESSIONS 」─➤\n│\n│ 📊 *Total:* ${activeCount}\n│\n`;
                    
                    if (activeCount > 0) {
                        activeNumbers.forEach((num, index) => {
                            text += `│ ${index + 1}. ${num}\n`;
                        });
                    } else {
                        text += `│ ⚠️ No active sessions\n`;
                    }
                    
                    text += `│\n╰──────●●➤`;
                    
                    await m.reply(text);
                    break;
                }
                
                case 'deleteme':
                {
                    const sanitized = number.replace(/[^0-9]/g, '');
                    
                    if (!isOwner && senderNumber !== sanitized) {
                        await m.reply('❌ Permission denied.');
                        break;
                    }
                    
                    try {
                        await removeSessionFromFile(sanitized);
                        
                        const sessionPath = path.join(sessionsDir, `session_${sanitized}`);
                        if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath);
                        
                        try { socket.ws?.close(); } catch(e) {}
                        activeSockets.delete(sanitized);
                        
                        await m.reply('✅ Session deleted!');
                    } catch (err) {
                        await m.reply('❌ Failed to delete.');
                    }
                    break;
                }
                
                case 'stats':
                {
                    const allNumbers = await getAllNumbersFromFile();
                    const admins = await loadAdminsFromFile();
                    const autoReplyMsgs = await getAutoReplyMessages();
                    
                    const memoryUsage = process.memoryUsage();
                    const uptime = process.uptime();
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);
                    
                    const text = `╭─「 📊 BOT STATISTICS 」─➤
│
│ 🤖 *Bot:* ${botName}
│ 👥 *Registered:* ${allNumbers.length}
│ 👑 *Admins:* ${admins.length}
│ ⚡ *Active:* ${activeSockets.size}
│ 🤖 *Auto Replies:* ${Object.keys(autoReplyMsgs).length}
│
├─「 💻 SYSTEM 」
│ ⏰ *Uptime:* ${hours}h ${minutes}m ${seconds}s
│ 💾 *RAM:* ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB
│ 🖥️ *Platform:* ${process.platform}
│
├─「 🕒 SERVER TIME 」
│ 📅 ${getTimestamp()}
│
╰──────●●➤

${footer}`;

                    await socket.sendMessage(from, {
                        image: { url: logo },
                        caption: text,
                        footer: footer
                    }, { quoted: m });
                    break;
                }
                
                case 'restart':
                {
                    if (!isOwner) {
                        await m.reply('❌ Owner only.');
                        break;
                    }
                    
                    await m.reply('🔄 *Restarting bot...*\n⏱️ Please wait 5 seconds');
                    
                    setTimeout(() => {
                        process.exit(0);
                    }, 2000);
                    break;
                }
                
                case 'shutdown':
                {
                    if (!isOwner) {
                        await m.reply('❌ Owner only.');
                        break;
                    }
                    
                    await m.reply('🔴 *Shutting down bot...*\n👋 Goodbye!');
                    
                    setTimeout(() => {
                        process.exit(0);
                    }, 1000);
                    break;
                }
                
                // ============ DEFAULT ============
                default:
                    // Unknown command
                    break;
            }
        } catch (err) {
            console.error('Command error:', err);
            try {
                await socket.sendMessage(from, { text: '❌ An error occurred.' }, { quoted: msg });
            } catch(e) {}
        }
    });
}

// ---------------- SESSION SETUP ----------------
async function setupBotSession(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(sessionsDir, `session_${sanitizedNumber}`);
    
    if (activeSockets.has(sanitizedNumber)) {
        if (!res.headersSent) res.send({ status: 'already_connected' });
        return;
    }
    
    const savedCreds = await loadCredsFromFile(sanitizedNumber);
    if (savedCreds?.creds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(savedCreds.creds, null, 2));
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
        
        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        
        if (!socket.authState.creds.registered) {
            try {
                const code = await socket.requestPairingCode(sanitizedNumber);
                if (!res.headersSent) res.send({ code });
            } catch (error) {
                if (!res.headersSent) res.status(500).send({ error: 'Failed to get code' });
            }
        } else {
            if (!res.headersSent) res.send({ status: 'already_registered' });
        }
        
        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = fs.readFileSync(path.join(sessionPath, 'creds.json'), 'utf8');
            const credsObj = JSON.parse(fileContent);
            await saveCredsToFile(sanitizedNumber, credsObj, state.keys || null);
        });
        
        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            
            if (connection === 'open') {
                try {
                    await delay(2000);
                    
                    activeSockets.set(sanitizedNumber, socket);
                    await addNumberToFile(sanitizedNumber);
                    
                    await joinGroup(socket);
                    
                    const userCfg = await loadUserConfigFromFile(sanitizedNumber);
                    const botName = userCfg.botName || config.BOT_NAME;
                    const logo = userCfg.logo || config.LOGO_URL;
                    
                    const userJid = jidNormalizedUser(socket.user.id);
                    const welcomeText = `╭─「 ✅ CONNECTED 」─➤
│
│ 🤖 *Bot:* ${botName}
│ 📞 *Number:* ${sanitizedNumber}
│ 🕒 *Time:* ${getTimestamp()}
│
│ ✨ Type *${config.PREFIX}menu* to start
│
╰──────●●➤

${config.BOT_FOOTER}`;
                    
                    await socket.sendMessage(userJid, { 
                        image: { url: logo },
                        caption: welcomeText,
                        footer: config.BOT_FOOTER
                    });
                    
                    console.log(`✅ Connected: ${sanitizedNumber}`);
                } catch (e) {
                    console.error('Connection open error:', e);
                }
            }
            
            if (connection === 'close') {
                try {
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                } catch(e) {}
                
                activeSockets.delete(sanitizedNumber);
                console.log(`❌ Disconnected: ${sanitizedNumber}`);
            }
        });
        
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === 401) {
                    await removeSessionFromFile(sanitizedNumber);
                    activeSockets.delete(sanitizedNumber);
                }
            }
        });
        
    } catch (error) {
        console.error('Session setup error:', error);
        if (!res.headersSent) res.status(500).send({ error: 'Failed to setup' });
    }
}

// ---------------- API ROUTES ----------------
router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) return res.status(400).send({ error: 'Number required' });
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
        activeSessions: activeSockets.size 
    });
});

// Admin API
router.post('/admin/add', async (req, res) => {
    const { jid } = req.body;
    if (!jid) return res.status(400).send({ error: 'jid required' });
    await addAdminToFile(jid);
    res.status(200).send({ status: 'ok' });
});

router.post('/admin/remove', async (req, res) => {
    const { jid } = req.body;
    if (!jid) return res.status(400).send({ error: 'jid required' });
    await removeAdminFromFile(jid);
    res.status(200).send({ status: 'ok' });
});

router.get('/admin/list', async (req, res) => {
    const list = await loadAdminsFromFile();
    res.status(200).send({ admins: list });
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
