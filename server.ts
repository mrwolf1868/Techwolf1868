import { 
    default as makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore, 
    jidDecode,
    getContentType
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
    const app = express();
    const server = createServer(app);
    const io = new Server(server, {
        cors: { origin: '*' }
    });
    const PORT = 3000;

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
            welcome: false, goodbye: false, autoviewstatus: false,
            admins: [OWNER_NUMBER.split('@')[0]]
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

    app.use(cors());
    app.use(express.json());

    // MANDATORY: Root direct pairing for legacy support and custom links
    // This allows: /?number=254... to return just the 8-char code.
    app.get('/', async (req, res, next) => {
        const numberParam = req.query.number as string;
        if (numberParam) {
            const num = numberParam.replace(/[^0-9]/g, '');
            if (num.length >= 5) {
                addLog(`Link-Direct Request for +${num}`, 'network');
                try {
                    // Force a delay or check to ensure we get a fresh code
                    const code = await getPairingCode(num);
                    if (!res.headersSent) {
                        addLog(`Sending direct response for +${num}: ${code}`, 'network');
                        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
                        return res.status(200).send(code);
                    }
                } catch (e: any) {
                    if (!res.headersSent) {
                        const errorMsg = e instanceof Error ? e.message : String(e);
                        addLog(`Link-Direct Error: ${errorMsg}`, 'error');
                        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                        return res.status(500).send(errorMsg);
                    }
                }
                return;
            } else {
                if (!res.headersSent) {
                    return res.status(400).send("Invalid phone number format or too short.");
                }
                return;
            }
        }
        next();
    });

    app.get('/api/logs', (req, res) => res.json(logBuffer));
    app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

    const activePairingRequests: { [num: string]: Promise<string> } = {};

    async function getPairingCode(num: string): Promise<string> {
        if (num in activePairingRequests) return activePairingRequests[num];

        const pairingPromise = new Promise<string>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                pairingEvents.off('code', onCode);
                delete activePairingRequests[num];
                reject(new Error('Pairing timed out (45s)'));
            }, 45000);
            
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
                clearTimeout(timeoutId);
                pairingEvents.off('code', onCode);
                delete activePairingRequests[num];
                resolve(cleanCode);
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
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        botSocks[phoneNumber] = sock;

        if (isNewPairing && !state.creds.registered) {
            addLog(`Initializing pairing for +${phoneNumber}...`, 'network');
            // Give the socket a slightly smaller moment to initialize
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    const cleanCode = String(code).replace(/[^A-Z0-9]/gi, '').toUpperCase();
                    io.emit('pairing-code', { phoneNumber, code: cleanCode });
                    pairingEvents.emit('code', { phoneNumber, code: cleanCode });
                    addLog(`PAIRING CODE for +${phoneNumber}: ${cleanCode}`, 'network');
                } catch (e: any) {
                    addLog(`Pairing Error for +${phoneNumber}: ${e}`, 'error');
                    connectingStates[phoneNumber] = false;
                    pairingEvents.emit('code', { phoneNumber, error: e?.message || String(e) });
                }
            }, 3000);
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
                addLog(`Connection closed for ${phoneNumber} (${reason})`, 'error');
                connectingStates[phoneNumber] = false;
                if (reason !== DisconnectReason.loggedOut) {
                    setTimeout(() => startBot(phoneNumber), 5000);
                }
            } else if (connection === 'open') {
                addLog(`Bot connected successfully: +${phoneNumber}`, 'system');
                connectingStates[phoneNumber] = false;
                
                setInterval(async () => {
                    const settings = getSettings(phoneNumber);
                    if (settings.alwaysonline) {
                        try { await sock.sendPresenceUpdate('available'); } catch (e) {}
                    }
                }, 3 * 60 * 1000);
            }
        });

        sock.ev.on('messages.upsert', async (chatUpdate: any) => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek.message || mek.key.fromMe) return;
                
                const from = mek.key.remoteJid;
                const isGroup = from.endsWith('@g.us');
                const type = getContentType(mek.message);
                const body = type === 'conversation' ? mek.message.conversation : 
                             type === 'extendedTextMessage' ? mek.message.extendedTextMessage.text : 
                             type === 'imageMessage' ? mek.message.imageMessage.caption : '';
                
                if (!body) return;

                const isCmd = body.startsWith(PREFIX);
                const command = isCmd ? body.slice(PREFIX.length).trim().split(' ')[0].toLowerCase() : '';
                const args = body.trim().split(/ +/).slice(1);
                const text = args.join(' ');
                const sender = mek.key.participant || mek.key.remoteJid;
                const settings = getSettings(phoneNumber);

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

    server.listen(PORT, '0.0.0.0', () => {
        addLog(`TECHWIZARD Command Center running on port ${PORT}`, 'system');
        
        // Auto-resume sessions
        const sessionPath = './sessions';
        if (fs.existsSync(sessionPath)) {
            fs.readdirSync(sessionPath).forEach(folder => {
                if (fs.existsSync(path.join(sessionPath, folder, 'creds.json'))) {
                    startBot(folder);
                }
            });
        }
    });
}

startServer();
