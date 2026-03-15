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
import * as menuCommands from './commands/menu';
import * as generalCommands from './commands/general';
import * as groupCommands from './commands/group';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const OWNER_NUMBER = process.env.OWNER_NUMBER || '254700000000';
const BOT_NAME = process.env.BOT_NAME || 'TECHWIZARD';
let PREFIX = process.env.PREFIX || '.';

// Bot Settings State
const botSettings: { [phone: string]: any } = {};

function getSettings(phone: string) {
    if (botSettings[phone]) return botSettings[phone];
    
    const defaultSettings = {
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
        autoviewstatus: false,
        autoapprove: false,
        menuImage: '',
        admins: [OWNER_NUMBER.split('@')[0]]
    };

    const settingsFile = `./sessions/${phone}/settings.json`;
    if (fs.existsSync(settingsFile)) {
        try {
            const saved = fs.readJsonSync(settingsFile);
            botSettings[phone] = { ...defaultSettings, ...saved };
            return botSettings[phone];
        } catch (e) {}
    }
    
    botSettings[phone] = defaultSettings;
    return defaultSettings;
}

function saveSettings(phone: string) {
    try {
        const settingsFile = `./sessions/${phone}/settings.json`;
        fs.ensureDirSync(path.dirname(settingsFile));
        fs.writeJsonSync(settingsFile, botSettings[phone], { spaces: 4 });
    } catch (e) {
        console.log(chalk.red(`Error saving settings for ${phone}:`, e));
    }
}

// Spam Tracker
const spamTracker: { [user: string]: { count: number, lastMessageTime: number } } = {};

const groupSchedules: { [phone: string]: { [jid: string]: { open?: NodeJS.Timeout, close?: NodeJS.Timeout } } } = {};

const msgRetryCounterCache = new NodeCache();
const store = {
    bind: (ev: any) => {},
    loadMessage: async (chat: string, id: string, conn: any) => null
};

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Global error handlers to prevent bot from crashing/sleeping
process.on('uncaughtException', (err) => {
    console.error('Caught exception:', err);
    process.exit(1); // Restart process
});
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
    process.exit(1); // Restart process
});

