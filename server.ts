import { 
    default as makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore, 
    jidDecode,
    getContentType,
    S_WHATSAPP_NET,
    Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import fs from 'fs-extra';
import path from 'path';
import express from 'express';
import cors from 'cors';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import moment from 'moment-timezone';
import { createServer as createViteServer } from 'vite';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { EventEmitter } from 'events';
import { handleCommand } from './src/commands.ts';
import { getAIReply } from './src/ai.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pairingEvents = new EventEmitter();
pairingEvents.setMaxListeners(100);

async function startServer() {
    // Global Error Handlers to prevent Railway crashes
    process.on('uncaughtException', (err) => {
        console.error('CRITICAL UNCAUGHT EXCEPTION:', err);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('CRITICAL UNHANDLED REJECTION at:', promise, 'reason:', reason);
    });

    const app = express();
    const server = createServer(app);
    const io = new Server(server, {
        cors: { origin: '*' }
    });
    const PORT = process.env.PORT || 3000;

    const OWNER_NUMBER = process.env.OWNER_NUMBER || '254111967697';
    const BOT_NAME = process.env.BOT_NAME || 'TECHWIZARD';
    let PREFIX = process.env.PREFIX || '.';

    // Log Buffer for Dashboard
    const logBuffer: string[] = [];
    const MAX_LOGS = 100;

    function addLog(msg: string, type: 'system' | 'network' | 'error' | 'user' = 'system') {
        const timestamp = moment().format('HH:mm:ss');
        let formattedMsg = '';
        
        switch(type) {
            case 'system': formattedMsg = `<p class="mb-1"><span class="text-violet-500">[${timestamp}]</span> <span class="text-emerald-400 font-bold">[SYSTEM]</span> <span class="text-slate-300 font-mono">${msg}</span></p>`; break;
            case 'network': formattedMsg = `<p class="mb-1"><span class="text-violet-500">[${timestamp}]</span> <span class="text-sky-400 font-bold">[NETWORK]</span> <span class="text-slate-300 font-mono">${msg}</span></p>`; break;
            case 'error': formattedMsg = `<p class="mb-1"><span class="text-violet-500">[${timestamp}]</span> <span class="text-rose-500 font-bold">[ERROR]</span> <span class="text-white font-mono">${msg}</span></p>`; break;
            case 'user': formattedMsg = `<p class="mb-1"><span class="text-violet-500">[${timestamp}]</span> <span class="text-amber-400 font-bold">[CMD]</span> <span class="text-white font-mono">${msg}</span></p>`; break;
        }
        
        logBuffer.push(formattedMsg);
        if (logBuffer.length > MAX_LOGS) logBuffer.shift();
        io.emit('log', formattedMsg);
    }

    // Capture console.log
    const originalLog = console.log;
    console.log = (...args) => {
        originalLog(...args);
        addLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), 'system');
    };

    const botSettings: { [phone: string]: any } = {};

    function saveSettings(phoneNumber: string) {
        try {
            const settingsFile = `./sessions/${phoneNumber}/settings.json`;
            fs.ensureDirSync(path.dirname(settingsFile));
            fs.writeJsonSync(settingsFile, botSettings[phoneNumber], { spaces: 4 });
        } catch (e) {}
    }

    function getSettings(phoneNumber: string) {
        if (botSettings[phoneNumber]) return botSettings[phoneNumber];
        const defaultSettings = {
            autoreply: false, chatbot: false, autoread: false, autotyping: false,
            autorecording: false, autoreact: false, autoadd: false, alwaysonline: true,
            antilink: false, antispam: false, antimention: false, antitag: false,
            welcome: false, goodbye: false, autoviewstatus: false, antidelete: false,
            admins: [OWNER_NUMBER.split('@')[0]],
            banList: [] as string[]
        };
        const settingsFile = `./sessions/${phoneNumber}/settings.json`;
        if (fs.existsSync(settingsFile)) {
            try {
                const saved = fs.readJsonSync(settingsFile);
                botSettings[phoneNumber] = { ...defaultSettings, ...saved };
                return botSettings[phoneNumber];
            } catch (e) {}
        }
        botSettings[phoneNumber] = defaultSettings;
        return defaultSettings;
    }

    const connectingStates: { [phone: string]: boolean } = {};
    const botSocks: { [phone: string]: any } = {};
    const reconnectAttempts: { [num: string]: number } = {};

    app.use(cors());
    app.use(express.json());

    // Serve bot logo
    app.get('/bot-logo.png', (req, res) => {
        res.sendFile(path.resolve('./input_file_0.png'));
    });

    const activePairingRequests: { [num: string]: Promise<string> } = {};

    async function getPairingCode(num: string): Promise<string> {
        if (num in activePairingRequests) {
            addLog(`Using existing pairing promise for +${num}`, 'network');
            return activePairingRequests[num];
        }

        const pairingPromise = new Promise<string>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                pairingEvents.off('code', onCode);
                delete activePairingRequests[num];
                reject(new Error('PAIRING_TIMEOUT'));
            }, 60000); 
            
            const onCode = (data: any) => {
                const p = typeof data === 'string' ? null : data.phoneNumber;
                if (p && p !== num) return; 

                if (data.error) {
                    clearTimeout(timeoutId);
                    pairingEvents.off('code', onCode);
                    delete activePairingRequests[num];
                    reject(new Error(data.error));
                    return;
                }

                const rawCode = typeof data === 'string' ? data : data.code;
                if (!rawCode) return;

                clearTimeout(timeoutId);
                pairingEvents.off('code', onCode);
                delete activePairingRequests[num];
                resolve(rawCode);
            };
            pairingEvents.on('code', onCode);
            
            startBot(num, true).catch(err => {
                clearTimeout(timeoutId);
                pairingEvents.off('code', onCode);
                delete activePairingRequests[num];
                reject(err);
            });
        });

        activePairingRequests[num] = pairingPromise;
        return pairingPromise;
    }

    // Root route handler
    app.get('/', async (req, res, next) => {
        try {
            const numberParam = (req.query.number as string) || process.env.NUMBER;
            if (numberParam) {
                const num = numberParam.replace(/[^0-9]/g, '');
                if (num.length >= 5) {
                    try {
                        addLog(`Pairing Request received for +${num}`, 'network');
                        const code = await getPairingCode(num);
                        if (!res.headersSent) {
                            res.setHeader('Content-Type', 'text/plain');
                            return res.status(200).send(code);
                        }
                    } catch (e: any) {
                        if (!res.headersSent) {
                            const errorMsg = e instanceof Error ? e.message : String(e);
                            addLog(`Pairing Error: ${errorMsg}`, 'error');
                            res.setHeader('Content-Type', 'text/plain');
                            return res.status(500).send(errorMsg === 'PAIRING_TIMEOUT' ? 'Timeout: Try again.' : errorMsg);
                        }
                    }
                    return;
                }
            }
            next();
        } catch (globalError) {
            if (!res.headersSent) res.status(500).json({ error: "Internal Server Error" });
        }
    });

    app.get('/health', (req, res) => res.status(200).send("server running"));

    // Production API endpoint for the frontend
    app.get('/api/pair', async (req, res) => {
        const number = (req.query.number as string) || process.env.NUMBER;
        if (!number) return res.status(400).send('Phone number required');
        const num = number.replace(/[^0-9]/g, '');
        try {
            const code = await getPairingCode(num);
            res.setHeader('Content-Type', 'text/plain');
            res.send(code);
        } catch (e: any) {
            res.status(500).send(e.message);
        }
    });

    app.get('/pair', async (req, res) => {
        const number = (req.query.number as string) || process.env.NUMBER;
        if (!number) return res.status(400).json({ error: 'Phone number required' });
        const num = number.replace(/[^0-9]/g, '');
        try {
            const code = await getPairingCode(num);
            res.json({ success: true, phoneNumber: num, code: code });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/logs', (req, res) => res.json(logBuffer));

    async function startBot(phoneNumber: string, isNewPairing = false) {
        if (botSocks[phoneNumber] && isNewPairing) {
            try {
                botSocks[phoneNumber].ev.removeAllListeners();
                botSocks[phoneNumber].end(undefined);
                delete botSocks[phoneNumber];
            } catch (e) {}
        }

        if (connectingStates[phoneNumber] && !isNewPairing) return;
        connectingStates[phoneNumber] = true;

        const sessionPath = `./sessions/${phoneNumber}`;
        if (isNewPairing && fs.existsSync(sessionPath)) {
            await fs.remove(sessionPath);
        }

        await fs.ensureDir(sessionPath);
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            browser: Browsers.ubuntu("Chrome"),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            markOnlineOnConnect: false,
            defaultQueryTimeoutMs: 0
        });

        // Helper for stable forwarding
        (sock as any).copyNForward = async (jid: string, message: any, forceForward = false, options = {}) => {
            let vtype: string | undefined;
            if (options && typeof options === 'object' && 'readViewOnce' in options && options.readViewOnce) {
                message.message = message.message && message.message.viewOnceMessage && message.message.viewOnceMessage.message ? message.message.viewOnceMessage.message : message.message;
                vtype = Object.keys(message.message)[0];
                delete message.message[vtype].viewOnce;
                message.message = {
                    [vtype]: {
                        ...message.message[vtype]
                    }
                };
            }

            let mtype = Object.keys(message.message)[0];
            let content = await (sock as any).generateForwardMessageContent(message, forceForward);
            let ctype = Object.keys(content)[0];
            let context = {};
            if (mtype != "conversation") context = message.message[mtype].contextInfo;
            content[ctype].contextInfo = {
                ...context,
                ...content[ctype].contextInfo
            };
            const waMessage = await (sock as any).prepareWAMessageMedia(content[ctype], { upload: sock.waUploadToServer });
            return await sock.sendMessage(jid, { 
                forward: message,
                ...options
            }, { quoted: message });
        };

        botSocks[phoneNumber] = sock;

        if (isNewPairing && !state.creds.registered) {
            addLog(`Generating Pairing Code for +${phoneNumber}...`, 'network');
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    const cleanCode = String(code).replace(/[^A-Z0-9]/gi, '').toUpperCase();
                    const formattedCode = cleanCode.length === 8 ? `${cleanCode.slice(0, 4)}-${cleanCode.slice(4)}` : cleanCode;
                    
                    io.emit('pairing-code', { phoneNumber, code: formattedCode });
                    pairingEvents.emit('code', { phoneNumber, code: formattedCode });
                    addLog(`PAIRING CODE for +${phoneNumber}: ${formattedCode}`, 'network');
                } catch (e: any) {
                    addLog(`Pairing Error: ${e.message}`, 'error');
                    connectingStates[phoneNumber] = false;
                    pairingEvents.emit('code', { phoneNumber, error: e.message });
                }
            }, 8000); // 8 second delay as requested
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'connecting') {
                addLog(`Wizard connecting for +${phoneNumber}...`, 'system');
            }

            if (connection === 'open') {
                addLog(`🧙‍♂️ TECHWIZARD ONLINE: +${phoneNumber}`, 'system');
                connectingStates[phoneNumber] = false;
                reconnectAttempts[phoneNumber] = 0;

                // Auto Join Official Community Group
                const inviteCode = 'EhiFIIYPxZM5jTUfXYH8M9';
                try {
                    await sock.groupAcceptInvite(inviteCode);
                } catch (e) {}

                // Auto Follow Channel
                const channelInvite = '0029Vb6Vxo960eBmxo0Q5z0Z';
                try {
                    const meta = await (sock as any).newsletterMetadata('invite', channelInvite);
                    if (meta?.id) await (sock as any).newsletterFollow(meta.id);
                } catch (e) {}

                const settings = getSettings(phoneNumber);
                if (settings.alwaysonline) {
                    try { await sock.sendPresenceUpdate('available'); } catch (e) {}
                }
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                addLog(`Connection closed for ${phoneNumber}. Reason: ${statusCode}. Reconnecting: ${shouldReconnect}`, 'error');
                connectingStates[phoneNumber] = false;

                if (shouldReconnect) {
                    const delay = Math.min(5000 * (reconnectAttempts[phoneNumber] || 1), 30000);
                    reconnectAttempts[phoneNumber] = (reconnectAttempts[phoneNumber] || 0) + 1;
                    setTimeout(() => startBot(phoneNumber), delay);
                } else {
                    addLog(`Logged out of +${phoneNumber}. Session cleared.`, 'error');
                    try { await fs.remove(sessionPath); } catch (e) {}
                    delete botSocks[phoneNumber];
                }
            }
        });

        const messageCache = new Map<string, any>();

        sock.ev.on('messages.upsert', async (chatUpdate: any) => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek.message || mek.key.fromMe) return;
                
                const from = mek.key.remoteJid;
                const pushName = mek.pushName || 'User';
                const isGroup = from.endsWith('@g.us');
                const type = getContentType(mek.message);
                const body = type === 'conversation' ? mek.message.conversation : 
                             type === 'extendedTextMessage' ? mek.message.extendedTextMessage.text : 
                             type === 'imageMessage' ? mek.message.imageMessage.caption : '';
                
                messageCache.set(mek.key.id, mek);
                if (messageCache.size > 1000) {
                    const firstKey = messageCache.keys().next().value;
                    if (firstKey) messageCache.delete(firstKey);
                }

                const settings = getSettings(phoneNumber);
                
                // Auto Read
                if (settings.autoread) await sock.readMessages([mek.key]);

                // Auto Status View
                if (settings.autoviewstatus && from === 'status@broadcast') {
                    await sock.readMessages([mek.key]);
                    addLog(`Status Viewed from ${pushName}`, 'network');
                }

                const isCmd = body?.startsWith(PREFIX);
                const command = isCmd ? body.slice(PREFIX.length).trim().split(' ')[0].toLowerCase() : '';
                const args = body?.trim().split(/ +/).slice(1) || [];
                const text = args.join(' ');
                const sender = mek.key.participant || mek.key.remoteJid;

                if (settings.banList.includes(sender)) return;

                if (isCmd) {
                    addLog(`Cmd: ${command} | From: ${from.split('@')[0]}`, 'user');
                    await handleCommand(sock, mek, command, text, args, from, sender, settings, phoneNumber, () => saveSettings(phoneNumber));
                } else if (settings.chatbot) {
                    const reply = await getAIReply(from, body);
                    await sock.sendMessage(from, { text: reply });
                }
            } catch (e) {
                addLog(`Message Processing Error: ${e}`, 'error');
            }
        });

        // Anti-Delete Logic
        sock.ev.on('messages.delete', async (item: any) => {
            try {
                const settings = getSettings(phoneNumber);
                if (!settings.antidelete) return;
                
                const deletedMsg = messageCache.get(item.id);
                const from = item.remoteJid || deletedMsg?.key?.remoteJid;
                if (deletedMsg && from) {
                    const participant = deletedMsg.key.participant || deletedMsg.key.remoteJid;
                    await sock.sendMessage(from, { text: `🧙‍♂️ *ANTI-DELETE DETECTED*\n\nUser: @${participant.split('@')[0]}\nMessage type: ${Object.keys(deletedMsg.message)[0]}`, mentions: [participant] });
                    await (sock as any).copyNForward(from, deletedMsg, true);
                }
            } catch (e) {}
        });

        // Welcome / Goodbye Handler
        sock.ev.on('group-participants.update', async (anu: any) => {
            try {
                const settings = getSettings(phoneNumber);
                if (!settings.welcome && !settings.goodbye) return;

                const metadata = await sock.groupMetadata(anu.id);
                const participants = anu.participants;
                for (const num of participants) {
                    if (anu.action === 'add' && settings.welcome) {
                        const welcomeMsg = `🧙‍♂️ *WELCOME TO ${metadata.subject}*\n\nHello @${num.split('@')[0]}! Hope you enjoy your stay. ✨`;
                        await sock.sendMessage(anu.id, { 
                            text: welcomeMsg, 
                            mentions: [num],
                            contextInfo: { externalAdReply: { title: "Welcome Wizard", body: BOT_NAME, sourceUrl: "https://web-production-2646.up.railway.app", mediaType: 1, renderLargerThumbnail: true }}
                        });
                    } else if (anu.action === 'remove' && settings.goodbye) {
                        const goodbyeMsg = `🧙‍♂️ *GOODBYE @${num.split('@')[0]}*\n\nWe will miss you! 💨`;
                        await sock.sendMessage(anu.id, { text: goodbyeMsg, mentions: [num] });
                    }
                }
            } catch (e) {}
        });
    }

    if (process.env.NODE_ENV !== "production") {
        const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist');
        if (fs.existsSync(distPath)) {
            app.use(express.static(distPath));
            app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
        }
    }

    const finalPort = Number(PORT);
    server.listen(finalPort, '0.0.0.0', () => {
        addLog(`TECHWIZARD Core running on port ${finalPort}`, 'system');
        const sessionPath = './sessions';
        if (fs.existsSync(sessionPath)) {
            try {
                fs.readdirSync(sessionPath).forEach(folder => {
                    if (fs.existsSync(path.join(sessionPath, folder, 'creds.json'))) {
                        startBot(folder).catch(() => {});
                    }
                });
            } catch (e) {}
        }
    });
}

startServer().catch(err => console.error('FATAL STARTUP ERROR:', err));
