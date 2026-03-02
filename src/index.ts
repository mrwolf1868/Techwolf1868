import { 
    default as makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore, 
    jidDecode,
    getContentType,
    downloadContentFromMessage
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import fs from 'fs-extra';
import path from 'path';
import express from 'express';
import cors from 'cors';
import chalk from 'chalk';
import NodeCache from 'node-cache';
import axios from 'axios';
import { fileURLToPath } from 'url';
import moment from 'moment-timezone';
import { getAIReply, resetAI, translate } from './ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const OWNER_NUMBER = process.env.OWNER_NUMBER || '254700000000';
const BOT_NAME = process.env.BOT_NAME || 'TECHWIZARD';
let PREFIX = process.env.PREFIX || '.';

// Bot Settings State
let settings = {
    autoreply: false,
    chatbot: false,
    autoread: true,
    autotyping: false,
    autorecording: false,
    autoreact: false,
    autoadd: false,
    alwaysonline: true,
    antilink: false,
    antispam: false,
    antimention: false,
    antitag: false,
    welcome: false,
    goodbye: false,
    menuImage: '',
    admins: [OWNER_NUMBER.split('@')[0]]
};

// Load settings from file if exists
const SETTINGS_FILE = './settings.json';
if (fs.existsSync(SETTINGS_FILE)) {
    try {
        const savedSettings = fs.readJsonSync(SETTINGS_FILE);
        settings = { ...settings, ...savedSettings };
        console.log(chalk.green('Settings loaded from disk.'));
    } catch (e) {
        console.log(chalk.red('Error loading settings:', e));
    }
}

function saveSettings() {
    try {
        fs.writeJsonSync(SETTINGS_FILE, settings, { spaces: 4 });
    } catch (e) {
        console.log(chalk.red('Error saving settings:', e));
    }
}

// Spam Tracker
const spamTracker: { [user: string]: { count: number, lastMessageTime: number } } = {};

const groupSchedules: { [key: string]: { open?: NodeJS.Timeout, close?: NodeJS.Timeout } } = {};

const msgRetryCounterCache = new NodeCache();
const store = {
    bind: (ev: any) => {},
    loadMessage: async (chat: string, id: string, conn: any) => null
};

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Global error handlers to prevent bot from crashing/sleeping
process.on('uncaughtException', (err) => console.error('Caught exception:', err));
process.on('unhandledRejection', (reason, p) => console.error('Unhandled Rejection at:', p, 'reason:', reason));

let pairingCode = "";
let isPairing = false;
let botSock: any = null;
let onlineInterval: any = null;
const ignoredMessageIds = new Set<string>();
const massAddingGroups = new Set<string>();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/connect', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });

    if (botSock) {
        try {
            botSock.ev.removeAllListeners();
            botSock.end(undefined);
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) {}
    }
    if (fs.existsSync('session')) {
        try { fs.emptyDirSync('session'); } catch (e) {}
    }

    pairingCode = "";
    isPairing = true;
    startBot(phoneNumber.replace(/[^0-9]/g, ''), true);

    let retries = 0;
    const checkCode = setInterval(() => {
        if (pairingCode) {
            clearInterval(checkCode);
            res.json({ code: pairingCode });
        } else if (retries > 15) {
            clearInterval(checkCode);
            res.status(500).json({ error: 'Failed to generate pairing code' });
        }
        retries++;
    }, 1000);
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/', (req, res) => {
    const numberParam = req.query.number as string;
    
    if (numberParam) {
        const targetNumber = numberParam.replace(/[^0-9]/g, '');
        if (!targetNumber) return res.status(400).send('Invalid number');

        (async () => {
            try {
                if (botSock) {
                    try {
                        botSock.ev.removeAllListeners();
                        botSock.end(undefined);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (e) {}
                }
                if (fs.existsSync('session')) {
                    try { fs.emptyDirSync('session'); } catch (e) {}
                }

                pairingCode = "";
                isPairing = true;
                startBot(targetNumber, true);

                let retries = 0;
                const checkCode = setInterval(() => {
                    if (pairingCode) {
                        clearInterval(checkCode);
                        res.send(pairingCode);
                    } else if (retries > 20) {
                        clearInterval(checkCode);
                        res.status(500).send('Timeout generating code');
                    }
                    retries++;
                }, 1000);
            } catch (err) {
                res.status(500).send('Error: ' + err);
            }
        })();
    } else {
        const isConnected = botSock?.authState?.creds?.registered || false;
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${BOT_NAME} Status</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <style>
                    body { background: #050505; color: #00ff00; font-family: 'Courier New', Courier, monospace; }
                    .neon-border { border: 1px solid #00ff00; box-shadow: 0 0 15px rgba(0, 255, 0, 0.3); }
                    .neon-text { text-shadow: 0 0 5px #00ff00; }
                </style>
            </head>
            <body class="min-h-screen flex items-center justify-center p-4">
                <div class="max-w-md w-full p-8 rounded-xl neon-border bg-black/50 backdrop-blur-sm text-center space-y-6">
                    <h1 class="text-3xl font-bold neon-text tracking-widest uppercase">${BOT_NAME}</h1>
                    <div class="py-4 border-y border-green-500/30">
                        <p class="text-sm uppercase tracking-widest opacity-70">System Status</p>
                        <p class="text-2xl font-bold ${isConnected ? 'text-green-400' : 'text-red-500'}">
                            ${isConnected ? '● ONLINE' : '○ OFFLINE'}
                        </p>
                    </div>
                    <div class="space-y-2">
                        <p class="text-xs opacity-50 uppercase tracking-widest">Pairing Protocol</p>
                        <p class="text-sm text-green-400/80">
                            To initiate pairing, append your number to the URL:<br>
                            <code class="bg-green-900/30 px-2 py-1 rounded mt-2 inline-block text-white">/?number=2547XXXXXXXX</code>
                        </p>
                    </div>
                    <div class="pt-4">
                        <p class="text-[10px] opacity-30 uppercase tracking-widest">Runtime: ${process.uptime().toFixed(0)}s</p>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
});

app.post('/api/pair', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.json({ status: 'error', message: 'Phone number required' });
    
    // If already pairing, we'll allow a new one to override it
    isPairing = true;
    pairingCode = "";
    
    // Send response immediately to avoid "Initializing..." hang
    res.json({ status: 'success' });

    // Start bot in background
    (async () => {
        try {
            // Clear session for fresh pairing
            if (botSock) {
                try {
                    botSock.ev.removeAllListeners();
                    botSock.end(undefined);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (e) {}
            }

            if (fs.existsSync('session')) {
                try {
                    fs.emptyDirSync('session');
                } catch (e) {
                    console.log('Error clearing session:', e);
                }
            }
            
            startBot(phone.replace(/[^0-9]/g, ''), true);
        } catch (err) {
            console.log('Pairing error:', err);
            isPairing = false;
        }
    })();
});

app.post('/api/reset', async (req, res) => {
    try {
        if (botSock) {
            botSock.ev.removeAllListeners();
            botSock.end(undefined);
        }
        if (fs.existsSync('session')) {
            fs.emptyDirSync('session');
        }
        res.json({ status: 'success', message: 'Bot reset successfully. Please pair again.' });
        process.exit(0); // Restart process to ensure clean state
    } catch (e) {
        res.status(500).json({ status: 'error', message: String(e) });
    }
});

app.get('/api/status', (req, res) => {
    res.json({ 
        code: pairingCode, 
        connected: botSock?.authState?.creds?.registered || false 
    });
});

async function startBot(phoneNumber?: string, isNewPairing = false) {
    const sessionPath = process.env.SESSION_PATH || 'session';
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    // Fallback version if fetch fails
    let version: any = [2, 3000, 1015901307]; 
    try {
        const v = await fetchLatestBaileysVersion();
        version = v.version;
    } catch (e) {
        console.log('Error fetching version, using fallback');
    }

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        keepAliveIntervalMs: 10000,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        retryRequestDelayMs: 2000,
    });

    botSock = sock;
    store.bind(sock.ev);

    // Pairing Code Logic
    if (!sock.authState.creds.registered && phoneNumber) {
        console.log(chalk.yellow(`[!] Requesting Pairing Code for ${phoneNumber}...`));
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                pairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(chalk.black.bgGreen(`\n--- PAIRING CODE: ${pairingCode} ---\n`));
            } catch (err) {
                console.log(chalk.red(`Error requesting pairing code: ${err}`));
                isPairing = false;
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(chalk.yellow(`[!] Connection closed. Reconnecting: ${shouldReconnect}`));
            if (shouldReconnect) {
                setTimeout(() => startBot(phoneNumber, isNewPairing), 5000); // 5s delay to prevent loops
            } else {
                isPairing = false;
                console.log(chalk.red('[!] Logged out. Please pair again.'));
            }
        } else if (connection === 'open') {
            console.log(chalk.green(`\n[+] ${BOT_NAME} CONNECTED SUCCESSFULLY!\n`));
            isPairing = false;

            // Auto Join Group
            try {
                await sock.groupAcceptInvite('EhiFIIYPxZM5jTUfXYH8M9');
                console.log('Auto-joined support group!');
            } catch (e) {
                console.log('Auto-join failed (probably already joined):', e);
            }

            // Auto Join Channel
            try {
                const newsletterCode = '0029Vb6Vxo960eBmxo0Q5z0Z';
                const metadata = await (sock as any).newsletterMetadata("invite", newsletterCode);
                await (sock as any).newsletterFollow(metadata.id);
                console.log('Auto-joined support channel!');
            } catch (e) {
                console.log('Auto-join channel failed:', e);
            }

            // Always Online Logic
            if (onlineInterval) clearInterval(onlineInterval);
            onlineInterval = setInterval(async () => {
                if (settings.alwaysonline && botSock) {
                    await botSock.sendPresenceUpdate('available');
                }
            }, 10000);
            
            // Send Welcome Message & Menu ONLY on new pairing
            if (isNewPairing) {
                try {
                    const userJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    console.log(`[DEBUG] Sending welcome message to ${userJid}`);
                    const welcomeMsg = `*🧙‍♂️ WELCOME TO ${BOT_NAME}!*

Hello! Your bot has been successfully connected and is now active.

*BOT STATUS:*
⚡ Status: Online
⚡ Prefix: ${PREFIX}
⚡ Owner: @254111967697

Type *${PREFIX}menu* to see all available commands.

Enjoy using TECHWIZARD!`;

                    const menuText = `╭━━〔 ♤ ${BOT_NAME} ♤ 〕━━┈⊷
┃ 👤 User: ${userJid.split('@')[0]}
┃ 👑 Owner: @254111967697
┃ ⏱ Runtime: ${runtime(process.uptime())}
┃ ⚡ Status: Online
┃ 🔣 Prefix: ${PREFIX}
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 👤 GENERAL COMMANDS 〕━━┈⊷
┃ ${PREFIX}menu
┃ ${PREFIX}allmenu
┃ ${PREFIX}ping
┃ ${PREFIX}alive
┃ ${PREFIX}owner
┃ ${PREFIX}runtime
┃ ${PREFIX}speed
┃ ${PREFIX}id
┃ ${PREFIX}afk
┃ ${PREFIX}reminder
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 🤖 AI SYSTEM 〕━━┈⊷
┃ ${PREFIX}autoreply on/off
┃ ${PREFIX}chatbot on/off
┃ ${PREFIX}resetai
┃ ${PREFIX}ai
┃ ${PREFIX}ask
┃ ${PREFIX}chatgpt
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 👑 OWNER COMMANDS 〕━━┈⊷
┃ ${PREFIX}admin
┃ ${PREFIX}addadmin
┃ ${PREFIX}removeadmin
┃ ${PREFIX}broadcast
┃ ${PREFIX}setprefix
┃ ${PREFIX}setmenuimage
┃ ${PREFIX}shutdown
┃ ${PREFIX}userjoin
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 ⚙️ AUTO SYSTEM 〕━━┈⊷
┃ ${PREFIX}autoread on/off
┃ ${PREFIX}autotyping on/off
┃ ${PREFIX}autorecording on/off
┃ ${PREFIX}autoreact on/off
┃ ${PREFIX}autoadd on/off
┃ ${PREFIX}alwaysonline on/off
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 👥 GROUP COMMANDS 〕━━┈⊷
┃ ${PREFIX}add
┃ ${PREFIX}kick
┃ ${PREFIX}promote
┃ ${PREFIX}demote
┃ ${PREFIX}tagall
┃ ${PREFIX}hidetag
┃ ${PREFIX}linkgc
┃ ${PREFIX}leave
┃ ${PREFIX}mute
┃ ${PREFIX}unmute
┃ ${PREFIX}opengroup
┃ ${PREFIX}closegroup
┃ ${PREFIX}welcome on/off
┃ ${PREFIX}goodbye on/off
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 🛡 PROTECTION COMMANDS 〕━━┈⊷
┃ ${PREFIX}antilink on/off
┃ ${PREFIX}antispam on/off
┃ ${PREFIX}antimention on/off
┃ ${PREFIX}antitag on/off
┃ ${PREFIX}warn
┃ ${PREFIX}block
┃ ${PREFIX}unblock
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 🧰 TOOL COMMANDS 〕━━┈⊷
┃ ${PREFIX}translate
┃ ${PREFIX}calc
┃ ${PREFIX}tts
┃ ${PREFIX}shorturl
┃ ${PREFIX}qr
┃ ${PREFIX}readqr
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 📁 CONTACT COMMANDS 〕━━┈⊷
┃ ${PREFIX}vcf
┃ ${PREFIX}add (reply vcf)
╰━━━━━━━━━━━━━━━┈⊷

╰━❮ ${BOT_NAME} SYSTEM ACTIVE ❯━╯`;

                    await sock.sendMessage(userJid, { text: welcomeMsg, mentions: [userJid, '254111967697@s.whatsapp.net'] });
                    await sock.sendMessage(userJid, { text: menuText, mentions: ['254111967697@s.whatsapp.net'] });
                    isNewPairing = false; // Reset flag after sending
                    console.log(`[DEBUG] Welcome message sent successfully.`);
                } catch (e) {
                    console.log(`[ERROR] Failed to send welcome message:`, e);
                }
            }
        }
    });

    sock.ev.on('group-participants.update', async (anu) => {
        console.log(`[DEBUG] Group Participants Update: ${anu.id} Action: ${anu.action}`);
        try {
            if (massAddingGroups.has(anu.id)) return; // Skip if mass adding (silent mode)
            
            let metadata;
            try {
                metadata = await sock.groupMetadata(anu.id);
            } catch (e) {
                console.log(`[ERROR] Failed to fetch group metadata for ${anu.id}:`, e);
                return;
            }

            let participants = anu.participants;
            for (let num of participants) {
                const id = typeof num === 'string' ? num : (num as any).id;
                if (anu.action == 'add' && settings.welcome) {
                    let welcomeText = `Welcome @${id.split('@')[0]} to *${metadata.subject}*! 🎉\n\nRead the rules and enjoy your stay.`;
                    await sock.sendMessage(anu.id, { text: welcomeText, mentions: [id] });
                } else if (anu.action == 'remove' && settings.goodbye) {
                    let goodbyeText = `@${id.split('@')[0]} has left the group. Goodbye! 👋`;
                    await sock.sendMessage(anu.id, { text: goodbyeText, mentions: [id] });
                }
            }
        } catch (err) {
            console.log('Error in group-participants.update:', err);
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate: any) => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;
            mek.message = (getContentType(mek.message) === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message;
            if (mek.key && mek.key.remoteJid === 'status@broadcast') return;
            
            const m = smsg(sock, mek, store);
            if (!m) return;
            const from = m.chat;

            // Auto Add (Accept Group Invites)
            if (settings.autoadd && m.mtype === 'groupInviteMessage') {
                try {
                    const inviteCode = m.msg?.inviteCode || m.message?.groupInviteMessage?.inviteCode;
                    if (inviteCode) {
                        await sock.groupAcceptInvite(inviteCode);
                        console.log(`[AUTO-ADD] Joined group via invite from ${m.sender}`);
                    }
                } catch (e) {
                    console.log(`[AUTO-ADD] Failed to join group:`, e);
                }
            }
            
            // Robust Body Extraction
            const type = getContentType(mek.message);
            let body = (type === 'conversation') ? mek.message.conversation : 
                         (type === 'imageMessage') ? mek.message.imageMessage.caption : 
                         (type === 'videoMessage') ? mek.message.videoMessage.caption : 
                         (type === 'extendedTextMessage') ? mek.message.extendedTextMessage.text : 
                         (type === 'buttonsResponseMessage') ? mek.message.buttonsResponseMessage.selectedButtonId : 
                         (type === 'listResponseMessage') ? mek.message.listResponseMessage.singleSelectReply.selectedRowId : 
                         (type === 'templateButtonReplyMessage') ? mek.message.templateButtonReplyMessage.selectedId : 
                         '';
            
            // Handle interactive messages (new button types)
            if (type === 'interactiveResponseMessage') {
                try {
                    const nativeFlow = mek.message.interactiveResponseMessage.nativeFlowResponseMessage;
                    if (nativeFlow && nativeFlow.paramsJson) {
                        const params = JSON.parse(nativeFlow.paramsJson);
                        body = params.id || '';
                    }
                } catch (e) {
                    console.log("[DEBUG] Failed to parse interactive message:", e);
                }
            }

            // Fallback
            if (typeof body !== 'string') body = '';
            if (!body) body = m.text || '';
            if (typeof body !== 'string') body = String(body);

            console.log(`[DEBUG] Message from ${from}: type=${type}, body="${body}"`);

            const prefix = PREFIX || '.';
            const isCmd = body.startsWith(prefix);
            const command = isCmd ? body.slice(prefix.length).trim().split(' ')[0].toLowerCase() : '';
            const args = body.trim().split(/ +/).slice(1);
            const text = args.join(" ");
            const sender = m.sender || '';
            const senderNumber = sender.split('@')[0] || '';
            const isOwner = OWNER_NUMBER.includes(senderNumber);
            const isAdmin = settings.admins.includes(senderNumber) || isOwner;

            console.log(`[DEBUG] isCmd=${isCmd}, command=${command}, sender=${sender}`);

            // Typing/Recording simulation
            if (settings.autotyping) await sock.sendPresenceUpdate('composing', from);
            if (settings.autorecording) await sock.sendPresenceUpdate('recording', from);

            // Chatbot Logic
            if (!isCmd && settings.chatbot && !m.key.fromMe && sock.user?.id && m.sender !== sock.user.id && !m.sender.startsWith(sock.user.id.split(':')[0])) {
                if (m.isGroup) {
                    const botNumber = sock.user.id.split(':')[0];
                    const isMentioned = m.mentionedJid.some((jid: string) => jid.startsWith(botNumber));
                    const isReplyToBot = m.quoted && m.quoted.sender && m.quoted.sender.startsWith(botNumber);
                    if (!isMentioned && !isReplyToBot) return;
                }
                try {
                    await sock.sendPresenceUpdate('composing', from);
                    const reply = await getAIReply(from, body || m.text);
                    await sock.sendMessage(from, { text: reply }, { quoted: m });
                } catch (e) {
                    console.log("Chatbot error:", e);
                }
            }

            // Auto Reply (Simple Away Message)
            if (!isCmd && settings.autoreply && !settings.chatbot && !m.key.fromMe && !m.isGroup) {
                try {
                    await sock.sendMessage(from, { text: "Hello! I am an automated bot. The owner is currently unavailable." }, { quoted: m });
                } catch (e) {}
            }

            // Auto Read
            if (settings.autoread && !m.key.fromMe) {
                try {
                    await sock.readMessages([m.key]);
                } catch (e) {
                    console.log("[DEBUG] Failed to read message:", e);
                }
            }

            // Auto React
            if (settings.autoreact && !m.key.fromMe && !isCmd) {
                try {
                    const reactions = ['❤️', '👍', '🔥', '✨', '🤖', '💯', '🙌', '🎉'];
                    const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
                    await sock.sendMessage(from, { react: { text: randomReaction, key: m.key } });
                } catch (e) {
                    console.log("[DEBUG] Failed to react:", e);
                }
            }

            if (isCmd) {
                console.log(chalk.blue(`[CMD] ${command} from ${sender}`));
                switch (command) {
                    case 'menu':
                    case 'help':
                    case 'allmenu': {
                        const uptime = process.uptime();
                        const userNumber = sender.split('@')[0];
                        const menuText = `╭━━〔 ♤ ${BOT_NAME} ♤ 〕━━┈⊷
┃ 👤 User: ${userNumber}
┃ 👑 Owner: @254111967697
┃ ⏱ Runtime: ${runtime(uptime)}
┃ ⚡ Status: Online
┃ 🔣 Prefix: ${prefix}
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 👤 GENERAL COMMANDS 〕━━┈⊷
┃ ${prefix}menu
┃ ${prefix}allmenu
┃ ${prefix}ping
┃ ${prefix}alive
┃ ${prefix}owner
┃ ${prefix}runtime
┃ ${prefix}speed
┃ ${prefix}id
┃ ${prefix}afk
┃ ${prefix}reminder
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 🤖 AI SYSTEM 〕━━┈⊷
┃ ${prefix}autoreply on/off
┃ ${prefix}chatbot on/off
┃ ${prefix}resetai
┃ ${prefix}ai
┃ ${prefix}ask
┃ ${prefix}chatgpt
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 👑 OWNER COMMANDS 〕━━┈⊷
┃ ${prefix}admin
┃ ${prefix}addadmin
┃ ${prefix}removeadmin
┃ ${prefix}broadcast
┃ ${prefix}setprefix
┃ ${prefix}setmenuimage
┃ ${prefix}shutdown
┃ ${prefix}userjoin
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 ⚙️ AUTO SYSTEM 〕━━┈⊷
┃ ${prefix}autoread on/off
┃ ${prefix}autotyping on/off
┃ ${prefix}autorecording on/off
┃ ${prefix}autoreact on/off
┃ ${prefix}autoadd on/off
┃ ${prefix}alwaysonline on/off
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 👥 GROUP COMMANDS 〕━━┈⊷
┃ ${prefix}add
┃ ${prefix}kick
┃ ${prefix}promote
┃ ${prefix}demote
┃ ${prefix}tagall
┃ ${prefix}hidetag
┃ ${prefix}linkgc
┃ ${prefix}leave
┃ ${prefix}mute
┃ ${prefix}unmute
┃ ${prefix}opengroup
┃ ${prefix}closegroup
┃ ${prefix}welcome on/off
┃ ${prefix}goodbye on/off
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 🛡 PROTECTION COMMANDS 〕━━┈⊷
┃ ${prefix}antilink on/off
┃ ${prefix}antispam on/off
┃ ${prefix}antimention on/off
┃ ${prefix}antitag on/off
┃ ${prefix}warn
┃ ${prefix}block
┃ ${prefix}unblock
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 🧰 TOOL COMMANDS 〕━━┈⊷
┃ ${prefix}translate
┃ ${prefix}calc
┃ ${prefix}tts
┃ ${prefix}shorturl
┃ ${prefix}qr
┃ ${prefix}readqr
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 📁 CONTACT COMMANDS 〕━━┈⊷
┃ ${prefix}vcf
┃ ${prefix}add (reply vcf)
╰━━━━━━━━━━━━━━━┈⊷

╰━❮ ${BOT_NAME} SYSTEM ACTIVE ❯━╯`;
                        await sock.sendMessage(from, { text: menuText, mentions: ['254111967697@s.whatsapp.net'] }, { quoted: m });
                        break;
                    }

                    case 'speed':
                    case 'ping': {
                        const start = Date.now();
                        await sock.sendMessage(from, { text: 'Pinging...' }, { quoted: m });
                        const end = Date.now();
                        await sock.sendMessage(from, { text: `Pong! Speed: ${end - start}ms` }, { quoted: m });
                        break;
                    }

                    case 'alive':
                        m.reply(`*I am alive!* ⚡\n\n*Runtime:* ${runtime(process.uptime())}\n*Bot Name:* ${BOT_NAME}`);
                        break;

                    case 'owner':
                        const vcard = 'BEGIN:VCARD\n' // metadata of the contact card
                            + 'VERSION:3.0\n' 
                            + 'FN:TechWizard Owner\n' // full name
                            + 'ORG:TechWizard;\n' // the organization of the contact
                            + 'TEL;type=CELL;type=VOICE;waid=254111967697:+254 111 967 697\n' // WhatsApp ID + phone number
                            + 'END:VCARD';
                        await sock.sendMessage(from, { 
                            contacts: { 
                                displayName: 'TechWizard Owner', 
                                contacts: [{ vcard }] 
                            }
                        }, { quoted: m });
                        break;

                    case 'runtime':
                        m.reply(`*System Runtime:* ${runtime(process.uptime())}`);
                        break;

                    case 'id':
                        m.reply(from);
                        break;

                    case 'afk':
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Sets your status to Away From Keyboard.\n*Usage:* ${prefix}afk <reason>\n*Example:* ${prefix}afk Sleeping`);
                        m.reply(`You are now AFK: ${text}`);
                        break;

                    case 'reminder':
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Sets a quick reminder.\n*Usage:* ${prefix}reminder <time>|<message>\n*Example:* ${prefix}reminder 10s|Check the door`);
                        const [timeRem, ...remTextParts] = text.split('|');
                        const remMessage = remTextParts.join('|');
                        if (!remMessage) return m.reply('Please provide a message for the reminder.');
                        
                        let delayMs = 0;
                        const timeMatch = timeRem.toLowerCase().match(/(\d+)(s|m|h|d)/);
                        if (timeMatch) {
                            const val = parseInt(timeMatch[1]);
                            const unit = timeMatch[2];
                            if (unit === 's') delayMs = val * 1000;
                            else if (unit === 'm') delayMs = val * 60 * 1000;
                            else if (unit === 'h') delayMs = val * 60 * 60 * 1000;
                            else if (unit === 'd') delayMs = val * 24 * 60 * 60 * 1000;
                        } else {
                            delayMs = parseInt(timeRem) * 1000; // Default to seconds if just a number
                        }

                        if (isNaN(delayMs) || delayMs <= 0) return m.reply('Invalid time format! Use e.g. 10s, 5m, 1h');
                        if (delayMs > 24 * 60 * 60 * 1000 * 7) return m.reply('Reminder cannot be set for more than 7 days.');

                        m.reply(`Reminder set for ${timeRem}! I will notify you then.`);
                        setTimeout(() => {
                            sock.sendMessage(from, { text: `⏰ *REMINDER:* ${remMessage}` }, { quoted: m });
                        }, delayMs);
                        break;

                    case 'autoreply':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.autoreply = true; saveSettings(); m.reply('Autoreply enabled!'); }
                        else if (text === 'off') { settings.autoreply = false; saveSettings(); m.reply('Autoreply disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles automated replies.\n*Usage:* ${prefix}autoreply on/off`);
                        break;

                    case 'chatbot':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.chatbot = true; saveSettings(); m.reply('Chatbot enabled!'); }
                        else if (text === 'off') { settings.chatbot = false; saveSettings(); m.reply('Chatbot disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles AI chatbot for all messages.\n*Usage:* ${prefix}chatbot on/off`);
                        break;

                    case 'resetai':
                        resetAI(from);
                        m.reply('AI Context reset!');
                        break;

                    case 'admin':
                        m.reply(`*ADMINS list:* \n\n${settings.admins.map(a => `@${a}`).join('\n')}`);
                        break;

                    case 'addadmin':
                        if (!isOwner) return m.reply('Owner only!');
                        const newAdmin = m.mentionedJid[0] ? m.mentionedJid[0].split('@')[0] : text.replace(/[^0-9]/g, '');
                        if (!newAdmin) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Adds a user to the bot admin list.\n*Usage:* ${prefix}addadmin <tag/number>\n*Example:* ${prefix}addadmin @user`);
                        if (settings.admins.includes(newAdmin)) return m.reply('Already admin!');
                        settings.admins.push(newAdmin);
                        saveSettings();
                        m.reply(`@${newAdmin} is now an admin!`);
                        break;

                    case 'removeadmin':
                        if (!isOwner) return m.reply('Owner only!');
                        const remAdmin = m.mentionedJid[0] ? m.mentionedJid[0].split('@')[0] : text.replace(/[^0-9]/g, '');
                        if (!remAdmin) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Removes a user from the bot admin list.\n*Usage:* ${prefix}removeadmin <tag/number>\n*Example:* ${prefix}removeadmin @user`);
                        if (remAdmin === OWNER_NUMBER.split('@')[0]) return m.reply('Cannot remove the main owner!');
                        settings.admins = settings.admins.filter(a => a !== remAdmin);
                        saveSettings();
                        m.reply(`@${remAdmin} removed from admins!`);
                        break;

                    case 'setprefix':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Changes the bot command prefix.\n*Usage:* ${prefix}setprefix <symbol>\n*Example:* ${prefix}setprefix !`);
                        PREFIX = text;
                        m.reply(`Prefix changed to: ${PREFIX}`);
                        break;

                    case 'setmenuimage':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (!m.quoted || m.quoted.mtype !== 'imageMessage') return m.reply(`Reply to an image with ${prefix}setmenuimage to change the menu header.`);
                        try {
                            const media = await m.quoted.download();
                            const imagePath = './menu_image.jpg';
                            await fs.writeFile(imagePath, media);
                            settings.menuImage = imagePath;
                            saveSettings();
                            m.reply('Menu image updated successfully!');
                        } catch (e) {
                            m.reply('Failed to update menu image: ' + e);
                        }
                        break;

                    case 'shutdown':
                        if (!isOwner) return m.reply('Owner only!');
                        await m.reply('Shutting down...');
                        process.exit();
                        break;

                    case 'userjoin':
                        if (!isAdmin) return m.reply('Admin only!');
                        m.reply('User join logs enabled!');
                        break;

                    case 'autoread':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.autoread = true; saveSettings(); m.reply('Autoread enabled!'); }
                        else if (text === 'off') { settings.autoread = false; saveSettings(); m.reply('Autoread disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles auto-reading of messages.\n*Usage:* ${prefix}autoread on/off`);
                        break;

                    case 'autotyping':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.autotyping = true; saveSettings(); m.reply('Autotyping enabled!'); }
                        else if (text === 'off') { settings.autotyping = false; saveSettings(); m.reply('Autotyping disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles "typing..." status simulation.\n*Usage:* ${prefix}autotyping on/off`);
                        break;

                    case 'autorecording':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.autorecording = true; saveSettings(); m.reply('Autorecording enabled!'); }
                        else if (text === 'off') { settings.autorecording = false; saveSettings(); m.reply('Autorecording disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles "recording..." status simulation.\n*Usage:* ${prefix}autorecording on/off`);
                        break;

                    case 'autoreact':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.autoreact = true; saveSettings(); m.reply('Autoreact enabled!'); }
                        else if (text === 'off') { settings.autoreact = false; saveSettings(); m.reply('Autoreact disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles auto-reactions to messages.\n*Usage:* ${prefix}autoreact on/off`);
                        break;

                    case 'autoadd':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.autoadd = true; saveSettings(); m.reply('Autoadd enabled!'); }
                        else if (text === 'off') { settings.autoadd = false; saveSettings(); m.reply('Autoadd disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles auto-accepting group invites.\n*Usage:* ${prefix}autoadd on/off`);
                        break;

                    case 'alwaysonline':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.alwaysonline = true; saveSettings(); m.reply('Always online enabled!'); }
                        else if (text === 'off') { settings.alwaysonline = false; saveSettings(); m.reply('Always online disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Keeps the bot status as "Online".\n*Usage:* ${prefix}alwaysonline on/off`);
                        break;

                    case 'ai':
                    case 'ask':
                    case 'chatgpt':
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Asks the AI a question.\n*Usage:* ${prefix}ai <query>\n*Example:* ${prefix}ai What is the capital of Kenya?`);
                        try {
                            const reply = await getAIReply(from, text);
                            await sock.sendMessage(from, { text: reply }, { quoted: m });
                        } catch (e) {
                            m.reply("Error calling AI: " + e);
                        }
                        break;

                    case 'add':
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isAdmin) return m.reply('Admin only!');
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Adds a member to the group.\n*Usage:* ${prefix}add <number>\n*Example:* ${prefix}add 254700000000`);
                        const addJid = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        await sock.groupParticipantsUpdate(from, [addJid], 'add');
                        m.reply('Added!');
                        break;

                    case 'addall':
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isAdmin) return m.reply('Admin only!');
                        let participantsToAdd: string[] = [];
                        if (m.quoted && m.quoted.mtype === 'documentMessage') {
                            const vcfBuffer = await m.quoted.download();
                            const vcfText = vcfBuffer.toString();
                            participantsToAdd = vcfText.match(/TEL;[^:]*:([^\n]*)/g)?.map(n => n.split(':')[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net') || [];
                        } else if (text) {
                            participantsToAdd = text.match(/\d+/g)?.map(n => n + '@s.whatsapp.net') || [];
                        } else {
                            return m.reply(`*⚠️ MISSING SOURCE*\n\nReply to a VCF file or provide numbers.\n*Usage:* ${prefix}addall <numbers>`);
                        }
                        participantsToAdd = [...new Set(participantsToAdd)];
                        if (participantsToAdd.length === 0) return m.reply('No valid numbers found!');
                        m.reply(`*🛡️ PROTECTIVE ADD MODE*\n\nFound ${participantsToAdd.length} unique numbers.\nStarting safe add process (3-6s delay/user) to prevent bans.\nWelcome messages will be suppressed.`);
                        massAddingGroups.add(from);
                        let successCount = 0;
                        let failCount = 0;
                        try {
                            const groupMeta = await sock.groupMetadata(from);
                            const existingParticipants = new Set(groupMeta.participants.map(p => p.id));
                            for (const jid of participantsToAdd) {
                                if (!massAddingGroups.has(from)) {
                                    m.reply('🛑 Mass add stopped by user.');
                                    break;
                                }
                                if (existingParticipants.has(jid)) continue;
                                try {
                                    await sock.groupParticipantsUpdate(from, [jid], 'add');
                                    successCount++;
                                } catch (e) {
                                    failCount++;
                                }
                                await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 3000) + 3000));
                            }
                        } catch (e) {
                            console.log('Addall error:', e);
                            m.reply('Error fetching group metadata.');
                        } finally {
                            massAddingGroups.delete(from);
                        }
                        m.reply(`*✅ ADDALL COMPLETE*\n\nAdded: ${successCount}\nFailed/Already in: ${failCount}`);
                        break;

                    case 'stopadd':
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isAdmin) return m.reply('Admin only!');
                        if (massAddingGroups.has(from)) {
                            massAddingGroups.delete(from);
                            m.reply('Stopping mass add process...');
                        } else {
                            m.reply('No mass add process running in this group.');
                        }
                        break;

                    case 'autojoin':
                    case 'join':
                        if (!isOwner) return m.reply('Owner only!');
                        if (!text) return m.reply(`*⚠️ MISSING LINK*\n\n*Usage:* ${prefix}autojoin <group_link>`);
                        const inviteCode = text.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/)?.[1];
                        if (!inviteCode) return m.reply('Invalid WhatsApp group link!');
                        try {
                            await sock.groupAcceptInvite(inviteCode);
                            m.reply('✅ Successfully joined the group!');
                        } catch (e) {
                            console.log('Join error:', e);
                            m.reply('❌ Failed to join. The link might be invalid, revoked, or I might be banned from that group.');
                        }
                        break;

                    case 'kick':
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isAdmin) return m.reply('Admin only!');
                        const kickJid = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        if (!kickJid || kickJid === '@s.whatsapp.net') return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Kicks a member from the group.\n*Usage:* ${prefix}kick <tag/reply/number>`);
                        await sock.groupParticipantsUpdate(from, [kickJid], 'remove');
                        m.reply('Kicked!');
                        break;

                    case 'promote':
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isAdmin) return m.reply('Admin only!');
                        const promJid = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        if (!promJid || promJid === '@s.whatsapp.net') return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Promotes a member to group admin.\n*Usage:* ${prefix}promote <tag/reply/number>`);
                        await sock.groupParticipantsUpdate(from, [promJid], 'promote');
                        m.reply('Promoted!');
                        break;

                    case 'demote':
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isAdmin) return m.reply('Admin only!');
                        const demJid = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        if (!demJid || demJid === '@s.whatsapp.net') return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Demotes a group admin to member.\n*Usage:* ${prefix}demote <tag/reply/number>`);
                        await sock.groupParticipantsUpdate(from, [demJid], 'demote');
                        m.reply('Demoted!');
                        break;

                    case 'linkgc':
                        if (!m.isGroup) return m.reply('Groups only!');
                        const linkGc = await sock.groupInviteCode(from);
                        m.reply(`https://chat.whatsapp.com/${linkGc}`);
                        break;

                    case 'leave':
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isOwner) return m.reply('Owner only!');
                        await sock.groupLeave(from);
                        break;

                    case 'mute':
                    case 'closegroup': {
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isAdmin) return m.reply('Admin only!');
                        
                        if (!groupSchedules[from]) groupSchedules[from] = {};
                        
                        if (text) {
                            const match = text.toLowerCase().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
                            if (match) {
                                let hours = parseInt(match[1]);
                                const minutes = parseInt(match[2]);
                                const ampm = match[3];
                                if (ampm === 'pm' && hours < 12) hours += 12;
                                if (ampm === 'am' && hours === 12) hours = 0;
                                
                                if (groupSchedules[from].close) clearTimeout(groupSchedules[from].close);
                                
                                const scheduleClose = () => {
                                    const now = moment().tz('Africa/Nairobi');
                                    const target = moment().tz('Africa/Nairobi').hours(hours).minutes(minutes).seconds(0).milliseconds(0);
                                    
                                    if (target.isSameOrBefore(now)) {
                                        target.add(1, 'days');
                                    }
                                    
                                    const delay = target.diff(now);
                                    
                                    groupSchedules[from].close = setTimeout(async () => {
                                        try {
                                            await sock.groupSettingUpdate(from, 'announcement');
                                            sock.sendMessage(from, { text: 'Group closed as scheduled!' });
                                        } catch (e) { console.log(e); }
                                        scheduleClose(); // Reschedule for next day
                                    }, delay);
                                };
                                
                                scheduleClose();
                                m.reply(`Group scheduled to close daily at ${text} (EAT).`);
                                break;
                            }
                        }
                        
                        if (groupSchedules[from].close) {
                            clearTimeout(groupSchedules[from].close);
                            delete groupSchedules[from].close;
                            m.reply('Scheduled daily closing has been disabled.');
                        }
                        await sock.groupSettingUpdate(from, 'announcement');
                        m.reply('Group closed!');
                        break;
                    }

                    case 'unmute':
                    case 'opengroup': {
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isAdmin) return m.reply('Admin only!');
                        
                        if (!groupSchedules[from]) groupSchedules[from] = {};
                        
                        if (text) {
                            const match = text.toLowerCase().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
                            if (match) {
                                let hours = parseInt(match[1]);
                                const minutes = parseInt(match[2]);
                                const ampm = match[3];
                                if (ampm === 'pm' && hours < 12) hours += 12;
                                if (ampm === 'am' && hours === 12) hours = 0;
                                
                                if (groupSchedules[from].open) clearTimeout(groupSchedules[from].open);
                                
                                const scheduleOpen = () => {
                                    const now = moment().tz('Africa/Nairobi');
                                    const target = moment().tz('Africa/Nairobi').hours(hours).minutes(minutes).seconds(0).milliseconds(0);
                                    
                                    if (target.isSameOrBefore(now)) {
                                        target.add(1, 'days');
                                    }
                                    
                                    const delay = target.diff(now);
                                    
                                    groupSchedules[from].open = setTimeout(async () => {
                                        try {
                                            await sock.groupSettingUpdate(from, 'not_announcement');
                                            sock.sendMessage(from, { text: 'Group opened as scheduled!' });
                                        } catch (e) { console.log(e); }
                                        scheduleOpen(); // Reschedule for next day
                                    }, delay);
                                };
                                
                                scheduleOpen();
                                m.reply(`Group scheduled to open daily at ${text} (EAT).`);
                                break;
                            }
                        }
                        
                        if (groupSchedules[from].open) {
                            clearTimeout(groupSchedules[from].open);
                            delete groupSchedules[from].open;
                            m.reply('Scheduled daily opening has been disabled.');
                        }
                        await sock.groupSettingUpdate(from, 'not_announcement');
                        m.reply('Group opened!');
                        break;
                    }

                    case 'antispam':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.antispam = true; saveSettings(); m.reply('Antispam enabled!'); }
                        else if (text === 'off') { settings.antispam = false; saveSettings(); m.reply('Antispam disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles anti-spam protection.\n*Usage:* ${prefix}antispam on/off`);
                        break;

                    case 'antimention':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.antimention = true; saveSettings(); m.reply('Antimention enabled!'); }
                        else if (text === 'off') { settings.antimention = false; saveSettings(); m.reply('Antimention disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles anti-mention protection.\n*Usage:* ${prefix}antimention on/off`);
                        break;

                    case 'antitag':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.antitag = true; saveSettings(); m.reply('Antitag enabled!'); }
                        else if (text === 'off') { settings.antitag = false; saveSettings(); m.reply('Antitag disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles anti-tag protection.\n*Usage:* ${prefix}antitag on/off`);
                        break;

                    case 'warn':
                        if (!isAdmin) return m.reply('Admin only!');
                        const warnJid = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        if (!warnJid || warnJid === '@s.whatsapp.net') return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Issues a warning to a member.\n*Usage:* ${prefix}warn <tag/reply/number>`);
                        m.reply(`@${warnJid.split('@')[0]} has been warned!`, from, { mentions: [warnJid] });
                        break;

                    case 'translate':
                        if (!text) return m.reply('Provide text to translate! Format: .translate <lang>|<text>');
                        if (!process.env.GEMINI_API_KEY) return m.reply("Gemini API Key is not configured.");
                        try {
                            const [targetLang, ...toTranslate] = text.split('|');
                            if (!toTranslate.length) return m.reply('Format: .translate <lang>|<text>');
                            const result = await translate(toTranslate.join('|'), targetLang);
                            m.reply(`*Translation (${targetLang}):*\n${result}`);
                        } catch (e) {
                            m.reply("Translation error: " + e);
                        }
                        break;

                    case 'calc':
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Solves a math expression.\n*Usage:* ${prefix}calc <expression>\n*Example:* ${prefix}calc 5*5+10`);
                        try {
                            const result = eval(text.replace(/[^0-9+\-*/().]/g, ''));
                            m.reply(`Result: ${result}`);
                        } catch (e) {
                            m.reply('Invalid expression!');
                        }
                        break;

                    case 'tts':
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Converts text to speech audio.\n*Usage:* ${prefix}tts <text>\n*Example:* ${prefix}tts Hello world`);
                        try {
                            const axios = (await import('axios')).default;
                            const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;
                            const response = await axios.get(ttsUrl, { responseType: 'arraybuffer' });
                            await sock.sendMessage(from, { audio: Buffer.from(response.data), mimetype: 'audio/mp4', ptt: true }, { quoted: m });
                        } catch (e) {
                            m.reply("TTS Error: " + e);
                        }
                        break;

                    case 'shorturl':
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Shortens a long URL.\n*Usage:* ${prefix}shorturl <url>\n*Example:* ${prefix}shorturl https://google.com`);
                        try {
                            const axios = (await import('axios')).default;
                            const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(text)}`);
                            m.reply(`*Shortened URL:* ${res.data}`);
                        } catch (e) {
                            m.reply("Shortener Error: " + e);
                        }
                        break;

                    case 'qr':
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Generates a QR code for text.\n*Usage:* ${prefix}qr <text>\n*Example:* ${prefix}qr Hello`);
                        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(text)}&size=500x500`;
                        await sock.sendMessage(from, { image: { url: qrUrl }, caption: `*QR Code for:* ${text}` }, { quoted: m });
                        break;

                    case 'readqr':
                        if (!m.quoted || m.quoted.mtype !== 'imageMessage') return m.reply(`Reply to a QR code image with ${prefix}readqr`);
                        try {
                            const axios = (await import('axios')).default;
                            const media = await m.quoted.download();
                            const formData = new (await import('form-data')).default();
                            formData.append('file', media, { filename: 'qr.png' });
                            const res = await axios.post('https://api.qrserver.com/v1/read-qr-code/', formData, {
                                headers: formData.getHeaders()
                            });
                            const qrData = res.data[0]?.symbol[0]?.data;
                            if (qrData) m.reply(`*QR Content:* ${qrData}`);
                            else m.reply("Could not read QR code.");
                        } catch (e) {
                            m.reply("QR Read Error: " + e);
                        }
                        break;

                    case 'sticker':
                    case 's':
                        if (/image|video/.test(m.mtype) || (m.quoted && /image|video/.test(m.quoted.mtype))) {
                            const { Sticker, StickerTypes } = await import('wa-sticker-formatter');
                            let mediaSticker = await (m.quoted ? m.quoted.download() : m.download());
                            let sticker = new Sticker(mediaSticker, {
                                pack: BOT_NAME,
                                author: OWNER_NUMBER,
                                type: StickerTypes.FULL,
                                categories: [],
                                id: '12345',
                                quality: 70,
                                background: 'transparent'
                            });
                            await sock.sendMessage(from, await sticker.toMessage(), { quoted: m });
                        } else {
                            m.reply(`Reply to an image or video with ${prefix}sticker`);
                        }
                        break;

                    case 'toimg':
                        if (!m.quoted || m.quoted.mtype !== 'stickerMessage') return m.reply(`Reply to a sticker with ${prefix}toimg`);
                        let mediaToImg = await m.quoted.download();
                        await sock.sendMessage(from, { image: mediaToImg, caption: 'Done!' }, { quoted: m });
                        break;

                    case 'tagall':
                        if (!m.isGroup) return m.reply('This command is for groups only!');
                        const groupMetadataTag = await sock.groupMetadata(from);
                        const participantsTag = groupMetadataTag.participants;
                        let tagTextAll = `*TAG ALL*\n\n*Message:* ${text || 'No message'}\n\n`;
                        for (let mem of participantsTag) {
                            tagTextAll += ` @${mem.id.split('@')[0]}\n`;
                        }
                        await sock.sendMessage(from, { text: tagTextAll, mentions: participantsTag.map(a => a.id) }, { quoted: m });
                        break;

                    case 'hidetag':
                        if (!m.isGroup) return m.reply('This command is for groups only!');
                        const groupMetadataHide = await sock.groupMetadata(from);
                        await sock.sendMessage(from, { text: text || '', mentions: groupMetadataHide.participants.map(a => a.id) }, { quoted: m });
                        break;

                    case 'play':
                        if (!text) return m.reply(`Example: ${prefix}play faded`);
                        try {
                            const ytsPlay = await import('yt-search');
                            const searchPlay = await ytsPlay.default(text);
                            const videoPlay = searchPlay.videos[0];
                            if (!videoPlay) return m.reply('No results found!');
                            
                            await sock.sendMessage(from, { 
                                image: { url: videoPlay.thumbnail }, 
                                caption: `*PLAYING*\n\n*Title:* ${videoPlay.title}\n*Duration:* ${videoPlay.timestamp}\n*Author:* ${videoPlay.author.name}\n*Views:* ${videoPlay.views}\n\nDownloading audio...` 
                            }, { quoted: m });

                            const ytdl = await import('ytdl-core');
                            // Use a more robust way to get audio stream
                            const stream = ytdl.default(videoPlay.url, { 
                                filter: 'audioonly',
                                quality: 'highestaudio',
                                highWaterMark: 1 << 25 
                            });
                            
                            const chunks: any[] = [];
                            stream.on('data', (chunk) => chunks.push(chunk));
                            stream.on('error', (err) => {
                                console.log('ytdl error:', err);
                                m.reply("Download failed. YouTube might be blocking the request.");
                            });
                            stream.on('end', async () => {
                                if (chunks.length === 0) return;
                                const buffer = Buffer.concat(chunks);
                                await sock.sendMessage(from, { 
                                    audio: buffer, 
                                    mimetype: 'audio/mp4',
                                    fileName: `${videoPlay.title}.mp3`
                                }, { quoted: m });
                            });
                        } catch (e) {
                            console.log('Play error:', e);
                            m.reply("An error occurred while processing your request.");
                        }
                        break;

                    case 'antilink':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.antilink = true; saveSettings(); m.reply('Antilink enabled!'); }
                        else if (text === 'off') { settings.antilink = false; saveSettings(); m.reply('Antilink disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles anti-link protection.\n*Usage:* ${prefix}antilink on/off`);
                        break;

                    case 'welcome':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.welcome = true; saveSettings(); m.reply('Welcome messages enabled!'); }
                        else if (text === 'off') { settings.welcome = false; saveSettings(); m.reply('Welcome messages disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles group welcome messages.\n*Usage:* ${prefix}welcome on/off`);
                        break;

                    case 'goodbye':
                    case 'left':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.goodbye = true; saveSettings(); m.reply('Goodbye messages enabled!'); }
                        else if (text === 'off') { settings.goodbye = false; saveSettings(); m.reply('Goodbye messages disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles group leave messages.\n*Usage:* ${prefix}goodbye on/off`);
                        break;

                    case 'block':
                        if (!isOwner) return m.reply('Owner only!');
                        const usersBlock = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        await sock.updateBlockStatus(usersBlock, 'block');
                        m.reply('Blocked!');
                        break;

                    case 'unblock':
                        if (!isOwner) return m.reply('Owner only!');
                        const usersUnblock = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        await sock.updateBlockStatus(usersUnblock, 'unblock');
                        m.reply('Unblocked!');
                        break;

                    case 'broadcast':
                    case 'bc':
                        if (!isOwner) return m.reply('Owner only!');
                        if (!text) return m.reply('Text required!');
                        const chatsBc = await sock.groupFetchAllParticipating();
                        const groupsBc = Object.values(chatsBc).map(v => v.id);
                        for (let id of groupsBc) {
                            await sock.sendMessage(id, { text: `*BROADCAST*\n\n${text}` });
                        }
                        m.reply(`Sent to ${groupsBc.length} groups.`);
                        break;

                    case 'vcf':
                        try {
                            if (m.isGroup && (!m.quoted || m.quoted.mtype !== 'documentMessage')) {
                                const groupMetadataVcf = await sock.groupMetadata(from);
                                const participantsVcf = groupMetadataVcf.participants;
                                let vcfData = '';
                                for (let i = 0; i < participantsVcf.length; i++) {
                                    const jid = participantsVcf[i].id;
                                    const number = jid.split('@')[0];
                                    vcfData += `BEGIN:VCARD\nVERSION:3.0\nFN:Group Member ${i + 1}\nTEL;type=CELL;type=VOICE;waid=${number}:+${number}\nEND:VCARD\n`;
                                }
                                const vcfPath = `./${groupMetadataVcf.subject.replace(/[^a-zA-Z0-9]/g, '_')}.vcf`;
                                await fs.writeFile(vcfPath, vcfData);
                                await sock.sendMessage(from, { 
                                    document: await fs.readFile(vcfPath), 
                                    mimetype: 'text/vcard', 
                                    fileName: `${groupMetadataVcf.subject}.vcf` 
                                }, { quoted: m });
                                await fs.unlink(vcfPath);
                            } else if (m.quoted && m.quoted.mtype === 'documentMessage') {
                                let vcfBuffer = await m.quoted.download();
                                let vcfText = vcfBuffer.toString();
                                let numbers = vcfText.match(/TEL;[^:]*:([^\n]*)/g)?.map(n => n.split(':')[1].replace(/[^0-9]/g, '')) || [];
                                if (numbers.length === 0) return m.reply('No numbers found in VCF!');
                                m.reply(`Extracted ${numbers.length} numbers. Saving contacts...`);
                                m.reply(`Numbers: ${numbers.join(', ')}`);
                            } else {
                                m.reply(`Use ${prefix}vcf in a group to get all members' contacts, or reply to a VCF file to extract numbers.`);
                            }
                        } catch (e) {
                            m.reply("VCF Error: " + e);
                        }
                        break;
                }
            }

            // Anti-link logic
            if (settings.antilink && m.isGroup && body.match(/chat\.whatsapp\.com/gi) && !isAdmin) {
                try {
                    await sock.sendMessage(from, { delete: m.key });
                    await sock.sendMessage(from, { text: `*ANTI-LINK DETECTED*\n\n@${sender.split('@')[0]} has been warned. Links are not allowed!`, mentions: [sender] });
                } catch (e) {
                    console.log("[DEBUG] Anti-link error:", e);
                }
            }

            // Anti-spam logic
            if (settings.antispam && !isAdmin && !m.key.fromMe) {
                const now = Date.now();
                if (!spamTracker[sender]) spamTracker[sender] = { count: 0, lastMessageTime: now };
                
                if (now - spamTracker[sender].lastMessageTime < 2000) { // 2 seconds window
                    spamTracker[sender].count++;
                    if (spamTracker[sender].count >= 5) { // 5 messages in 2 seconds
                        try {
                            await sock.sendMessage(from, { text: `*ANTI-SPAM DETECTED*\n\n@${sender.split('@')[0]} please stop spamming!`, mentions: [sender] });
                            spamTracker[sender].count = 0; // Reset after warning
                        } catch (e) {}
                    }
                } else {
                    spamTracker[sender].count = 1;
                }
                spamTracker[sender].lastMessageTime = now;
            }

            // Anti-mention logic
            if (settings.antimention && m.mentionedJid && m.mentionedJid.length > 0 && !isAdmin && !m.key.fromMe) {
                try {
                    await sock.sendMessage(from, { delete: m.key });
                    await sock.sendMessage(from, { text: `*ANTI-MENTION DETECTED*\n\n@${sender.split('@')[0]} mentions are disabled!`, mentions: [sender] });
                } catch (e) {}
            }

            // Anti-tag logic (tagall/hidetag)
            if (settings.antitag && m.mentionedJid && m.mentionedJid.length > 10 && !isAdmin && !m.key.fromMe) {
                try {
                    await sock.sendMessage(from, { delete: m.key });
                    await sock.sendMessage(from, { text: `*ANTI-TAG DETECTED*\n\n@${sender.split('@')[0]} mass tagging is disabled!`, mentions: [sender] });
                } catch (e) {}
            }
        } catch (err) {
            console.log(chalk.red(`Error in message handler: ${err}`));
        }
    });































    return sock;
}

