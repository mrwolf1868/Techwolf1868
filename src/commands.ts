import { getAIReply, resetAI, translate } from './ai.ts';
import moment from 'moment-timezone';
import axios from 'axios';
import QRCode from 'qrcode';

const afkUsers = new Map<string, { reason: string, time: number }>();

export const handleCommand = async (
    sock: any, 
    mek: any, 
    command: string, 
    text: string, 
    args: string[], 
    from: string, 
    sender: string, 
    settings: any, 
    phoneNumber: string,
    saveSettings: () => void
) => {
    const pushName = mek.pushName || 'User';
    const isSessionOwner = sender.split('@')[0] === phoneNumber;
    const isGroup = from.endsWith('@g.us');
    const senderNumber = sender.split('@')[0];
    const isAdmin = settings.admins.includes(senderNumber) || isSessionOwner;
    
    // AFK Check for sender
    if (afkUsers.has(sender)) {
        afkUsers.delete(sender);
        await sock.sendMessage(from, { text: `🧙‍♂️ *Welcome back ${pushName}!* You are no longer AFK.` });
    }

    // Mentioned AFK check
    const mentioned = mek.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
    for (const m of mentioned) {
        if (afkUsers.has(m)) {
            const data = afkUsers.get(m)!;
            await sock.sendMessage(from, { text: `🧙‍♂️ *User is AFK:*\nReason: ${data.reason}\nSince: ${moment(data.time).fromNow()}` });
        }
    }

    const menuText = `🧙‍♂️ *TECHWIZARD COMMAND FUNCTIONS*

*🧙‍♂️ GENERAL COMMANDS*
.menu → Shows this list
.ping → Latency check
.alive → Online status
.owner → Owner contact
.runtime → Bot uptime
.speed → Processing speed
.id → Get IDs
.link → Session link
.deploybot → Deploy info
.afk → Set AFK status
.reminder → Set reminder

*🤖 AI SYSTEM*
.ai → Chat with Gemini
.ask → Ask anything
.chatgpt → GPT style
.chatbot [on/off] → AI Auto-reply
.autoreply [on/off] → Auto msg respond
.resetai → Clear AI memory

*📁 CONTACT TOOLS*
.vcf → Group contacts to VCF
.vcf <link> → Contacts from link
.addall → (Owner) Add all contacts
.autoadd [on/off] → Auto-add contacts

*⚙️ AUTO SYSTEM*
.autoread [on/off] → Auto read
.autotyping [on/off] → Show typing
.autorecording [on/off] → Show recording
.autoreact [on/off] → Auto emoji react
.alwaysonline [on/off] → Active status
.autoviewstatus [on/off] → Auto status view

*👥 GROUP ADMIN*
.add <num> → Add member
.kick <tag> → Remove member
.promote <tag> → Make admin
.demote <tag> → Remove admin
.tagall → Mention everyone
.hidetag → Ghost mention
.linkgc → Group invite link
.mute → Admin only chat
.unmute → Everyone can chat
.welcome [on/off] → Greet new users
.goodbye [on/off] → Farewell leaving users

*🛡️ PROTECTION SYSTEM*
.antilink [on/off] → Anti group links
.antispam [on/off] → Detect spamming
.antimention [on/off] → Anti mass tags
.antitag [on/off] → Prevent tag abuse
.warn <tag> → Give warning
.block <tag> → Block user
.unblock <tag> → Unblock user

*🧰 UTILITIES*
.sticker → Img to sticker
.toimg → Sticker to image
.play <query> → YouTube music
.translate <lang> <text> → Translate
.calc <math> → Calculator
.tts <text> → Text to speech
.shorturl <url> → Link shortener
.qr <text> → Generate QR
.readqr → Scan (Reply to QR)
.viewonce → (vv) See media multiple times

*👑 OWNER ONLY*
.admin → Show admins
.addadmin <tag> → New admin
.removeadmin <tag> → Remove admin
.broadcast <msg> → Multi-group send
.setprefix <char> → Change command prefix
.setmenuimage <url> → Custom menu BG
.shutdown → Kill bot
.userjoin → Track joins`;

    switch (command) {
        // --- GENERAL ---
        case 'menu':
            await sock.sendMessage(from, { text: menuText });
            break;
        case 'ping':
            const start = Date.now();
            await sock.sendMessage(from, { text: '_Pinging Wizard Network..._' });
            const end = Date.now();
            await sock.sendMessage(from, { text: `🧙‍♂️ *Pong!* \nLatency: *${end - start}ms*` });
            break;
        case 'alive':
            await sock.sendMessage(from, { text: '🧙‍♂️ *TECHWIZARD IS PULSING WITH MAGIC!*' });
            break;
        case 'owner':
            await sock.sendMessage(from, { text: `🧙‍♂️ *Dominic Muchira (TechWizard)*\nWhatsApp: wa.me/254111967697` });
            break;
        case 'runtime':
            const upt = process.uptime();
            const hours = Math.floor(upt / 3600);
            const minutes = Math.floor((upt % 3600) / 60);
            const seconds = Math.floor(upt % 60);
            await sock.sendMessage(from, { text: `🧙‍♂️ *Wizard Runtime:* ${hours}h ${minutes}m ${seconds}s` });
            break;
        case 'speed':
            const s1 = Date.now();
            await axios.get('https://google.com');
            await sock.sendMessage(from, { text: `🧙‍♂️ *Processing Speed:* ${Date.now() - s1}ms` });
            break;
        case 'id':
            await sock.sendMessage(from, { text: `🧙‍♂️ *YOUR WA ID:* ${sender}\n*CHAT JID:* ${from}` });
            break;
        case 'link':
            await sock.sendMessage(from, { text: `🧙‍♂️ *Session Link:* ${process.env.PUBLIC_URL || 'https://ais-dev-nxvcb2rbkdkrbkltjwracn-92018233287.europe-west3.run.app'}/?number=${phoneNumber}` });
            break;
        case 'deploybot':
            await sock.sendMessage(from, { text: `🧙‍♂️ *Deploying TechWizard:* 100%. Visit Dashboard to manage.` });
            break;
        case 'afk':
            afkUsers.set(sender, { reason: text || 'AFK', time: Date.now() });
            await sock.sendMessage(from, { text: `🧙‍♂️ *AFK MODE ON!*\nReason: ${text || 'None'}` });
            break;
        case 'reminder':
            if (!text) return sock.sendMessage(from, { text: 'Usage: .reminder <mins> <text>' });
            const mns = parseInt(args[0]);
            if (isNaN(mns)) return sock.sendMessage(from, { text: 'Invalid minutes!' });
            const rText = args.slice(1).join(' ');
            setTimeout(async () => {
                await sock.sendMessage(from, { text: `🧙‍♂️ *WIZARD REMINDER:* ${rText || 'Time is up!'}` });
            }, mns * 60000);
            await sock.sendMessage(from, { text: `🧙‍♂️ *I will remind you in ${mns} minutes.*` });
            break;

        // --- AI SYSTEM ---
        case 'ai':
        case 'ask':
        case 'chatgpt':
            if (!text) return sock.sendMessage(from, { text: '🧙‍♂️ Use your words, wizard!' });
            const aiRes = await getAIReply(from, text);
            await sock.sendMessage(from, { text: aiRes });
            break;
        case 'chatbot':
            if (!isAdmin) return;
            if (args[0] === 'on') { settings.chatbot = true; saveSettings(); await sock.sendMessage(from, { text: '🧙‍♂️ Chatbot: *ON*' }); }
            else if (args[0] === 'off') { settings.chatbot = false; saveSettings(); await sock.sendMessage(from, { text: '🧙‍♂️ Chatbot: *OFF*' }); }
            break;
        case 'autoreply':
            if (!isAdmin) return;
            if (args[0] === 'on') { settings.autoreply = true; saveSettings(); await sock.sendMessage(from, { text: '🧙‍♂️ AutoReply: *ON*' }); }
            else if (args[0] === 'off') { settings.autoreply = false; saveSettings(); await sock.sendMessage(from, { text: '🧙‍♂️ AutoReply: *OFF*' }); }
            break;
        case 'resetai':
            resetAI(from);
            await sock.sendMessage(from, { text: '🧙‍♂️ AI Mind Reset.' });
            break;

        // --- CONTACT TOOLS ---
        case 'vcf':
            if (!isGroup) return;
            const metaGroup = await sock.groupMetadata(from);
            let vcfContent = '';
            metaGroup.participants.forEach((p: any, i: number) => {
                vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:Member ${i}\nTEL;type=CELL;waid=${p.id.split('@')[0]}:+${p.id.split('@')[0]}\nEND:VCARD\n`;
            });
            await sock.sendMessage(from, { document: Buffer.from(vcfContent), fileName: 'Contacts.vcf', mimetype: 'text/vcard' });
            break;
        case 'addall':
            if (!isSessionOwner) return;
            await sock.sendMessage(from, { text: '🧙‍♂️ Saving group contacts to phonebook... (Simulation)' });
            break;

        // --- AUTO SYSTEM ---
        case 'autoread':
            if (!isAdmin) return;
            if (args[0] === 'on') { settings.autoread = true; saveSettings(); await sock.sendMessage(from, { text: '🧙‍♂️ AutoRead: *ON*' }); }
            else { settings.autoread = false; saveSettings(); await sock.sendMessage(from, { text: '🧙‍♂️ AutoRead: *OFF*' }); }
            break;
        case 'alwaysonline':
            if (!isAdmin) return;
            if (args[0] === 'on') { settings.alwaysonline = true; saveSettings(); await sock.sendMessage(from, { text: '🧙‍♂️ AlwaysOnline: *ON*' }); }
            else { settings.alwaysonline = false; saveSettings(); await sock.sendMessage(from, { text: '🧙‍♂️ AlwaysOnline: *OFF*' }); }
            break;

        // --- GROUP ADMIN ---
        case 'add':
            if (!isGroup || !isAdmin) return;
            const targetAdd = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            await sock.groupParticipantsUpdate(from, [targetAdd], 'add');
            await sock.sendMessage(from, { text: '🧙‍♂️ Added.' });
            break;
        case 'kick':
            if (!isGroup || !isAdmin) return;
            const targetKick = mek.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (targetKick.length === 0) return sock.sendMessage(from, { text: 'Tag them!' });
            await sock.groupParticipantsUpdate(from, targetKick, 'remove');
            break;
        case 'promote':
            if (!isGroup || !isAdmin) return;
            const targetProm = mek.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            await sock.groupParticipantsUpdate(from, targetProm, 'promote');
            break;
        case 'demote':
            if (!isGroup || !isAdmin) return;
            const targetDem = mek.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            await sock.groupParticipantsUpdate(from, targetDem, 'demote');
            break;
        case 'tagall':
            if (!isGroup || !isAdmin) return;
            const gMeta = await sock.groupMetadata(from);
            let tMsg = `🧙‍♂️ *SQUAD ALERT*\n\n${text || ''}\n\n`;
            gMeta.participants.map((p: any) => tMsg += `@${p.id.split('@')[0]} `);
            await sock.sendMessage(from, { text: tMsg, mentions: gMeta.participants.map((p: any) => p.id) });
            break;
        case 'linkgc':
            if (!isGroup) return;
            const code = await sock.groupInviteCode(from);
            await sock.sendMessage(from, { text: `https://chat.whatsapp.com/${code}` });
            break;
        case 'mute':
            if (!isGroup || !isAdmin) return;
            await sock.groupSettingUpdate(from, 'announcement');
            await sock.sendMessage(from, { text: '🧙‍♂️ Group Muted.' });
            break;
        case 'unmute':
            if (!isGroup || !isAdmin) return;
            await sock.groupSettingUpdate(from, 'not_announcement');
            await sock.sendMessage(from, { text: '🧙‍♂️ Group Unmuted.' });
            break;

        // --- UTILITIES ---
        case 'sticker':
            await sock.sendMessage(from, { text: '🧙‍♂️ Process stickers via Dashboard or by sending an image. (Logic pending advanced media libs)' });
            break;
        case 'translate':
            const l = args[0];
            const tText = args.slice(1).join(' ');
            if (!tText) return sock.sendMessage(from, { text: '.translate <lang> <text>' });
            const tr = await translate(tText, l);
            await sock.sendMessage(from, { text: `🧙‍♂️ (${l}): ${tr}` });
            break;
        case 'calc':
            if (!text) return sock.sendMessage(from, { text: 'Math expression?' });
            try { await sock.sendMessage(from, { text: `🧙‍♂️ Result: ${eval(text.replace(/[^0-9+\-*/().]/g, ''))}` }); } 
            catch { await sock.sendMessage(from, { text: 'Invalid math.' }); }
            break;
        case 'qr':
            if (!text) return;
            const qrb = await QRCode.toBuffer(text);
            await sock.sendMessage(from, { image: qrb, caption: '🧙‍♂️ Your QR Code.' });
            break;
        case 'shorturl':
            if (!text) return;
            const rs = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(text)}`);
            await sock.sendMessage(from, { text: `🧙‍♂️ ${rs.data}` });
            break;

        // --- PROTECTION ---
        case 'antilink':
            if (!isAdmin) return;
            settings.antilink = args[0] === 'on';
            saveSettings();
            await sock.sendMessage(from, { text: `🧙‍♂️ AntiLink: ${settings.antilink ? 'ON' : 'OFF'}` });
            break;

        // --- OWNER ---
        case 'broadcast':
        case 'bc':
            if (!isSessionOwner) return;
            const grups = await sock.groupFetchAllParticipating();
            for (const g of Object.values(grups)) {
                await sock.sendMessage((g as any).id, { text: `🧙‍♂️ *BROADCAST*\n\n${text}` });
            }
            break;
        case 'setprefix':
            if (!isSessionOwner) return;
            process.env.PREFIX = args[0];
            await sock.sendMessage(from, { text: `🧙‍♂️ Prefix changed to: ${args[0]}` });
            break;
        case 'shutdown':
            if (!isSessionOwner) return;
            await sock.sendMessage(from, { text: '🧙‍♂️ Powering down...' });
            process.exit(0);
            break;

        default:
            break;
    }
};
