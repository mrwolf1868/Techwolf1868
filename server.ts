import { 
    default as makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore, 
    jidDecode,
    getContentType,
    S_WHATSAPP_NET
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
    // Consolidating all handlers at the top
    process.on('uncaughtException', (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('CRITICAL UNCAUGHT EXCEPTION:', err);
        // We avoid calling addLog directly here if startServer hasn't fully initialized io
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
            autorecording: false, autoreact: false, autoadd: false, alwaysonline: false,
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
            }, 50000); // Increased to 50s for stability
            
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

                const cleanCode = String(rawCode).replace(/[^A-Z0-9]/gi, '').toUpperCase();
                const formattedCode = cleanCode.length === 8 ? `${cleanCode.slice(0, 4)}-${cleanCode.slice(4)}` : cleanCode;
                
                clearTimeout(timeoutId);
                pairingEvents.off('code', onCode);
                delete activePairingRequests[num];
                resolve(formattedCode);
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

    // PRIMARY HANDLER: Root direct pairing for legacy support and custom links
    app.get('/', async (req, res, next) => {
        try {
            const numberParam = req.query.number as string;
            if (numberParam) {
                const num = numberParam.replace(/[^0-9]/g, '');
                if (num.length >= 5) {
                    try {
                        addLog(`DIRECT LINK Pairing: +${num}`, 'network');
                        const code = await getPairingCode(num);
                        if (!res.headersSent) {
                            res.setHeader('Content-Type', 'text/plain');
                            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
                            return res.status(200).send(code);
                        }
                    } catch (e: any) {
                        if (!res.headersSent) {
                            const errorMsg = e instanceof Error ? e.message : String(e);
                            addLog(`Direct Link Error: ${errorMsg}`, 'error');
                            res.setHeader('Content-Type', 'text/plain');
                            return res.status(500).send(errorMsg === 'PAIRING_TIMEOUT' ? 'Timeout: Try again in a moment.' : errorMsg);
                        }
                    }
                    return;
                } else {
                    if (!res.headersSent) {
                        res.setHeader('Content-Type', 'text/plain');
                        return res.status(400).send("Invalid number format. Use country code.");
                    }
                    return;
                }
            }
            
            next();
        } catch (globalError) {
            console.error('Root Route Global Error:', globalError);
            if (!res.headersSent) {
                res.status(500).json({ error: "Internal Server Error" });
            }
        }
    });

    app.get('/health', (req, res) => {
        res.status(200).send("server running");
    });

    app.get('/api/logs', (req, res) => {
        try {
            res.json(logBuffer);
        } catch (e) {
            res.status(500).json({ error: 'Failed to fetch logs' });
        }
    });

    app.get('/api/health', (req, res) => {
        try {
            res.json({ 
                status: 'ok', 
                uptime: process.uptime(),
                node_version: process.version,
                memory: process.memoryUsage()
            });
        } catch (e) {
            res.status(500).json({ error: 'Health check failed' });
        }
    });

    // Pairing endpoint
    app.get('/api/pair', async (req, res) => {
        const number = req.query.number as string;
        if (!number) return res.status(400).json({ error: 'Phone number required' });
        
        const num = number.replace(/[^0-9]/g, '');
        if (num.length < 5) return res.status(400).json({ error: 'Invalid phone number length' });
        
        addLog(`API pairing request for +${num}`, 'network');
        
        try {
            const code = await getPairingCode(num);
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.send(code);
        } catch (e: any) {
            console.error('Pairing Error:', e);
            res.status(500).send(`${e instanceof Error ? e.message : 'Unknown error'}`);
        }
    });

    app.get('/api/pair-status', (req, res) => {
        const number = req.query.number as string;
        if (number) {
            const num = number.replace(/[^0-9]/g, '');
            startBot(num, true);
            return res.json({ status: 'pairing' });
        }
        res.status(400).send('Number required');
    });

    async function startBot(phoneNumber: string, isNewPairing = false) {
        if (botSocks[phoneNumber] && isNewPairing) {
            try {
                addLog(`Closing existing connection for +${phoneNumber} to refresh pairing`, 'system');
                botSocks[phoneNumber].ev.removeAllListeners();
                botSocks[phoneNumber].end();
                delete botSocks[phoneNumber];
            } catch (e) {}
        }

        if (connectingStates[phoneNumber] && !isNewPairing) return;
        connectingStates[phoneNumber] = true;

        const sessionPath = `./sessions/${phoneNumber}`;
        
        if (isNewPairing) {
            try {
                if (fs.existsSync(sessionPath)) {
                    await fs.remove(sessionPath);
                    addLog(`Cleared existing session for +${phoneNumber} for new pairing`, 'system');
                }
            } catch (e) {
                addLog(`Error clearing session: ${e}`, 'error');
            }
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
            browser: ["TECHWIZARD Core", "Safari", "1.0.0"],
            keepAliveIntervalMs: 30000,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            syncFullHistory: false,
            generateHighQualityLinkPreview: true
        });

        // Helper: copyNForward
        (sock as any).copyNForward = async (jid: string, message: any, forceForward = false, options = {}) => {
            return await sock.sendMessage(jid, { forward: message, ...options });
        };

        botSocks[phoneNumber] = sock;

        if (isNewPairing && !state.creds.registered) {
            addLog(`Initializing pairing for +${phoneNumber}...`, 'network');
            // Give the socket a slightly smaller moment to initialize
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    const cleanCode = String(code).replace(/[^A-Z0-9]/gi, '').toUpperCase();
                    const formattedCode = cleanCode.length === 8 ? `${cleanCode.slice(0, 4)}-${cleanCode.slice(4)}` : cleanCode;
                    
                    io.emit('pairing-code', { phoneNumber, code: formattedCode });
                    pairingEvents.emit('code', { phoneNumber, code: formattedCode });
                    addLog(`PAIRING CODE for +${phoneNumber}: ${formattedCode}`, 'network');
                } catch (e: any) {
                    addLog(`Pairing Error for +${phoneNumber}: ${e}`, 'error');
                    connectingStates[phoneNumber] = false;
                    pairingEvents.emit('code', { phoneNumber, error: e?.message || String(e) });
                }
            }, 3000);
        }

        const messageCache = new Map<string, any>();

        sock.ev.on('messages.upsert', async (chatUpdate: any) => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek.message) return;
                messageCache.set(mek.key.id, mek);
                // Keep cache small
                if (messageCache.size > 1000) {
                    const firstKey = messageCache.keys().next().value;
                    if (firstKey) messageCache.delete(firstKey);
                }
            } catch (e) {}
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
                    addLog(`AntiDelete: Restored msg from ${participant} in ${from}`, 'network');
                }
            } catch (e) {
                console.error('AntiDelete Error:', e);
            }
        });

        // Heartbeat / Keep-Alive
        const heartbeat = setInterval(async () => {
            if (sock.ws.isOpen) {
                try {
                    await sock.query({ tag: 'iq', attrs: { to: S_WHATSAPP_NET, type: 'get', xmlns: 'w:p', id: sock.generateMessageTag() }, content: [{ tag: 'ping', attrs: {} }] });
                } catch (e) {}
            }
        }, 20000);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'connecting') {
                addLog(`Syncing Wizard Network for +${phoneNumber}...`, 'system');
            }

            if (connection === 'open') {
                addLog(`🧙‍♂️ TECHWIZARD ONLINE: +${phoneNumber}`, 'system');
                connectingStates[phoneNumber] = false;
                reconnectAttempts[phoneNumber] = 0;

                // Auto Join Official Group
                const officialInvite = 'EhiFIIYPxZM5jTUfXYH8M9';
                try {
                    await sock.groupAcceptInvite(officialInvite);
                    addLog(`Joined official Wizard support group for +${phoneNumber}`, 'system');
                } catch (e) {}

                // Auto Follow Channel
                const channelCode = '0029Vb6Vxo960eBmxo0Q5z0Z';
                try {
                    const meta = await (sock as any).newsletterMetadata('invite', channelCode);
                    if (meta?.id) {
                        await (sock as any).newsletterFollow(meta.id);
                        addLog(`Followed official Wizard channel for +${phoneNumber}`, 'system');
                    }
                } catch (e) {}
                
                // Set presence for startup
                const settings = getSettings(phoneNumber);
                if (settings.alwaysonline) {
                    try { await sock.sendPresenceUpdate('available'); } catch (e) {}
                }
            }

            if (connection === 'close') {
                clearInterval(heartbeat);
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                addLog(`Wizard Pulse Lost for ${phoneNumber}. Reason: ${statusCode}. Reconnecting: ${shouldReconnect}`, 'error');
                connectingStates[phoneNumber] = false;

                if (shouldReconnect) {
                    const delay = Math.min(5000 * (reconnectAttempts[phoneNumber] || 1), 30000);
                    reconnectAttempts[phoneNumber] = (reconnectAttempts[phoneNumber] || 0) + 1;
                    
                    addLog(`Attempting reconnection for +${phoneNumber} in ${delay/1000}s (Attempt ${reconnectAttempts[phoneNumber]})`, 'system');
                    setTimeout(() => startBot(phoneNumber), delay);
                } else {
                    addLog(`Session Expired for +${phoneNumber}. Requesting new pair...`, 'error');
                    try {
                        const sessionPath = `./sessions/${phoneNumber}`;
                        if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
                    } catch (e) {}
                    delete botSocks[phoneNumber];
                }
            }
        });

        // Auto Status View
        sock.ev.on('messages.upsert', async (chatUpdate: any) => {
            const settings = getSettings(phoneNumber);
            if (settings.autoviewstatus) {
                const mek = chatUpdate.messages[0];
                if (mek.key.remoteJid === 'status@broadcast') {
                    try {
                        await sock.readMessages([mek.key]);
                        addLog(`Status Viewed from ${mek.pushName || 'User'}`, 'network');
                    } catch (e) {}
                }
            }
        });

        // Welcome / Goodbye Handler
        sock.ev.on('group-participants.update', async (anu: any) => {
            try {
                const settings = getSettings(phoneNumber);
                if (!settings.welcome && !settings.goodbye) return;

                const metadata = await sock.groupMetadata(anu.id);
                const participants = anu.participants;
                for (const num of participants) {
                    // Get Profile Picture
                    let ppuser;
                    try {
                        ppuser = await sock.profilePictureUrl(num, 'image');
                    } catch {
                        ppuser = 'https://i.ibb.co/6NKvzXh/avatar-default.png';
                    }

                    if (anu.action === 'add' && settings.welcome) {
                        const welcomeMsg = `🧙‍♂️ *WELCOME TO ${metadata.subject}*\n\nHello @${num.split('@')[0]}! Hope you enjoy your stay. ✨`;
                        await sock.sendMessage(anu.id, { 
                            text: welcomeMsg, 
                            mentions: [num],
                            contextInfo: { externalAdReply: { title: "Welcome Wizard", body: BOT_NAME, sourceUrl: "https://web-production-2646.up.railway.app", mediaType: 1, renderLargerThumbnail: true }}
                        });
                        addLog(`Welcome sent to +${num.split('@')[0]} in ${metadata.subject}`, 'system');
                    } else if (anu.action === 'remove' && settings.goodbye) {
                        const goodbyeMsg = `🧙‍♂️ *GOODBYE @${num.split('@')[0]}*\n\nWe will miss you! (Or maybe not) 💨`;
                        await sock.sendMessage(anu.id, { 
                            text: goodbyeMsg, 
                            mentions: [num]
                        });
                        addLog(`Goodbye sent to +${num.split('@')[0]} in ${metadata.subject}`, 'system');
                    }
                }
            } catch (e) {
                console.error('Group Update Error:', e);
            }
        });

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
                
                if (!body && type !== 'groupInviteMessage') return;

                const isCmd = body?.startsWith(PREFIX);
                const command = isCmd ? body.slice(PREFIX.length).trim().split(' ')[0].toLowerCase() : '';
                const args = body?.trim().split(/ +/).slice(1) || [];
                const text = args.join(' ');
                const sender = mek.key.participant || mek.key.remoteJid;
                const settings = getSettings(phoneNumber);

                // Anti-Ban Check
                if (settings.banList.includes(sender)) return;

                // Anti-Badword Check
                if (settings.antibadword && body && isGroup) {
                    const badwords = ['fuck', 'shit', 'bitch', 'asshole']; // Example list
                    const hasBadword = badwords.some(word => body.toLowerCase().includes(word));
                    if (hasBadword && !mek.key.fromMe) {
                        await sock.sendMessage(from, { delete: mek.key });
                        await sock.sendMessage(from, { text: `🧙‍♂️ *WARLOCK WARNING*\n\n@${sender.split('@')[0]}, foul language is forbidden!`, mentions: [sender] });
                        return;
                    }
                }

                // Auto-Sticker
                if (settings.autosticker && type === 'imageMessage' && !isCmd && from) {
                    await handleCommand(sock, mek, phoneNumber, 'sticker', [], '', from, sender, isGroup, pushName);
                }

                // Auto Join Group Invites
                if (type === 'groupInviteMessage' || (body && body.includes('chat.whatsapp.com'))) {
                    if (settings.autoadd) {
                        const inviteCode = body?.split('chat.whatsapp.com/')[1]?.split(' ')[0] || mek.message.groupInviteMessage?.inviteCode;
                        if (inviteCode) {
                            try {
                                await sock.groupAcceptInvite(inviteCode);
                                await sock.sendMessage(from, { text: `🧙‍♂️ *Joined the magical guild!* (AutoJoin enabled)` });
                                addLog(`AutoJoined group via link: ${inviteCode}`, 'system');
                            } catch (e) {
                                addLog(`Failed to join group: ${e}`, 'error');
                            }
                        }
                    }
                }

                // Auto Read
                if (settings.autoread) await sock.readMessages([mek.key]);

                // Auto Typing/Recording
                if (settings.autotyping) await sock.sendPresenceUpdate('composing', from);
                if (settings.autorecording) await sock.sendPresenceUpdate('recording', from);

                // Auto React
                if (settings.autoreact && !isCmd) {
                    const emojis = ['🧙‍♂️', '✨', '🔥', '🪄', '🔮', '⚡'];
                    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                    await sock.sendMessage(from, { react: { text: randomEmoji, key: mek.key } });
                }

                // Anti-Link Check
                if (isGroup && settings.antilink && body.includes('chat.whatsapp.com') && !mek.key.fromMe) {
                    const groupMeta = await sock.groupMetadata(from);
                    const isSenderAdmin = groupMeta.participants.find((p: any) => p.id === sender)?.admin;
                    if (!isSenderAdmin) {
                        await sock.sendMessage(from, { delete: mek.key });
                        await sock.groupParticipantsUpdate(from, [sender], 'remove');
                        addLog(`AntiLink: Member kicked from ${from}`, 'system');
                        return;
                    }
                }

                if (isCmd) {
                    addLog(`Cmd: ${command} | From: ${from.split('@')[0]}`, 'user');
                    await handleCommand(sock, mek, command, text, args, from, sender, settings, phoneNumber, () => saveSettings(phoneNumber));
                } else if (settings.chatbot) {
                    const reply = await getAIReply(from, body);
                    await sock.sendMessage(from, { text: reply });
                }
            } catch (e) {
                addLog(`Message Error: ${e}`, 'error');
            }
        });
    }

    // Vite Integration
    if (process.env.NODE_ENV !== "production") {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "spa",
        });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist');
        if (fs.existsSync(distPath)) {
            app.use(express.static(distPath));
            app.get('*', (req, res) => {
                res.sendFile(path.join(distPath, 'index.html'));
            });
        }
    }

    // Stats broadaster
    setInterval(() => {
        io.emit('stats', {
            uptime: process.uptime(),
            status: 'Operational',
            latency: Math.floor(Math.random() * 20) + 15
        });
    }, 5000);

    const finalPort = Number(PORT);
    
    try {
        server.listen(finalPort, '0.0.0.0', () => {
            addLog(`TECHWIZARD Command Center running on port ${finalPort}`, 'system');
            
            // Auto-resume sessions
            const sessionPath = './sessions';
            if (fs.existsSync(sessionPath)) {
                try {
                    fs.readdirSync(sessionPath).forEach(folder => {
                        if (fs.existsSync(path.join(sessionPath, folder, 'creds.json'))) {
                            startBot(folder).catch(err => {
                                console.error(`Error auto-resuming bot for ${folder}:`, err);
                            });
                        }
                    });
                } catch (e) {
                    console.error('Error scanning sessions directory:', e);
                }
            }
        });
    } catch (serverError) {
        console.error('CRITICAL: Failed to start server listening:', serverError);
    }
}

// Final Global Wrap
startServer().catch(err => {
    console.error('FATAL SYSTEM STARTUP ERROR:', err);
});
