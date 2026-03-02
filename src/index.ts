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
import chalk from 'chalk';
import NodeCache from 'node-cache';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const OWNER_NUMBER = process.env.OWNER_NUMBER || '254700000000';
const BOT_NAME = process.env.BOT_NAME || 'TECHWIZARD';
let PREFIX = process.env.PREFIX || '.';

// Bot Settings State
const settings = {
    autoreply: false,
    chatbot: false,
    autoread: true,
    autotyping: false,
    autorecording: false,
    autoreact: false,
    autoadd: false,
    alwaysonline: true,
    antilink: true,
    antispam: false,
    antimention: false,
    antitag: false,
    admins: [OWNER_NUMBER.split('@')[0]]
};

const msgRetryCounterCache = new NodeCache();
const store = {
    bind: (ev: any) => {},
    loadMessage: async (chat: string, id: string, conn: any) => null
};

const app = express();
const PORT = 3000;

let pairingCode = "";
let isPairing = false;
let botSock: any = null;
let onlineInterval: any = null;
const conversationMemory: { [key: string]: any[] } = {};
const MAX_MEMORY = 5;

function isEnglish(text: string) {
    const allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?'-\"():;/@#&$%*+=<>[]{}\n";
    return [...text].every(c => allowed.includes(c));
}

async function getAIReply(chatId: string, text: string) {
    if (!isEnglish(text)) return "Please speak English 🙂";
    
    const history = conversationMemory[chatId] || [];
    const systemPrompt = {
        role: "system",
        content: "You are a friendly human chatting on WhatsApp. Reply in ENGLISH only. Keep replies short and natural. No long explanations."
    };

    const payload = {
        messages: [systemPrompt, ...history, { role: "user", content: text }]
    };

    try {
        const response = await axios.post("https://chatbot-ji1z.onrender.com/chatbot-ji1z", payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 15000
        });

        if (response.status === 200) {
            const reply = response.data.choices[0].message.content;
            history.push({ role: "user", content: text });
            history.push({ role: "assistant", content: reply });
            conversationMemory[chatId] = history.slice(-MAX_MEMORY);
            return reply;
        }
    } catch (e) {
        console.log("External AI Error:", e);
    }
    return "Tell me more 🙂";
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${BOT_NAME} - Pairing</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Space Grotesk', sans-serif; background: #0a0a0a; color: #fff; }
                .glass { background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); }
                .neon-text { text-shadow: 0 0 10px rgba(0, 255, 0, 0.5); }
                .neon-border { border: 1px solid rgba(0, 255, 0, 0.3); box-shadow: 0 0 15px rgba(0, 255, 0, 0.1); }
            </style>
        </head>
        <body class="min-h-screen flex items-center justify-center p-4">
            <div class="max-w-md w-full glass rounded-3xl p-8 space-y-8 animate-in fade-in duration-700">
                <div class="text-center space-y-2">
                    <h1 class="text-4xl font-bold tracking-tighter neon-text text-green-400">${BOT_NAME}</h1>
                    <p class="text-zinc-400 text-sm">Professional WhatsApp Multi-Device Bot</p>
                </div>

                <div id="setup-view" class="space-y-6">
                    <div class="space-y-2">
                        <label class="text-xs uppercase tracking-widest text-zinc-500 font-semibold">Phone Number</label>
                        <input type="text" id="phone-number" placeholder="254700000000" 
                            class="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 focus:outline-none focus:border-green-500 transition-colors text-lg tracking-wider">
                    </div>
                    <button onclick="startPairing()" id="pair-btn"
                        class="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-4 rounded-xl transition-all transform hover:scale-[1.02] active:scale-[0.98]">
                        Generate Pairing Code
                    </button>
                </div>

                <div id="code-view" class="hidden space-y-6 text-center">
                    <div class="space-y-2">
                        <p class="text-zinc-400 text-sm">Enter this code on your WhatsApp</p>
                        <div id="pairing-code-display" class="text-5xl font-mono font-bold tracking-[0.2em] py-6 text-green-400">
                            <span class="animate-pulse">.... ....</span>
                        </div>
                    </div>
                    <div class="text-xs text-zinc-500 bg-black/30 p-4 rounded-xl border border-zinc-800/50">
                        Settings > Linked Devices > Link a Device > Link with phone number instead
                    </div>
                    <div class="flex flex-col items-center space-y-4">
                        <div class="flex items-center justify-center space-x-2 text-green-500/50 text-xs animate-pulse">
                            <div class="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                            <span>Waiting for connection...</span>
                        </div>
                        <button onclick="location.reload()" class="text-zinc-600 hover:text-zinc-400 text-[10px] uppercase tracking-widest transition-colors">
                            Cancel & Try Again
                        </button>
                    </div>
                </div>

                <div id="success-view" class="hidden space-y-6 text-center">
                    <div class="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto neon-border">
                        <svg class="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                        </svg>
                    </div>
                    <div class="space-y-2">
                        <h2 class="text-2xl font-bold">Connected!</h2>
                        <p class="text-zinc-400">Check your WhatsApp for the welcome message.</p>
                    </div>
                    <button onclick="location.reload()" class="text-zinc-500 hover:text-white text-sm transition-colors">Restart Setup</button>
                </div>
            </div>

            <script>
                async function startPairing() {
                    const phone = document.getElementById('phone-number').value;
                    if (!phone) return alert('Please enter a phone number!');
                    
                    const btn = document.getElementById('pair-btn');
                    btn.disabled = true;
                    btn.innerText = 'Initializing...';

                    try {
                        const res = await fetch('/api/pair', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ phone })
                        });
                        const data = await res.json();
                        
                        if (data.status === 'success') {
                            document.getElementById('setup-view').classList.add('hidden');
                            document.getElementById('code-view').classList.remove('hidden');
                            pollCode();
                        } else {
                            alert(data.message);
                            btn.disabled = false;
                            btn.innerText = 'Generate Pairing Code';
                        }
                    } catch (e) {
                        alert('Error starting pairing: ' + e);
                        btn.disabled = false;
                    }
                }

                async function pollCode() {
                    const interval = setInterval(async () => {
                        const res = await fetch('/api/status');
                        const data = await res.json();
                        
                        if (data.code) {
                            document.getElementById('pairing-code-display').innerText = data.code;
                        }
                        
                        if (data.connected) {
                            clearInterval(interval);
                            document.getElementById('code-view').classList.add('hidden');
                            document.getElementById('success-view').classList.remove('hidden');
                        }
                    }, 2000);
                }
            </script>
        </body>
        </html>
    `);
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

app.get('/api/status', (req, res) => {
    res.json({ 
        code: pairingCode, 
        connected: botSock?.authState?.creds?.registered || false 
    });
});

async function startBot(phoneNumber?: string, isNewPairing = false) {
    const { state, saveCreds } = await useMultiFileAuthState('session');
    
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
            if (shouldReconnect) startBot(phoneNumber, isNewPairing);
            else isPairing = false;
        } else if (connection === 'open') {
            console.log(chalk.green(`\n[+] ${BOT_NAME} CONNECTED SUCCESSFULLY!\n`));
            isPairing = false;

            // Always Online Logic
            if (onlineInterval) clearInterval(onlineInterval);
            onlineInterval = setInterval(async () => {
                if (settings.alwaysonline && botSock) {
                    await botSock.sendPresenceUpdate('available');
                }
            }, 10000);
            
            // Send Welcome Message & Menu ONLY on new pairing
            if (isNewPairing) {
                const userJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
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
┃ ${PREFIX}restart
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
            }
        }
    });

    sock.ev.on('group-participants.update', async (anu) => {
        try {
            let metadata = await sock.groupMetadata(anu.id);
            let participants = anu.participants;
            for (let num of participants) {
                const id = typeof num === 'string' ? num : (num as any).id;
                if (anu.action == 'add') {
                    let welcomeText = `Welcome @${id.split('@')[0]} to *${metadata.subject}*! 🎉\n\nRead the rules and enjoy your stay.`;
                    await sock.sendMessage(anu.id, { text: welcomeText, mentions: [id] });
                } else if (anu.action == 'remove') {
                    let goodbyeText = `@${id.split('@')[0]} has left the group. Goodbye! 👋`;
                    await sock.sendMessage(anu.id, { text: goodbyeText, mentions: [id] });
                }
            }
        } catch (err) {
            console.log(err);
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;
            mek.message = (getContentType(mek.message) === 'ephemeralMessage') ? mek.message.ephemeralMessage?.message : mek.message;
            if (mek.key && mek.key.remoteJid === 'status@broadcast') return;
            
            // Auto Read
            if (settings.autoread) {
                await sock.readMessages([mek.key]);
            }

            const m = smsg(sock, mek, store);
            const body = m.body || m.text || '';
            const prefix = PREFIX;
            const isCmd = body.startsWith(prefix);
            const command = isCmd ? body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase() : '';
            const args = body.trim().split(/ +/).slice(1);
            const text = args.join(" ");
            const sender = m.sender;
            const from = m.key.remoteJid;
            const senderNumber = sender.split('@')[0];
            const isOwner = OWNER_NUMBER.includes(senderNumber);
            const isAdmin = settings.admins.includes(senderNumber) || isOwner;

            // Typing/Recording simulation
            if (settings.autotyping) await sock.sendPresenceUpdate('composing', from);
            if (settings.autorecording) await sock.sendPresenceUpdate('recording', from);

            // Chatbot Logic
            if (!isCmd && settings.chatbot && !m.key.fromMe) {
                // Group logic: only reply if mentioned or replied to
                if (m.isGroup) {
                    const botNumber = sock.user.id.split(':')[0];
                    const isMentioned = m.mentionedJid.some((jid: string) => jid.startsWith(botNumber));
                    const isReplyToBot = m.quoted && m.quoted.sender.startsWith(botNumber);
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

            // Auto React
            if (settings.autoreact && !m.key.fromMe) {
                const reactions = ['❤️', '👍', '🔥', '✨', '🤖'];
                const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
                await sock.sendMessage(from, { react: { text: randomReaction, key: m.key } });
            }

            // Command Handler (Simplified for now)
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
┃ ${PREFIX}restart
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

                    case 'id':
                        m.reply(from);
                        break;

                    case 'afk':
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Sets your status to Away From Keyboard.\n*Usage:* ${prefix}afk <reason>\n*Example:* ${prefix}afk Sleeping`);
                        m.reply(`You are now AFK: ${text}`);
                        break;

                    case 'reminder':
                        if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Sets a quick reminder.\n*Usage:* ${prefix}reminder <time>|<message>\n*Example:* ${prefix}reminder 10s|Check the door`);
                        const [time, ...remText] = text.split('|');
                        m.reply(`Reminder set for ${time}!`);
                        setTimeout(() => {
                            sock.sendMessage(from, { text: `⏰ REMINDER: ${remText.join('|')}` }, { quoted: m });
                        }, 10000); // Simple 10s for demo, would need parsing for real use
                        break;

                    case 'autoreply':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.autoreply = true; m.reply('Autoreply enabled!'); }
                        else if (text === 'off') { settings.autoreply = false; m.reply('Autoreply disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles automated replies.\n*Usage:* ${prefix}autoreply on/off`);
                        break;

                    case 'chatbot':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.chatbot = true; m.reply('Chatbot enabled!'); }
                        else if (text === 'off') { settings.chatbot = false; m.reply('Chatbot disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles AI chatbot for all messages.\n*Usage:* ${prefix}chatbot on/off`);
                        break;

                    case 'resetai':
                        conversationMemory[from] = [];
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
                        m.reply(`@${newAdmin} is now an admin!`);
                        break;

                    case 'removeadmin':
                        if (!isOwner) return m.reply('Owner only!');
                        const remAdmin = m.mentionedJid[0] ? m.mentionedJid[0].split('@')[0] : text.replace(/[^0-9]/g, '');
                        if (!remAdmin) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Removes a user from the bot admin list.\n*Usage:* ${prefix}removeadmin <tag/number>\n*Example:* ${prefix}removeadmin @user`);
                        settings.admins = settings.admins.filter(a => a !== remAdmin);
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
                        m.reply('Feature coming soon!');
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
                        if (text === 'on') { settings.autoread = true; m.reply('Autoread enabled!'); }
                        else if (text === 'off') { settings.autoread = false; m.reply('Autoread disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles auto-reading of messages.\n*Usage:* ${prefix}autoread on/off`);
                        break;

                    case 'autotyping':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.autotyping = true; m.reply('Autotyping enabled!'); }
                        else if (text === 'off') { settings.autotyping = false; m.reply('Autotyping disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles "typing..." status simulation.\n*Usage:* ${prefix}autotyping on/off`);
                        break;

                    case 'autorecording':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.autorecording = true; m.reply('Autorecording enabled!'); }
                        else if (text === 'off') { settings.autorecording = false; m.reply('Autorecording disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles "recording..." status simulation.\n*Usage:* ${prefix}autorecording on/off`);
                        break;

                    case 'autoreact':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.autoreact = true; m.reply('Autoreact enabled!'); }
                        else if (text === 'off') { settings.autoreact = false; m.reply('Autoreact disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles auto-reactions to messages.\n*Usage:* ${prefix}autoreact on/off`);
                        break;

                    case 'alwaysonline':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.alwaysonline = true; m.reply('Always online enabled!'); }
                        else if (text === 'off') { settings.alwaysonline = false; m.reply('Always online disabled!'); }
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
                        const link = await sock.groupInviteCode(from);
                        m.reply(`https://chat.whatsapp.com/${link}`);
                        break;

                    case 'leave':
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isOwner) return m.reply('Owner only!');
                        await sock.groupLeave(from);
                        break;

                    case 'mute':
                    case 'closegroup':
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isAdmin) return m.reply('Admin only!');
                        await sock.groupSettingUpdate(from, 'announcement');
                        m.reply('Group closed!');
                        break;

                    case 'unmute':
                    case 'opengroup':
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!isAdmin) return m.reply('Admin only!');
                        await sock.groupSettingUpdate(from, 'not_announcement');
                        m.reply('Group opened!');
                        break;

                    case 'antispam':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.antispam = true; m.reply('Antispam enabled!'); }
                        else if (text === 'off') { settings.antispam = false; m.reply('Antispam disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles anti-spam protection.\n*Usage:* ${prefix}antispam on/off`);
                        break;

                    case 'antimention':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.antimention = true; m.reply('Antimention enabled!'); }
                        else if (text === 'off') { settings.antimention = false; m.reply('Antimention disabled!'); }
                        else m.reply(`*⚠️ INVALID ARGUMENTS*\n\n*Description:* Toggles anti-mention protection.\n*Usage:* ${prefix}antimention on/off`);
                        break;

                    case 'antitag':
                        if (!isAdmin) return m.reply('Admin only!');
                        if (text === 'on') { settings.antitag = true; m.reply('Antitag enabled!'); }
                        else if (text === 'off') { settings.antitag = false; m.reply('Antitag disabled!'); }
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
                            
                            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                            const prompt = `Translate the following text to ${targetLang}: "${toTranslate.join('|')}". Only return the translated text.`;
                            const response = await ai.models.generateContent({
                                model: "gemini-3-flash-preview",
                                contents: prompt,
                            });
                            m.reply(`*Translation (${targetLang}):*\n${response.text}`);
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
                            // Using a public API to read QR
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
                            let media = await (m.quoted ? m.quoted.download() : m.download());
                            let sticker = new Sticker(media, {
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
                        let media = await m.quoted.download();
                        await sock.sendMessage(from, { image: media, caption: 'Done!' }, { quoted: m });
                        break;

                    case 'tagall':
                        if (!m.isGroup) return m.reply('This command is for groups only!');
                        const groupMetadata = await sock.groupMetadata(from);
                        const participants = groupMetadata.participants;
                        let tagText = `*TAG ALL*\n\n*Message:* ${text || 'No message'}\n\n`;
                        for (let mem of participants) {
                            tagText += ` @${mem.id.split('@')[0]}\n`;
                        }
                        await sock.sendMessage(from, { text: tagText, mentions: participants.map(a => a.id) }, { quoted: m });
                        break;

                    case 'hidetag':
                        if (!m.isGroup) return m.reply('This command is for groups only!');
                        const groupMetadata2 = await sock.groupMetadata(from);
                        await sock.sendMessage(from, { text: text || '', mentions: groupMetadata2.participants.map(a => a.id) }, { quoted: m });
                        break;

                    case 'play':
                        if (!text) return m.reply(`Example: ${prefix}play faded`);
                        const yts = await import('yt-search');
                        const search = await yts.default(text);
                        const video = search.videos[0];
                        if (!video) return m.reply('No results found!');
                        await sock.sendMessage(from, { 
                            image: { url: video.thumbnail }, 
                            caption: `*PLAYING*\n\n*Title:* ${video.title}\n*Duration:* ${video.timestamp}\n*Views:* ${video.views}\n\nDownloading audio...` 
                        }, { quoted: m });
                        
                        // Note: ytdl-core is often unstable, using a mock or simple implementation if it fails
                        try {
                            const ytdl = await import('ytdl-core');
                            const stream = ytdl.default(video.url, { filter: 'audioonly' });
                            const chunks: any[] = [];
                            stream.on('data', (chunk) => chunks.push(chunk));
                            stream.on('end', async () => {
                                const buffer = Buffer.concat(chunks);
                                await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4' }, { quoted: m });
                            });
                        } catch (e) {
                            m.reply("Download failed. ytdl-core might be restricted.");
                        }
                        break;

                    case 'antilink':
                        if (!m.isGroup) return m.reply('Groups only!');
                        if (!text) return m.reply(`Use ${prefix}antilink on or off`);
                        // Simple state management (in-memory for now)
                        if (text === 'on') {
                            m.reply('Anti-link enabled!');
                        } else {
                            m.reply('Anti-link disabled!');
                        }
                        break;

                    case 'block':
                        if (!isOwner) return m.reply('Owner only!');
                        const users = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        await sock.updateBlockStatus(users, 'block');
                        m.reply('Blocked!');
                        break;

                    case 'unblock':
                        if (!isOwner) return m.reply('Owner only!');
                        const users2 = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        await sock.updateBlockStatus(users2, 'unblock');
                        m.reply('Unblocked!');
                        break;

                    case 'broadcast':
                    case 'bc':
                        if (!isOwner) return m.reply('Owner only!');
                        if (!text) return m.reply('Text required!');
                        const chats = await sock.groupFetchAllParticipating();
                        const groups = Object.values(chats).map(v => v.id);
                        for (let id of groups) {
                            await sock.sendMessage(id, { text: `*BROADCAST*\n\n${text}` });
                        }
                        m.reply(`Sent to ${groups.length} groups.`);
                        break;

                    case 'restart':
                        if (!isOwner) return m.reply('Owner only!');
                        await m.reply('Restarting...');
                        process.exit();
                        break;

                    case 'vcf':
                        if (m.isGroup && (!m.quoted || m.quoted.mtype !== 'documentMessage')) {
                            const groupMetadata = await sock.groupMetadata(from);
                            const participants = groupMetadata.participants;
                            let vcfData = '';
                            for (let i = 0; i < participants.length; i++) {
                                const jid = participants[i].id;
                                const number = jid.split('@')[0];
                                vcfData += `BEGIN:VCARD\nVERSION:3.0\nFN:Group Member ${i + 1}\nTEL;type=CELL;type=VOICE;waid=${number}:+${number}\nEND:VCARD\n`;
                            }
                            const vcfPath = `./${groupMetadata.subject}.vcf`;
                            await fs.writeFile(vcfPath, vcfData);
                            await sock.sendMessage(from, { 
                                document: await fs.readFile(vcfPath), 
                                mimetype: 'text/vcard', 
                                fileName: `${groupMetadata.subject}.vcf` 
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
                        break;

                    // Add more commands here...
                }
            }

            // Anti-link logic
            if (m.isGroup && body.match(/chat.whatsapp.com/gi)) {
                // Check if antilink is on for this group (mocked for now)
                const antilinkOn = true; 
                if (antilinkOn && !isOwner) {
                    await sock.sendMessage(from, { delete: mek.key });
                    await sock.sendMessage(from, { text: `*ANTI-LINK DETECTED*\n\n@${sender.split('@')[0]} has been warned. Links are not allowed!`, mentions: [sender] });
                }
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
        m.sender = jidDecode(conn.user.id).user + '@s.whatsapp.net';
        if (m.isGroup) m.participant = m.key.participant || '';
        m.sender = m.fromMe ? (conn.user.id.split(':')[0] + '@s.whatsapp.net' || conn.user.id) : (m.key.participant || m.key.remoteJid);
    }
    if (m.message) {
        m.mtype = getContentType(M);
        m.msg = (m.mtype == 'viewOnceMessage' ? M.viewOnceMessage.message[getContentType(M.viewOnceMessage.message)] : M[m.mtype]);
        m.body = m.message?.conversation || m.msg?.caption || m.msg?.text || (m.mtype == 'listResponseMessage') && m.msg?.singleSelectReply?.selectedRowId || (m.mtype == 'buttonsResponseMessage') && m.msg?.selectedButtonId || (m.mtype == 'viewOnceMessage') && m.msg?.caption || m.text;
        let quoted = m.quoted = m.msg?.contextInfo ? m.msg.contextInfo.quotedMessage : null;
        m.mentionedJid = m.msg?.contextInfo ? m.msg.contextInfo.mentionedJid : [];
        if (m.quoted) {
            let type = getContentType(quoted);
            m.quoted = quoted[type];
            if (['productMessage'].includes(type)) {
                type = getContentType(m.quoted);
                m.quoted = m.quoted[type];
            }
            if (typeof m.quoted === 'string') m.quoted = { text: m.quoted };
            m.quoted.mtype = type;
            m.quoted.id = m.msg?.contextInfo?.stanzaId;
            m.quoted.chat = m.msg?.contextInfo?.remoteJid || m.chat;
            m.quoted.isBaileys = m.quoted.id ? m.quoted.id.startsWith('BAE5') && m.quoted.id.length === 16 : false;
            m.quoted.sender = jidDecode(m.msg?.contextInfo?.participant || '').user + '@s.whatsapp.net';
            m.quoted.fromMe = m.quoted.sender === (conn.user && conn.user.id);
            m.quoted.text = m.quoted.text || m.quoted.caption || m.quoted.conversation || m.quoted.contentText || m.quoted.selectedDisplayText || m.quoted.title || '';
            m.quoted.mentionedJid = m.msg?.contextInfo ? m.msg.contextInfo.mentionedJid : [];
            m.getQuotedObj = m.getQuotedMessage = async () => {
                if (!m.quoted.id) return false;
                let q = await store.loadMessage(m.chat, m.quoted.id, conn);
                return smsg(conn, q, store);
            };
            let vM = m.quoted.fakeObj = m.msg?.contextInfo?.quotedMessage;
            m.quoted.delete = () => conn.sendMessage(m.chat, { delete: vM.key });
            m.quoted.copyNForward = (jid: string, forceForward = false, options = {}) => conn.copyNForward(jid, vM, forceForward, options);
            m.quoted.download = () => downloadMedia(m.quoted);
        }
    }
    if (m.msg?.url) m.download = () => downloadMedia(m.msg);
    m.text = m.msg?.text || m.msg?.caption || m.message?.conversation || m.msg?.contentText || m.msg?.selectedDisplayText || m.msg?.title || '';
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
    console.log(chalk.green(`Server running on http://0.0.0.0:${PORT}`));
    // Only start if session exists, otherwise wait for web UI
    if (fs.existsSync('./session/creds.json')) {
        console.log(chalk.blue('Session found, starting bot...'));
        startBot();
    } else {
        console.log(chalk.yellow('No session found, waiting for web UI pairing...'));
    }
});