// Helper function to format messages
function smsg(conn: any, m: any, store: any) {
    if (!m) return m;
    let M = m.message;
    if (m.key) {
        m.id = m.key.id;
        m.isBaileys = m.id.startsWith('BAE5') && m.id.length === 16;
        m.chat = m.key.remoteJid;
        m.fromMe = m.key.fromMe;
        m.isGroup = m.chat.endsWith('@g.us');
        
        const botId = conn.user?.id ? (conn.user.id.split(':')[0] + '@s.whatsapp.net') : 'unknown';
        m.sender = m.fromMe ? botId : (m.key.participant || m.key.remoteJid);
    }
    if (m.message) {
        m.mtype = getContentType(M);
        m.msg = (m.mtype == 'viewOnceMessage' ? M.viewOnceMessage.message[getContentType(M.viewOnceMessage.message)] : M[m.mtype]);
        
        // Robust body extraction
        m.body = m.message.conversation || 
                 m.msg?.caption || 
                 m.msg?.text || 
                 (m.mtype == 'listResponseMessage' && m.msg.singleSelectReply.selectedRowId) || 
                 (m.mtype == 'buttonsResponseMessage' && m.msg.selectedButtonId) || 
                 (m.mtype == 'viewOnceMessage' && m.msg.caption) || 
                 m.text;

        let quoted = m.quoted = m.msg?.contextInfo ? m.msg.contextInfo.quotedMessage : null;
        m.mentionedJid = m.msg?.contextInfo?.mentionedJid || [];
        if (m.quoted) {
            let type = getContentType(quoted);
            m.quoted = quoted[type];
            if (['productMessage'].includes(type)) {
                type = getContentType(m.quoted);
                m.quoted = m.quoted[type];
            }
            if (typeof m.quoted === 'string') m.quoted = { text: m.quoted };
            m.quoted.mtype = type;
            m.quoted.id = m.msg.contextInfo.stanzaId;
            m.quoted.chat = m.msg.contextInfo.remoteJid || m.chat;
            m.quoted.isBaileys = m.quoted.id ? m.quoted.id.startsWith('BAE5') && m.quoted.id.length === 16 : false;
            const decoded = m.msg.contextInfo.participant ? jidDecode(m.msg.contextInfo.participant) : null;
            m.quoted.sender = decoded?.user ? (decoded.user + '@s.whatsapp.net') : (m.msg.contextInfo.participant || m.chat);
            m.quoted.fromMe = m.quoted.sender === (conn.user && conn.user.id);
            m.quoted.text = m.quoted.text || m.quoted.caption || m.quoted.conversation || m.quoted.contentText || m.quoted.selectedDisplayText || m.quoted.title || '';
            m.quoted.mentionedJid = m.msg.contextInfo?.mentionedJid || [];
            m.getQuotedObj = m.getQuotedMessage = async () => {
                if (!m.quoted.id) return false;
                let q = await store.loadMessage(m.chat, m.quoted.id, conn);
                return smsg(conn, q, store);
            };
            let vM = m.quoted.fakeObj = m.msg.contextInfo.quotedMessage;
            m.quoted.delete = () => conn.sendMessage(m.chat, { delete: vM.key });
            m.quoted.copyNForward = (jid: string, forceForward = false, options = {}) => conn.copyNForward(jid, vM, forceForward, options);
            m.quoted.download = () => downloadMedia(m.quoted);
        }
    }
    if (m.msg?.url) m.download = () => downloadMedia(m.msg);
    m.text = m.msg?.text || m.msg?.caption || m.message?.conversation || m.msg?.contentText || m.msg?.selectedDisplayText || m.msg?.title || '';
    
    // Fallback if body is still empty
    if (!m.body) m.body = m.text;

    m.reply = (text: string, chatId = m.chat, options = {}) => conn.sendMessage(chatId, { text: text, ...options }, { quoted: m });
    m.copy = () => smsg(conn, m, store);
    m.copyNForward = (jid = m.chat, forceForward = false, options = {}) => conn.copyNForward(jid, m, forceForward, options);

    return m;
}