const pairingCodes: { [phone: string]: string } = {};
const pairingStates: { [phone: string]: boolean } = {};
const botSocks: { [phone: string]: any } = {};
let onlineInterval: any = null;
const ignoredMessageIds = new Set<string>();
const massAddingGroups = new Set<string>();
const viewOnceCache = new Map<string, { data: Buffer, mimetype: string }>();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/connect', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });

    const targetNumber = phoneNumber.replace(/[^0-9]/g, '');
    
    if (!pairingStates[targetNumber]) {
        // Only stop and delete if the bot is ALREADY registered
        if (botSocks[targetNumber]?.authState?.creds?.registered) {
            if (botSocks[targetNumber]) {
                try {
                    botSocks[targetNumber].ev.removeAllListeners();
                    botSocks[targetNumber].end(undefined);
                    delete botSocks[targetNumber];
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (e) {}
            }

            // Clear session for fresh pairing
            const sessionPath = path.join('sessions', targetNumber);
            if (fs.existsSync(sessionPath)) {
                try { fs.emptyDirSync(sessionPath); fs.removeSync(sessionPath); } catch (e) {}
            }
        }

        pairingCodes[targetNumber] = "";
        pairingStates[targetNumber] = true;
        (async () => {
            try {
                await startBot(targetNumber, true);
            } catch (err) {
                console.log('Pairing error:', err);
                pairingStates[targetNumber] = false;
            }
        })();
    }

    let retries = 0;
    const checkCode = setInterval(() => {
        if (pairingCodes[targetNumber]) {
            clearInterval(checkCode);
            res.json({ code: pairingCodes[targetNumber] });
        } else if (retries > 60) {
            clearInterval(checkCode);
            pairingStates[targetNumber] = false;
            res.status(500).json({ error: 'Failed to generate pairing code' });
        }
        retries++;
    }, 1000);
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/', async (req, res) => {
    const numberParam = req.query.number as string;
    
    if (numberParam) {
        const targetNumber = numberParam.replace(/[^0-9]/g, '');
        if (!targetNumber) return res.status(400).send('Invalid number');

        if (!pairingStates[targetNumber]) {
            // Only stop and delete if the bot is ALREADY registered
            if (botSocks[targetNumber]?.authState?.creds?.registered) {
                if (botSocks[targetNumber]) {
                    try {
                        botSocks[targetNumber].ev.removeAllListeners();
                        botSocks[targetNumber].end(undefined);
                        delete botSocks[targetNumber];
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (e) {}
                }

                // Clear session for fresh pairing
                const sessionPath = path.join('sessions', targetNumber);
                if (fs.existsSync(sessionPath)) {
                    try { fs.emptyDirSync(sessionPath); fs.removeSync(sessionPath); } catch (e) {}
                }
            }

            pairingCodes[targetNumber] = "";
            pairingStates[targetNumber] = true;
            (async () => {
                try {
                    await startBot(targetNumber, true);
                } catch (err) {
                    console.log('Pairing error:', err);
                    pairingStates[targetNumber] = false;
                }
            })();
        }

        (async () => {
            let retries = 0;
            const checkCode = setInterval(() => {
                if (pairingCodes[targetNumber]) {
                    clearInterval(checkCode);
                    res.send(pairingCodes[targetNumber]);
                } else if (retries > 60) {
                    clearInterval(checkCode);
                    pairingStates[targetNumber] = false;
                    res.status(500).send('Timeout generating code');
                }
                retries++;
            }, 1000);
        })();
    } else {
        const activeSessions = Object.keys(botSocks).filter(num => botSocks[num]?.authState?.creds?.registered);
        const isConnected = activeSessions.length > 0;
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
                            ${isConnected ? '● ' + activeSessions.length + ' ACTIVE' : '○ OFFLINE'}
                        </p>
                        ${activeSessions.length > 0 ? `
                            <div class="mt-2 text-xs text-green-400/60">
                                ${activeSessions.map(num => `<div>+${num}</div>`).join('')}
                            </div>
                        ` : ''}
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
    
    const targetNumber = phone.replace(/[^0-9]/g, '');
    
    // Allow re-pairing if not registered, even if pairingStates is true
    if (pairingStates[targetNumber] && (!botSocks[targetNumber] || !botSocks[targetNumber].authState?.creds?.registered)) {
        pairingStates[targetNumber] = false;
    }
    
    if (!pairingStates[targetNumber]) {
        // Only stop and delete if the bot is ALREADY registered
        if (botSocks[targetNumber]?.authState?.creds?.registered) {
            if (botSocks[targetNumber]) {
                try {
                    botSocks[targetNumber].ev.removeAllListeners();
                    botSocks[targetNumber].end(undefined);
                    delete botSocks[targetNumber];
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (e) {}
            }

            // Clear session for fresh pairing
            const sessionPath = path.join('sessions', targetNumber);
            if (fs.existsSync(sessionPath)) {
                try { fs.emptyDirSync(sessionPath); fs.removeSync(sessionPath); } catch (e) {}
            }
        }

        pairingCodes[targetNumber] = "";
        pairingStates[targetNumber] = true;
        
        // Start bot in background
        (async () => {
            try {
                await startBot(targetNumber, true);
            } catch (err) {
                console.log('Pairing error:', err);
                pairingStates[targetNumber] = false;
            }
        })();
    }
    
    // Send response immediately to avoid "Initializing..." hang
    res.json({ status: 'success' });
});

app.post('/api/reset', async (req, res) => {
    const { phone } = req.body;
    try {
        if (phone) {
            const targetNumber = phone.replace(/[^0-9]/g, '');
            if (botSocks[targetNumber]) {
                botSocks[targetNumber].ev.removeAllListeners();
                botSocks[targetNumber].end(undefined);
                delete botSocks[targetNumber];
            }
            const sessionPath = path.join('sessions', targetNumber);
            if (fs.existsSync(sessionPath)) {
                fs.emptyDirSync(sessionPath);
                fs.removeSync(sessionPath);
            }
            res.json({ status: 'success', message: `Bot for +${targetNumber} reset successfully.` });
        } else {
            // Reset all
            for (const num in botSocks) {
                botSocks[num].ev.removeAllListeners();
                botSocks[num].end(undefined);
            }
            if (fs.existsSync('sessions')) {
                fs.emptyDirSync('sessions');
            }
            res.json({ status: 'success', message: 'All bots reset successfully.' });
            process.exit(0);
        }
    } catch (e) {
        res.status(500).json({ status: 'error', message: String(e) });
    }
});

app.get('/api/status', (req, res) => {
    const { phone } = req.query;
    if (phone) {
        const targetNumber = (phone as string).replace(/[^0-9]/g, '');
        res.json({ 
            code: pairingCodes[targetNumber] || "", 
            connected: botSocks[targetNumber]?.authState?.creds?.registered || false 
        });
    } else {
        const activeSessions = Object.keys(botSocks).filter(num => botSocks[num]?.authState?.creds?.registered);
        res.json({ 
            connected: activeSessions.length > 0,
            activeSessions
        });
    }
});

async function startBot(phoneNumber?: string, isNewPairing = false) {
    if (!phoneNumber) {
        // Migration check: if old session exists, move it
        if (fs.existsSync('./session/creds.json')) {
            try {
                const creds = fs.readJsonSync('./session/creds.json');
                const myNumber = creds.me.id.split(':')[0];
                const newPath = path.join('sessions', myNumber);
                fs.ensureDirSync(newPath);
                fs.moveSync('./session', newPath, { overwrite: true });
                console.log(`Migrated old session to sessions/${myNumber}`);
                return startBot(myNumber);
            } catch (e) {
                console.log('Migration failed:', e);
            }
        }
        return;
    }

    const sessionPath = path.join('sessions', phoneNumber);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const settings = getSettings(phoneNumber);
    const botRetryCache = new NodeCache();
    const botSpamTracker: { [user: string]: { count: number, lastMessageTime: number } } = {};
    const botIgnoredMessageIds = new Set<string>();
    const botMassAddingGroups = new Set<string>();
    
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
        browser: ["Chrome", "Chrome", "124.0.6367.207"],
        msgRetryCounterCache: botRetryCache,
        generateHighQualityLinkPreview: true,
        keepAliveIntervalMs: 30000,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        retryRequestDelayMs: 5000,
        defaultQueryTimeoutMs: 120000,
        connectTimeoutMs: 120000,
    });

    botSocks[phoneNumber] = sock;
    store.bind(sock.ev);

    // Pairing Code Logic
    if (!sock.authState.creds.registered && phoneNumber) {
        console.log(chalk.yellow(`[!] Waiting for connection to be open to request Pairing Code for ${phoneNumber}...`));
        
        const waitForOpen = (update: any) => {
            if (update.connection === 'open') {
                sock.ev.off('connection.update', waitForOpen);
                setTimeout(async () => {
                    try {
                        let code = await sock.requestPairingCode(phoneNumber);
                        pairingCodes[phoneNumber] = code?.match(/.{1,4}/g)?.join("-") || code;
                        console.log(chalk.black.bgGreen(`\n--- PAIRING CODE FOR ${phoneNumber}: ${pairingCodes[phoneNumber]} ---\n`));
                    } catch (err) {
                        console.log(chalk.red(`Error requesting pairing code for ${phoneNumber}: ${err}`));
                        console.log(chalk.red(`Error stack: ${(err as any).stack}`));
                        pairingStates[phoneNumber] = false;
                    }
                }, 2000);
            }
        };
        sock.ev.on('connection.update', waitForOpen);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        console.log(chalk.blue(`[DEBUG] Connection update: ${JSON.stringify(update)}`));
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(chalk.yellow(`[!] Connection closed for ${phoneNumber}. Reconnecting: ${shouldReconnect}`));
            if (shouldReconnect) {
                setTimeout(async () => {
                    await startBot(phoneNumber, isNewPairing);
                }, 5000); // 5s delay to prevent loops
            } else {
                pairingStates[phoneNumber] = false;
                delete botSocks[phoneNumber];
                console.log(chalk.red(`[!] Logged out for ${phoneNumber}. Please pair again.`));
            }
        } else if (connection === 'open') {
            console.log(chalk.green(`\n[+] ${BOT_NAME} CONNECTED SUCCESSFULLY FOR ${phoneNumber}!\n`));
            pairingStates[phoneNumber] = false;

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
┃ ${PREFIX}deploybot / deploy
┃ ${PREFIX}afk
┃ ${PREFIX}reminder
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 🤖 AI SYSTEM 〕━━┈⊷
┃ ${PREFIX}autoreply on/off
┃ ${PREFIX}chatbot on/off
┃ ${PREFIX}resetai
┃ ${PREFIX}ai / ask / chatgpt
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 👑 OWNER COMMANDS 〕━━┈⊷
┃ ${PREFIX}admin
┃ ${PREFIX}addadmin
┃ ${PREFIX}removeadmin
┃ ${PREFIX}broadcast / bc
┃ ${PREFIX}setprefix
┃ ${PREFIX}setmenuimage
┃ ${PREFIX}shutdown
┃ ${PREFIX}userjoin
┃ ${PREFIX}join / autojoin
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 ⚙️ AUTO SYSTEM 〕━━┈⊷
┃ ${PREFIX}autoread on/off
┃ ${PREFIX}autotyping on/off
┃ ${PREFIX}autorecording on/off
┃ ${PREFIX}autoreact on/off
┃ ${PREFIX}autoadd on/off
┃ ${PREFIX}autoapprove on/off
┃ ${PREFIX}alwaysonline on/off
┃ ${PREFIX}autoviewstatus on/off
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 👥 GROUP COMMANDS 〕━━┈⊷
┃ ${PREFIX}add
┃ ${PREFIX}kick
┃ ${PREFIX}promote
┃ ${PREFIX}demote
┃ ${PREFIX}tagall
┃ ${PREFIX}hidetag
┃ ${PREFIX}addall
┃ ${PREFIX}stopadd
┃ ${PREFIX}linkgc
┃ ${PREFIX}leave
┃ ${PREFIX}mute / closegroup
┃ ${PREFIX}unmute / opengroup
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
┃ ${PREFIX}vv / viewonce
┃ ${PREFIX}sticker / s
┃ ${PREFIX}toimg
┃ ${PREFIX}play
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
        console.log(`[DEBUG] Group Participants Update for ${phoneNumber}: ${anu.id} Action: ${anu.action}`);
        try {
            if (botMassAddingGroups.has(anu.id)) return; // Skip if mass adding (silent mode)
            
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

            // Auto-approve join requests
            if ((anu.action as string) === 'request' && settings.autoapprove) {
                try {
                    const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    const botIsAdmin = metadata.participants.find(p => p.id === botId)?.admin;
                    if (botIsAdmin) {
                        const participantsToApprove = anu.participants.map(p => typeof p === 'string' ? p : (p as any).id);
                        await sock.groupParticipantsUpdate(anu.id, participantsToApprove, 'approve' as any);
                        console.log(`[AUTO-APPROVE] Approved ${participantsToApprove.length} requests in ${anu.id}`);
                    }
                } catch (e) {
                    console.log(`[AUTO-APPROVE] Error:`, e);
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
            if (mek.message && (getContentType(mek.message) === 'viewOnceMessage' || getContentType(mek.message) === 'viewOnceMessageV2')) {
                const vType = getContentType(mek.message);
                mek.message = mek.message[vType].message;
                
                // Cache view-once media
                try {
                    const media = await downloadMedia(mek.message);
                    if (media) {
                        const mimetype = mek.message.imageMessage?.mimetype || mek.message.videoMessage?.mimetype;
                        viewOnceCache.set(mek.key.id, { data: media, mimetype });
                        // Clear cache after 1 hour
                        setTimeout(() => viewOnceCache.delete(mek.key.id), 3600000);
                    }
                } catch (e) {
                    console.log("[DEBUG] View-once cache error:", e);
                }
            }
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                if (settings.autoviewstatus) {
                    try {
                        await sock.readMessages([mek.key]);
                        const participant = mek.key.participant || '';
                        if (participant.includes(OWNER_NUMBER)) {
                            console.log(`[AUTO-VIEW] Automatically viewed status from OWNER: ${participant}`);
                        } else {
                            console.log(`[AUTO-VIEW] Viewed status from ${participant || mek.key.remoteJid}`);
                        }
                    } catch (e) {
                        console.log("[DEBUG] Failed to view status:", e);
                    }
                }
                return;
            }
            
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
            const isSessionOwner = (senderNumber === phoneNumber) || isOwner;
            const isAdmin = settings.admins.includes(senderNumber) || isSessionOwner;

            console.log(`[DEBUG] isCmd=${isCmd}, command=${command}, sender=${sender}`);

            // Typing/Recording simulation
            if (settings.autotyping) await sock.sendPresenceUpdate('composing', from);
            if (settings.autorecording) await sock.sendPresenceUpdate('recording', from);

            // Chatbot Logic
            if (!isCmd && settings.chatbot && !m.key.fromMe && !m.isBaileys && sock.user?.id && m.sender !== sock.user.id && !m.sender.startsWith(sock.user.id.split(':')[0])) {
                if (m.isGroup) {
                    const botNumber = sock.user.id.split(':')[0];
                    const isMentioned = m.mentionedJid.some((jid: string) => jid.startsWith(botNumber));
                    const isReplyToBot = m.quoted && m.quoted.sender && m.quoted.sender.startsWith(botNumber);
                    if (!isMentioned && !isReplyToBot) return;
                }
                try {
                    await sock.sendPresenceUpdate('composing', from);
                    const reply = await getAIReply(from, body || m.text);
                    await m.reply(reply);
                } catch (e) {
                    console.log("Chatbot error:", e);
                }
            }

            // Auto Reply (Simple Away Message)
            if (!isCmd && settings.autoreply && !settings.chatbot && !m.key.fromMe && !m.isGroup) {
                try {
                    await m.reply("Hello! I am an automated bot. The owner is currently unavailable.");
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
            if (settings.autoreact && m.mtype !== 'reactionMessage') {
                // Only react if it's NOT a command OR if it IS a command with prefix
                // The user said "not inly commands" but also "let not one controll my bot without the exat prefix"
                // This implies they want the bot to ignore non-prefixed command-like words.
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
                        await menuCommands.menu(m, sock, text, from, sender, prefix, settings, phoneNumber, BOT_NAME, runtime);
                        break;
                    }

                    case 'speed':
                    case 'ping': {
                        await generalCommands.speed(m, sock, text, from, sender, prefix, settings, phoneNumber, BOT_NAME, runtime);
                        break;
                    }

                    case 'alive':
                        await generalCommands.alive(m, sock, text, from, sender, prefix, settings, phoneNumber, BOT_NAME, runtime);
                        break;

                    case 'owner':
                        await generalCommands.owner(m, sock, text, from, sender, prefix, settings, phoneNumber, BOT_NAME, runtime);
                        break;

                    case 'runtime':
                        await generalCommands.runtimeCmd(m, sock, text, from, sender, prefix, settings, phoneNumber, BOT_NAME, runtime);
                        break;

                    case 'id':
                        await generalCommands.id(m, sock, text, from, sender, prefix, settings, phoneNumber, BOT_NAME, runtime);
                        break;

                    case 'afk':
                        await generalCommands.afk(m, sock, text, from, sender, prefix, settings, phoneNumber, BOT_NAME, runtime);
                        break;

                    case 'reminder':
                        await generalCommands.reminder(m, sock, text, from, sender, prefix, settings, phoneNumber, BOT_NAME, runtime);
                        break;

                    case 'autoreply':
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        if (text === 'on') { settings.autoreply = true; saveSettings(phoneNumber); m.reply('Autoreply enabled!'); }
                        else if (text === 'off') { settings.autoreply = false; saveSettings(phoneNumber); m.reply('Autoreply disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles automated replies.\n*Usage:* ${prefix}autoreply on/off`);
                        break;

                    case 'chatbot':
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        if (text === 'on') { settings.chatbot = true; saveSettings(phoneNumber); m.reply('Chatbot enabled!'); }
                        else if (text === 'off') { settings.chatbot = false; saveSettings(phoneNumber); m.reply('Chatbot disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles AI chatbot for all messages.\n*Usage:* ${prefix}chatbot on/off`);
                        break;

                    case 'resetai':
                        resetAI(from);
                        m.reply('AI Context reset!');
                        break;

                    case 'admin':
                        if (!isOwner) return m.reply('Owner only!');
                        m.reply(`*ADMINS list:* \n\n${settings.admins.map(a => `@${a}`).join('\n')}`);
                        break;

                    case 'addadmin':
                        if (!isOwner) return m.reply('Owner only!');
                        const newAdmin = m.mentionedJid[0] ? m.mentionedJid[0].split('@')[0] : text.replace(/[^0-9]/g, '');
                        if (!newAdmin) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Adds a user to the bot admin list.\n*Usage:* ${prefix}addadmin <tag/number>\n*Example:* ${prefix}addadmin @user`);
                        if (settings.admins.includes(newAdmin)) return m.reply('Already admin!');
                        settings.admins.push(newAdmin);
                        saveSettings(phoneNumber);
                        m.reply(`@${newAdmin} is now an admin!`);
                        break;

                    case 'removeadmin':
                        if (!isOwner) return m.reply('Owner only!');
                        const remAdmin = m.mentionedJid[0] ? m.mentionedJid[0].split('@')[0] : text.replace(/[^0-9]/g, '');
                        if (!remAdmin) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Removes a user from the bot admin list.\n*Usage:* ${prefix}removeadmin <tag/number>\n*Example:* ${prefix}removeadmin @user`);
                        if (remAdmin === OWNER_NUMBER.split('@')[0]) return m.reply('Cannot remove the main owner!');
                        settings.admins = settings.admins.filter(a => a !== remAdmin);
                        saveSettings(phoneNumber);
                        m.reply(`@${remAdmin} removed from admins!`);
                        break;

                    case 'setprefix':
                        if (!isOwner) return m.reply('Owner only!');
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Changes the bot command prefix.\n*Usage:* ${prefix}setprefix <symbol>\n*Example:* ${prefix}setprefix !`);
                        PREFIX = text;
                        m.reply(`Prefix changed to: ${PREFIX}`);
                        break;

                    case 'setmenuimage':
                        if (!isOwner) return m.reply('Owner only!');
                        if (!m.quoted || m.quoted.mtype !== 'imageMessage') return m.reply(`Reply to an image with ${prefix}setmenuimage to change the menu header.`);
                        try {
                            const media = await m.quoted.download();
                            const imagePath = `./sessions/${phoneNumber}/menu_image.jpg`;
                            fs.ensureDirSync(path.dirname(imagePath));
                            await fs.writeFile(imagePath, media);
                            settings.menuImage = imagePath;
                            saveSettings(phoneNumber);
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
                        if (!isOwner) return m.reply('Owner only!');
                        if (!text) return m.reply(`*⚠️ MISSING LINK*\n\n*Usage:* ${prefix}userjoin <group_link>`);
                        const joinInviteCode = text.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/)?.[1];
                        if (!joinInviteCode) return m.reply('Invalid WhatsApp group link!');
                        
                        const botNumbers = Object.keys(botSocks);
                        m.reply(`🚀 Attempting to join ${botNumbers.length} bots to the group...`);
                        
                        let joinSuccess = 0;
                        let joinFail = 0;
                        
                        for (const num of botNumbers) {
                            try {
                                const botSock = botSocks[num];
                                if (botSock) {
                                    await botSock.groupAcceptInvite(joinInviteCode);
                                    joinSuccess++;
                                }
                            } catch (e) {
                                joinFail++;
                            }
                        }
                        m.reply(`✅ *USERJOIN COMPLETE*\n\nSuccess: ${joinSuccess}\nFailed: ${joinFail}`);
                        break;

                    case 'autoread':
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        if (text === 'on') { settings.autoread = true; saveSettings(phoneNumber); m.reply('Autoread enabled!'); }
                        else if (text === 'off') { settings.autoread = false; saveSettings(phoneNumber); m.reply('Autoread disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles auto-reading of messages.\n*Usage:* ${prefix}autoread on/off`);
                        break;

                    case 'autotyping':
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        if (text === 'on') { settings.autotyping = true; saveSettings(phoneNumber); m.reply('Autotyping enabled!'); }
                        else if (text === 'off') { settings.autotyping = false; saveSettings(phoneNumber); m.reply('Autotyping disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles "typing..." status simulation.\n*Usage:* ${prefix}autotyping on/off`);
                        break;

                    case 'autorecording':
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        if (text === 'on') { settings.autorecording = true; saveSettings(phoneNumber); m.reply('Autorecording enabled!'); }
                        else if (text === 'off') { settings.autorecording = false; saveSettings(phoneNumber); m.reply('Autorecording disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles "recording..." status simulation.\n*Usage:* ${prefix}autorecording on/off`);
                        break;

                    case 'autoreact':
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        if (text === 'on') { settings.autoreact = true; saveSettings(phoneNumber); m.reply('Autoreact enabled!'); }
                        else if (text === 'off') { settings.autoreact = false; saveSettings(phoneNumber); m.reply('Autoreact disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles auto-reactions to messages.\n*Usage:* ${prefix}autoreact on/off`);
                        break;

                    case 'autoadd': {
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        
                        if (text === 'off') {
                            settings.autoadd = false;
                            saveSettings(phoneNumber);
                            if (massAddingGroups.has(from)) {
                                massAddingGroups.delete(from);
                                m.reply('Autoadd disabled and ongoing mass add stopped!');
                            } else {
                                m.reply('Autoadd disabled!');
                            }
                            break;
                        }

                        // Check if it's a VCF reply for mass adding
                        if (text.startsWith('on') && m.quoted) {
                            try {
                                let targetGroup = from;
                                const groupLinkMatch = text.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/);
                                
                                if (!m.isGroup && !groupLinkMatch) {
                                    return m.reply('Please provide a group link when using this command in private chat.\nExample: .autoadd on https://chat.whatsapp.com/xxx');
                                }

                                if (groupLinkMatch) {
                                    const code = groupLinkMatch[1];
                                    try {
                                        const info = await sock.groupGetInviteInfo(code);
                                        targetGroup = info.id;
                                    } catch (e) {
                                        return m.reply('Invalid group link or bot is not in the group.');
                                    }
                                }

                                const vcfBuffer = await m.quoted.download();
                                const vcfText = vcfBuffer.toString();
                                // More robust VCF number extraction
                                let participantsToAdd = vcfText.match(/TEL(?:;[^:]*)?:([^\n\r]*)/gi)?.map(n => {
                                    const num = n.split(':')[1].replace(/[^0-9]/g, '');
                                    return num.length > 5 ? num + '@s.whatsapp.net' : null;
                                }).filter(Boolean) as string[] || [];
                                
                                participantsToAdd = [...new Set(participantsToAdd)];
                                
                                if (participantsToAdd.length === 0) {
                                    // If it's not a VCF file but just a quoted message, maybe it's just a toggle
                                    if (text === 'on') {
                                        settings.autoadd = true;
                                        saveSettings(phoneNumber);
                                        return m.reply('Autoadd enabled! (No contacts found in reply)');
                                    }
                                    return m.reply('No valid numbers found in the replied message!');
                                }
                                
                                const botNumbers = Object.keys(botSocks);
                                m.reply(`🚀 *SAFE MULTI-BOT MASS ADD*\n\nTarget Group: ${targetGroup}\nFound ${participantsToAdd.length} numbers.\nUsing ${botNumbers.length} bots.\nSafety Delay: 3-7s per add.\nThis process is silent.\nType ${prefix}autoadd off to stop.`);
                                
                                massAddingGroups.add(from);
                                let successCount = 0;
                                let failCount = 0;
                                
                                try {
                                    // Distribute work among bots
                                    for (let i = 0; i < participantsToAdd.length; i++) {
                                        if (!massAddingGroups.has(from)) {
                                            m.reply('🛑 Mass add stopped by user.');
                                            return;
                                        }
                                        const jid = participantsToAdd[i];
                                        const botIndex = i % botNumbers.length;
                                        const botSock = botSocks[botNumbers[botIndex]];
                                        
                                        if (botSock) {
                                            try {
                                                await botSock.groupParticipantsUpdate(targetGroup, [jid], 'add');
                                                successCount++;
                                            } catch (e) {
                                                failCount++;
                                            }
                                        }
                                        // Safe delay to avoid bans (3-7 seconds)
                                        const delay = Math.floor(Math.random() * 4000) + 3000;
                                        await new Promise(resolve => setTimeout(resolve, delay));
                                    }
                                } finally {
                                    massAddingGroups.delete(from);
                                }
                                
                                m.reply(`✅ *SAFE MASS ADD COMPLETE*\n\nTotal Success: ${successCount}\nTotal Failed: ${failCount}`);
                                return;
                            } catch (e) {
                                massAddingGroups.delete(from);
                                return m.reply('Error processing VCF: ' + e);
                            }
                        }

                        if (text === 'on') { settings.autoadd = true; saveSettings(phoneNumber); m.reply('Autoadd enabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles auto-accepting group invites.\n*Usage:* ${prefix}autoadd on/off`);
                        break;
                    }

                    case 'autoapprove':
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        if (text === 'on') { settings.autoapprove = true; saveSettings(phoneNumber); m.reply('Autoapprove enabled! Group join requests will now be automatically approved.'); }
                        else if (text === 'off') { settings.autoapprove = false; saveSettings(phoneNumber); m.reply('Autoapprove disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles automatic approval of group join requests.\n*Usage:* ${prefix}autoapprove on/off`);
                        break;

                    case 'alwaysonline':
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        if (text === 'on') { settings.alwaysonline = true; saveSettings(phoneNumber); await sock.sendPresenceUpdate('available'); m.reply('Always online enabled!'); }
                        else if (text === 'off') { settings.alwaysonline = false; saveSettings(phoneNumber); await sock.sendPresenceUpdate('unavailable'); m.reply('Always online disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Keeps the bot status as "Online".\n*Usage:* ${prefix}alwaysonline on/off`);
                        break;

                    case 'autoviewstatus':
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        if (text === 'on') { settings.autoviewstatus = true; saveSettings(phoneNumber); m.reply('Autoview status enabled! Every status will now be automatically viewed.'); }
                        else if (text === 'off') { settings.autoviewstatus = false; saveSettings(phoneNumber); m.reply('Autoview status disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles automatic viewing of status updates.\n*Usage:* ${prefix}autoviewstatus on/off`);
                        break;

                    case 'ai':
                    case 'ask':
                    case 'chatgpt':
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Asks the AI a question.\n*Usage:* ${prefix}ai <query>\n*Example:* ${prefix}ai What is the capital of Kenya?`);
                        try {
                            const reply = await getAIReply(from, text);
                            await m.reply(reply);
                        } catch (e) {
                            m.reply("Error calling AI: " + e);
                        }
                        break;

                    case 'add':
                        await groupCommands.add(m, sock, text, from, sender, prefix, settings, phoneNumber, BOT_NAME, runtime);
                        break;

                    case 'addall': {
                        if (!m.isGroup) return m.reply('Groups only!');
                        let participantsToAdd: string[] = [];
                        
                        // Handle quoted message
                        if (m.quoted) {
                            const q = m.quoted;
                            if (q.mtype === 'contactMessage') {
                                const vcard = q.msg.vcard || '';
                                const match = vcard.match(/TEL(?:;[^:]*)?:([^\n\r]*)/i);
                                if (match && match[1]) {
                                    const num = match[1].replace(/[^0-9]/g, '');
                                    if (num.length > 5) participantsToAdd = [num + '@s.whatsapp.net'];
                                }
                            } else if (q.mtype === 'contactsArrayMessage') {
                                const contacts = q.msg.contacts || [];
                                participantsToAdd = contacts.map((c: any) => {
                                    const vcard = c.vcard || '';
                                    const match = vcard.match(/TEL(?:;[^:]*)?:([^\n\r]*)/i);
                                    return match && match[1] ? match[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null;
                                }).filter(Boolean) as string[];
                            } else {
                                try {
                                    const vcfBuffer = await q.download();
                                    const vcfText = vcfBuffer.toString();
                                    participantsToAdd = vcfText.match(/TEL(?:;[^:]*)?:([^\n\r]*)/gi)?.map(n => {
                                        const parts = n.split(':');
                                        if (parts.length < 2) return null;
                                        const num = parts[1].replace(/[^0-9]/g, '');
                                        return num.length > 5 ? num + '@s.whatsapp.net' : null;
                                    }).filter(Boolean) as string[] || [];
                                } catch (e) {
                                    console.log('Download error in addall:', e);
                                }
                            }
                        } else if (text) {
                            // Improved number extraction from text
                            participantsToAdd = text.match(/\+?\d[\d\s-]{7,}\d/g)?.map(n => {
                                const num = n.replace(/[^0-9]/g, '');
                                return num.length > 5 ? num + '@s.whatsapp.net' : null;
                            }).filter(Boolean) as string[] || [];
                        } else {
                            return m.reply(`*⚠️ MISSING SOURCE*\n\nReply to a VCF file, a contact, or provide numbers.\n*Usage:* ${prefix}addall <numbers>`);
                        }
                        
                        participantsToAdd = [...new Set(participantsToAdd)].filter(Boolean);
                        if (participantsToAdd.length === 0) return m.reply('No valid numbers found!');
                        
                        try {
                            const groupMeta = await sock.groupMetadata(from);
                            
                            const existingParticipants = new Set(groupMeta.participants.map(p => p.id));
                            const toAdd = participantsToAdd.filter(jid => !existingParticipants.has(jid));
                            
                            if (toAdd.length === 0) return m.reply('All numbers are already in the group!');

                            const botNumbers = Object.keys(botSocks);
                            m.reply(`*🛡️ PROTECTIVE ADD MODE*\n\nFound ${toAdd.length} new numbers.\nUsing ${botNumbers.length} bots for distribution.\nStarting safe add process (3-7s delay) to prevent bans.`);
                            
                            massAddingGroups.add(from);
                            let successCount = 0;
                            let failCount = 0;

                            for (let i = 0; i < toAdd.length; i++) {
                                if (!massAddingGroups.has(from)) {
                                    m.reply('🛑 Mass add stopped by user.');
                                    break;
                                }
                                
                                const jid = toAdd[i];
                                const botIndex = i % botNumbers.length;
                                const botNum = botNumbers[botIndex];
                                const botSock = botSocks[botNum];
                                
                                try {
                                    if (botSock) {
                                        await botSock.groupParticipantsUpdate(from, [jid], 'add');
                                    } else {
                                        await sock.groupParticipantsUpdate(from, [jid], 'add');
                                    }
                                    successCount++;
                                } catch (e) {
                                    failCount++;
                                }
                                
                                // No delay for immediate adding
                                await new Promise(resolve => setTimeout(resolve, 0));
                            }
                            
                            m.reply(`*✅ ADDALL COMPLETE*\n\nAdded: ${successCount}\nFailed: ${failCount}`);
                        } catch (e) {
                            console.log('Addall error:', e);
                            m.reply('Error processing request: ' + e);
                        } finally {
                            massAddingGroups.delete(from);
                        }
                        break;
                    }

                    case 'stopadd':
                        if (!m.isGroup) return m.reply('Groups only!');
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
                        await groupCommands.kick(m, sock, text, from, sender, prefix, settings, phoneNumber, BOT_NAME, runtime, isAdmin);
                        break;

                    case 'promote':
                        await groupCommands.promote(m, sock, text, from, sender, prefix, settings, phoneNumber, BOT_NAME, runtime, isAdmin);
                        break;

                    case 'demote':
                        await groupCommands.demote(m, sock, text, from, sender, prefix, settings, phoneNumber, BOT_NAME, runtime, isAdmin);
                        break;

                    case 'linkgc': {
                        if (!m.isGroup) return m.reply('Groups only!');
                        
                        const groupMetaLink = await sock.groupMetadata(from);
                        const groupAdminsLink = groupMetaLink.participants.filter(v => v.admin !== null).map(v => v.id);
                        const isGroupAdminLink = groupAdminsLink.includes(sender) || isAdmin;
                        if (!isGroupAdminLink) return m.reply('Admins only!');

                        const linkGc = await sock.groupInviteCode(from);
                        m.reply(`https://chat.whatsapp.com/${linkGc}`);
                        break;
                    }

                    case 'leave': {
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isAdmin) return m.reply('Admins only!');
                        await sock.groupLeave(from);
                        break;
                    }

                    case 'mute':
                    case 'closegroup': {
                        if (!m.isGroup) return m.reply('Groups only!');
                        
                        const groupMetaMute = await sock.groupMetadata(from);
                        const groupAdminsMute = groupMetaMute.participants.filter(v => v.admin !== null).map(v => v.id);
                        const isGroupAdminMute = groupAdminsMute.includes(sender) || isAdmin;
                        if (!isGroupAdminMute) return m.reply('Admins only!');

                        if (!groupSchedules[phoneNumber]) groupSchedules[phoneNumber] = {};
                        if (!groupSchedules[phoneNumber][from]) groupSchedules[phoneNumber][from] = {};
                        
                        if (text) {
                            const match = text.toLowerCase().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
                            if (match) {
                                let hours = parseInt(match[1]);
                                const minutes = parseInt(match[2]);
                                const ampm = match[3];
                                if (ampm === 'pm' && hours < 12) hours += 12;
                                if (ampm === 'am' && hours === 12) hours = 0;
                                
                                if (groupSchedules[phoneNumber][from].close) clearTimeout(groupSchedules[phoneNumber][from].close);
                                
                                const scheduleClose = () => {
                                    const now = moment().tz('Africa/Nairobi');
                                    const target = moment().tz('Africa/Nairobi').hours(hours).minutes(minutes).seconds(0).milliseconds(0);
                                    
                                    if (target.isSameOrBefore(now)) {
                                        target.add(1, 'days');
                                    }
                                    
                                    const delay = target.diff(now);
                                    
                                    groupSchedules[phoneNumber][from].close = setTimeout(async () => {
                                        try {
                                            const botSock = botSocks[phoneNumber];
                                            if (botSock) {
                                                await botSock.groupSettingUpdate(from, 'announcement');
                                                await botSock.sendMessage(from, { text: 'Group closed as scheduled!' });
                                            }
                                        } catch (e) { console.log(e); }
                                        scheduleClose(); // Reschedule for next day
                                    }, delay);
                                };
                                
                                scheduleClose();
                                m.reply(`Group scheduled to close daily at ${text} (EAT).`);
                                break;
                            }
                        }
                        
                        if (groupSchedules[phoneNumber][from].close) {
                            clearTimeout(groupSchedules[phoneNumber][from].close);
                            delete groupSchedules[phoneNumber][from].close;
                            m.reply('Scheduled daily closing has been disabled.');
                        }
                        await sock.groupSettingUpdate(from, 'announcement');
                        m.reply('Group closed!');
                        break;
                    }

                    case 'unmute':
                    case 'opengroup': {
                        if (!m.isGroup) return m.reply('Groups only!');
                        
                        const groupMetaUnmute = await sock.groupMetadata(from);
                        const groupAdminsUnmute = groupMetaUnmute.participants.filter(v => v.admin !== null).map(v => v.id);
                        const isGroupAdminUnmute = groupAdminsUnmute.includes(sender) || isAdmin;
                        if (!isGroupAdminUnmute) return m.reply('Admins only!');

                        if (!groupSchedules[phoneNumber]) groupSchedules[phoneNumber] = {};
                        if (!groupSchedules[phoneNumber][from]) groupSchedules[phoneNumber][from] = {};
                        
                        if (text) {
                            const match = text.toLowerCase().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
                            if (match) {
                                let hours = parseInt(match[1]);
                                const minutes = parseInt(match[2]);
                                const ampm = match[3];
                                if (ampm === 'pm' && hours < 12) hours += 12;
                                if (ampm === 'am' && hours === 12) hours = 0;
                                
                                if (groupSchedules[phoneNumber][from].open) clearTimeout(groupSchedules[phoneNumber][from].open);
                                
                                const scheduleOpen = () => {
                                    const now = moment().tz('Africa/Nairobi');
                                    const target = moment().tz('Africa/Nairobi').hours(hours).minutes(minutes).seconds(0).milliseconds(0);
                                    
                                    if (target.isSameOrBefore(now)) {
                                        target.add(1, 'days');
                                    }
                                    
                                    const delay = target.diff(now);
                                    
                                    groupSchedules[phoneNumber][from].open = setTimeout(async () => {
                                        try {
                                            const botSock = botSocks[phoneNumber];
                                            if (botSock) {
                                                await botSock.groupSettingUpdate(from, 'not_announcement');
                                                await botSock.sendMessage(from, { text: 'Group opened as scheduled!' });
                                            }
                                        } catch (e) { console.log(e); }
                                        scheduleOpen(); // Reschedule for next day
                                    }, delay);
                                };
                                
                                scheduleOpen();
                                m.reply(`Group scheduled to open daily at ${text} (EAT).`);
                                break;
                            }
                        }
                        
                        if (groupSchedules[phoneNumber][from].open) {
                            clearTimeout(groupSchedules[phoneNumber][from].open);
                            delete groupSchedules[phoneNumber][from].open;
                            m.reply('Scheduled daily opening has been disabled.');
                        }
                        await sock.groupSettingUpdate(from, 'not_announcement');
                        m.reply('Group opened!');
                        break;
                    }

                    case 'antispam':
                        if (text === 'on') { settings.antispam = true; saveSettings(phoneNumber); m.reply('Antispam enabled!'); }
                        else if (text === 'off') { settings.antispam = false; saveSettings(phoneNumber); m.reply('Antispam disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles anti-spam protection.\n*Usage:* ${prefix}antispam on/off`);
                        break;

                    case 'antimention':
                        if (text === 'on') { settings.antimention = true; saveSettings(phoneNumber); m.reply('Antimention enabled!'); }
                        else if (text === 'off') { settings.antimention = false; saveSettings(phoneNumber); m.reply('Antimention disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles anti-mention protection.\n*Usage:* ${prefix}antimention on/off`);
                        break;

                    case 'antitag':
                        if (text === 'on') { settings.antitag = true; saveSettings(phoneNumber); m.reply('Antitag enabled!'); }
                        else if (text === 'off') { settings.antitag = false; saveSettings(phoneNumber); m.reply('Antitag disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles anti-tag protection.\n*Usage:* ${prefix}antitag on/off`);
                        break;

                    case 'warn':
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
                            await m.reply('', from, { audio: Buffer.from(response.data), mimetype: 'audio/mp4', ptt: true });
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
                        await m.reply('', from, { image: { url: qrUrl }, caption: `*QR Code for:* ${text}` });
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
                            await m.reply('', from, await sticker.toMessage());
                        } else {
                            m.reply(`Reply to an image or video with ${prefix}sticker`);
                        }
                        break;

                    case 'toimg':
                        if (!m.quoted || m.quoted.mtype !== 'stickerMessage') return m.reply(`Reply to a sticker with ${prefix}toimg`);
                        let mediaToImg = await m.quoted.download();
                        await m.reply('', from, { image: mediaToImg, caption: 'Done!' });
                        break;

                    case 'vv':
                    case 'viewonce': {
                        if (!m.quoted || (m.quoted.mtype !== 'imageMessage' && m.quoted.mtype !== 'videoMessage')) {
                            return m.reply('Reply to a view once message with .vv');
                        }
                        try {
                            // Check cache first
                            const cached = viewOnceCache.get(m.quoted.id);
                            if (cached) {
                                if (cached.mimetype.includes('image')) {
                                    await m.reply('', from, { image: cached.data, caption: 'View Once Image Retrieved (Cached)' });
                                } else {
                                    await m.reply('', from, { video: cached.data, caption: 'View Once Video Retrieved (Cached)' });
                                }
                                return;
                            }

                            const media = await m.quoted.download();
                            if (m.quoted.mtype === 'imageMessage') {
                                await m.reply('', from, { image: media, caption: 'View Once Image Retrieved' });
                            } else {
                                await m.reply('', from, { video: media, caption: 'View Once Video Retrieved' });
                            }
                        } catch (e) {
                            // Try to download directly if quoted download fails
                            try {
                                const qObj = await m.getQuotedObj();
                                const media = await downloadMedia(qObj.message);
                                if (m.quoted.mtype === 'imageMessage') {
                                    await m.reply('', from, { image: media, caption: 'View Once Image Retrieved (Direct)' });
                                } else {
                                    await m.reply('', from, { video: media, caption: 'View Once Video Retrieved (Direct)' });
                                }
                            } catch (e2) {
                                m.reply('Failed to retrieve view once media: ' + e2);
                            }
                        }
                        break;
                    }

                    case 'tagall': {
                        if (!m.isGroup) return m.reply('This command is for groups only!');
                        
                        const groupMetaTag = await sock.groupMetadata(from);
                        const groupAdminsTag = groupMetaTag.participants.filter(v => v.admin !== null).map(v => v.id);
                        const isGroupAdminTag = groupAdminsTag.includes(sender) || isAdmin;
                        if (!isGroupAdminTag) return m.reply('Admins only!');

                        const participantsTag = groupMetaTag.participants;
                        let tagTextAll = `*TAG ALL*\n\n*Message:* ${text || 'No message'}\n\n`;
                        for (let mem of participantsTag) {
                            tagTextAll += ` @${mem.id.split('@')[0]}\n`;
                        }
                        await m.reply(tagTextAll, from, { mentions: participantsTag.map(a => a.id) });
                        break;
                    }

                    case 'hidetag': {
                        if (!m.isGroup) return m.reply('This command is for groups only!');
                        
                        const groupMetaHide = await sock.groupMetadata(from);
                        const groupAdminsHide = groupMetaHide.participants.filter(v => v.admin !== null).map(v => v.id);
                        const isGroupAdminHide = groupAdminsHide.includes(sender) || isAdmin;
                        if (!isGroupAdminHide) return m.reply('Admins only!');

                        await m.reply(text || '', from, { mentions: groupMetaHide.participants.map(a => a.id) });
                        break;
                    }

                    case 'play':
                        if (!text) return m.reply(`Example: ${prefix}play faded`);
                        try {
                            const ytsPlay = await import('yt-search');
                            const searchPlay = await ytsPlay.default(text);
                            const videoPlay = searchPlay.videos[0];
                            if (!videoPlay) return m.reply('No results found!');
                            
                            await m.reply('', from, { 
                                image: { url: videoPlay.thumbnail }, 
                                caption: `*PLAYING*\n\n*Title:* ${videoPlay.title}\n*Duration:* ${videoPlay.timestamp}\n*Author:* ${videoPlay.author.name}\n*Views:* ${videoPlay.views}\n\nDownloading audio...` 
                            });

                            const { getInfo, chooseFormat, downloadFromInfo } = await import('ytdl-core');
                            const info = await getInfo(videoPlay.url);
                            const format = chooseFormat(info.formats, { filter: 'audioonly', quality: 'highestaudio' });
                            const stream = downloadFromInfo(info, { format });
                            
                            const chunks: any[] = [];
                            stream.on('data', (chunk) => chunks.push(chunk));
                            stream.on('error', (err) => {
                                console.log('ytdl error:', err);
                                m.reply("Download failed. YouTube might be blocking the request.");
                            });
                            stream.on('end', async () => {
                                if (chunks.length === 0) return;
                                const buffer = Buffer.concat(chunks);
                                await m.reply('', from, { 
                                    audio: buffer, 
                                    mimetype: 'audio/mp4',
                                    fileName: `${videoPlay.title}.mp3`
                                });
                            });
                        } catch (e) {
                            console.log('Play error:', e);
                            m.reply("An error occurred while processing your request.");
                        }
                        break;

                    case 'antilink':
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        if (text === 'on') { settings.antilink = true; saveSettings(phoneNumber); m.reply('Antilink enabled!'); }
                        else if (text === 'off') { settings.antilink = false; saveSettings(phoneNumber); m.reply('Antilink disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles anti-link protection.\n*Usage:* ${prefix}antilink on/off`);
                        break;

                    case 'welcome':
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        if (text === 'on') { settings.welcome = true; saveSettings(phoneNumber); m.reply('Welcome messages enabled!'); }
                        else if (text === 'off') { settings.welcome = false; saveSettings(phoneNumber); m.reply('Welcome messages disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles group welcome messages.\n*Usage:* ${prefix}welcome on/off`);
                        break;

                    case 'goodbye':
                    case 'left':
                        if (!isSessionOwner) return m.reply('This command is restricted to the session holder only.');
                        if (text === 'on') { settings.goodbye = true; saveSettings(phoneNumber); m.reply('Goodbye messages enabled!'); }
                        else if (text === 'off') { settings.goodbye = false; saveSettings(phoneNumber); m.reply('Goodbye messages disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles group leave messages.\n*Usage:* ${prefix}goodbye on/off`);
                        break;

                    case 'block': {
                        if (m.isGroup) return m.reply('Use this command in private inbox');
                        const targetBlock = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        if (!targetBlock || targetBlock === '@s.whatsapp.net') return m.reply('Please specify a user to block.');
                        
                        const targetNumber = targetBlock.split('@')[0];
                        const isTargetBotUser = !!botSocks[targetNumber] || fs.existsSync(path.join('sessions', targetNumber));
                        
                        if (isSessionOwner || isTargetBotUser) {
                            await sock.updateBlockStatus(targetBlock, 'block');
                            m.reply('Blocked!');
                        } else {
                            m.reply('Only the user of this bot can use that command');
                        }
                        break;
                    }

                    case 'unblock': {
                        if (m.isGroup) return m.reply('Use this command in private inbox');
                        const targetUnblock = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        if (!targetUnblock || targetUnblock === '@s.whatsapp.net') return m.reply('Please specify a user to unblock.');
                        
                        const targetNumberUn = targetUnblock.split('@')[0];
                        const isTargetBotUserUn = !!botSocks[targetNumberUn] || fs.existsSync(path.join('sessions', targetNumberUn));

                        if (isSessionOwner || isTargetBotUserUn) {
                            await sock.updateBlockStatus(targetUnblock, 'unblock');
                            m.reply('Unblocked!');
                        } else {
                            m.reply('Only the user of this bot can use that command');
                        }
                        break;
                    }

                    case 'broadcast':
                    case 'bc':
                        if (!isOwner) return m.reply('Owner only!');
                        if (!text) return m.reply('Text required!');
                        const chatsBc = await sock.groupFetchAllParticipating();
                        const groupsBc = Object.values(chatsBc).map(v => v.id);
                        for (let id of groupsBc) {
                            await m.reply(`*BROADCAST*\n\n${text}`, id);
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
                                await m.reply('', from, { 
                                    document: await fs.readFile(vcfPath), 
                                    mimetype: 'text/vcard', 
                                    fileName: `${groupMetadataVcf.subject}.vcf` 
                                });
                                await fs.unlink(vcfPath);
                            } else if (m.quoted) {
                                let vcfBuffer = await m.quoted.download();
                                let vcfText = vcfBuffer.toString();
                                let numbers = vcfText.match(/TEL(?:;[^:]*)?:([^\n\r]*)/gi)?.map(n => {
                                    return n.split(':')[1].replace(/[^0-9]/g, '');
                                }).filter(n => n.length > 5) || [];
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

                    case 'deploybot':
                    case 'deploy':
                        const deployText = `*🚀 HOW TO DEPLOY TECHWIZARD BOT*

To deploy your own version of this bot, follow these steps:

1. Visit our deployment portal:
🔗 http://techwolf.wuaze.com

2. Follow the instructions on the site to:
   - Get your session
   - Configure your environment variables
   - Deploy to your preferred hosting (Railway, Render, etc.)

*Need help?* Join our support group or contact the owner.`;
                        await m.reply(deployText);
                        break;
                }
            }

            // Anti-link logic
            if (settings.antilink && m.isGroup && body.match(/chat\.whatsapp\.com/gi) && !isAdmin) {
                try {
                    await sock.sendMessage(from, { delete: m.key });
                    await m.reply(`*ANTI-LINK DETECTED*\n\n@${sender.split('@')[0]} has been warned. Links are not allowed!`, from, { mentions: [sender] });
                } catch (e) {
                    console.log("[DEBUG] Anti-link error:", e);
                }
            }

            // Anti-spam logic
            if (settings.antispam && !isAdmin && !m.key.fromMe) {
                const now = Date.now();
                if (!botSpamTracker[sender]) botSpamTracker[sender] = { count: 0, lastMessageTime: now };
                
                if (now - botSpamTracker[sender].lastMessageTime < 2000) { // 2 seconds window
                    botSpamTracker[sender].count++;
                    if (botSpamTracker[sender].count >= 5) { // 5 messages in 2 seconds
                        try {
                            await m.reply(`*ANTI-SPAM DETECTED*\n\n@${sender.split('@')[0]} please stop spamming!`, from, { mentions: [sender] });
                            botSpamTracker[sender].count = 0; // Reset after warning
                        } catch (e) {}
                    }
                } else {
                    botSpamTracker[sender].count = 1;
                }
                botSpamTracker[sender].lastMessageTime = now;
            }

            // Anti-mention logic
            if (settings.antimention && m.mentionedJid && m.mentionedJid.length > 0 && !isAdmin && !m.key.fromMe) {
                try {
                    await sock.sendMessage(from, { delete: m.key });
                    await m.reply(`*ANTI-MENTION DETECTED*\n\n@${sender.split('@')[0]} mentions are disabled!`, from, { mentions: [sender] });
                } catch (e) {}
            }

            // Anti-tag logic (tagall/hidetag)
            if (settings.antitag && m.mentionedJid && m.mentionedJid.length > 10 && !isAdmin && !m.key.fromMe) {
                try {
                    await sock.sendMessage(from, { delete: m.key });
                    await m.reply(`*ANTI-TAG DETECTED*\n\n@${sender.split('@')[0]} mass tagging is disabled!`, from, { mentions: [sender] });
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
        m.msg = (['viewOnceMessage', 'viewOnceMessageV2'].includes(m.mtype) ? M[m.mtype].message[getContentType(M[m.mtype].message)] : M[m.mtype]);
        
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
            m.quoted.download = () => downloadMedia(m.msg.contextInfo.quotedMessage);
        }
    }
    if (m.msg?.url) m.download = () => downloadMedia(m.message);
    m.text = m.msg?.text || m.msg?.caption || m.message?.conversation || m.msg?.contentText || m.msg?.selectedDisplayText || m.msg?.title || '';
    
    // Fallback if body is still empty
    if (!m.body) m.body = m.text;

    m.reply = (text: string, chatId = m.chat, options = {}) => conn.sendMessage(chatId, { 
        text: text, 
        ...options,
        contextInfo: {
            ...(options as any).contextInfo,
            isForwarded: true,
            forwardingScore: 999,
            // externalAdReply: {
            //     title: "Forwarded from My Group",
            //     body: "Join our community",
            //     mediaType: 1,
            //     thumbnailUrl: "https://picsum.photos/seed/group/200/200",
            //     sourceUrl: "https://chat.whatsapp.com/EhiFIIYPxZM5jTUfXYH8M9?mode=hq2tcla",
            //     renderLargerThumbnail: false,
            //     showAdAttribution: true
            // }
        }
    }, { quoted: m });
    m.copy = () => smsg(conn, m, store);
    m.copyNForward = (jid = m.chat, forceForward = false, options = {}) => conn.copyNForward(jid, m, forceForward, options);

    return m;
}

async function downloadMedia(message: any) {
    let type = getContentType(message);
    let msg = message[type];
    if (type === 'viewOnceMessage' || type === 'viewOnceMessageV2' || type === 'ephemeralMessage') {
        msg = msg.message;
        type = getContentType(msg);
        msg = msg[type];
    }
    if (!msg && message.url) {
        // Already unwrapped
        msg = message;
        type = getContentType({ [message.mtype || 'documentMessage']: message }); // fallback
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

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, '0.0.0.0', async () => {
    console.log(chalk.green(`Server running on port ${PORT}`));
    
    // Self-ping to prevent Railway/Render/AI Studio from sleeping
    setInterval(() => {
        const pingUrl = process.env.APP_URL 
            ? `${process.env.APP_URL}/health` 
            : process.env.RAILWAY_STATIC_URL 
                ? `https://${process.env.RAILWAY_STATIC_URL}/health` 
                : `http://localhost:${PORT}/health`;
        axios.get(pingUrl).catch(() => {});
    }, 2 * 60 * 1000); // Every 2 minutes

    // Always Online Global Interval
    setInterval(async () => {
        for (const num in botSocks) {
            try {
                const botSet = getSettings(num);
                if (botSet.alwaysonline && botSocks[num]?.authState?.creds?.registered) {
                    // Check if socket is connected
                    if (botSocks[num].ws && botSocks[num].ws.readyState === 1) { // 1 = OPEN
                        // Presence update removed to prevent "last active" issues
                    } else {
                        console.log(`[!] Bot for ${num} seems offline, attempting to reconnect...`);
                        await startBot(num);
                    }
                }
            } catch (e) {}
        }
    }, 20000); // Every 20 seconds

    // Start all sessions
    if (fs.existsSync('sessions')) {
        const sessions = fs.readdirSync('sessions');
        console.log(chalk.blue(`Found ${sessions.length} sessions, starting bots...`));
        for (const session of sessions) {
            if (fs.existsSync(path.join('sessions', session, 'creds.json'))) {
                await startBot(session);
            }
        }
    } else {
        // Migration check for single session
        await startBot();
    }
});