async function downloadMedia(message: any) {
    let type = Object.keys(message)[0];
    let msg = message[type];
    if (type === 'buttonsMessage' || type === 'viewOnceMessage' || type === 'ephemeralMessage') {
        if (type === 'viewOnceMessage') {
            msg = message.viewOnceMessage.message;
            type = Object.keys(msg)[0];
        } else if (type === 'ephemeralMessage') {
            msg = message.ephemeralMessage.message;
            type = Object.keys(msg)[0];
        } else {
            msg = message.buttonsMessage.imageMessage || message.buttonsMessage.videoMessage;
            type = Object.keys(msg)[0];
        }
    }
    const stream = await downloadContentFromMessage(msg, type.replace('Message', '') as any);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}

// Runtime helper
function runtime(seconds: number) {
	seconds = Number(seconds);
	var d = Math.floor(seconds / (3600 * 24));
	var h = Math.floor(seconds % (3600 * 24) / 3600);
	var m = Math.floor(seconds % 3600 / 60);
	var s = Math.floor(seconds % 60);
	var dDisplay = d > 0 ? d + (d == 1 ? " day, " : " days, ") : "";
	var hDisplay = h > 0 ? h + (h == 1 ? " hour, " : " hours, ") : "";
	var mDisplay = m > 0 ? m + (m == 1 ? " minute, " : " minutes, ") : "";
	var sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : "";
	return dDisplay + hDisplay + mDisplay + sDisplay;
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(chalk.green(`Server running on port ${PORT}`));
    
    // Self-ping to prevent Railway/Render from sleeping
    setInterval(() => {
        const pingUrl = process.env.RAILWAY_STATIC_URL 
            ? `https://${process.env.RAILWAY_STATIC_URL}/health` 
            : `http://localhost:${PORT}/health`;
        axios.get(pingUrl).catch(() => {});
    }, 5 * 60 * 1000); // Every 5 minutes

    // Only start if session exists, otherwise wait for web UI
    if (fs.existsSync('./session/creds.json')) {
        console.log(chalk.blue('Session found, starting bot...'));
        startBot();
    } else {
        console.log(chalk.yellow('No session found, waiting for web UI pairing...'));
    }
});
