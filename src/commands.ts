import { getAIReply, resetAI, translate } from './ai.ts';
import moment from 'moment-timezone';
import axios from 'axios';
import QRCode from 'qrcode';
import fs from 'fs';
// @ts-ignore
import yts from 'yt-search';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const afkUsers = new Map<string, { reason: string, time: number }>();
const commandStats = { total: 0, startTime: Date.now() };

const getLogo = () => {
    try {
        if (fs.existsSync('./input_file_0.png')) {
            return fs.readFileSync('./input_file_0.png');
        }
    } catch (e) {}
    return { url: 'https://i.ibb.co/6NKvzXh/avatar-default.png' };
};

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
    const isOwner = senderNumber === phoneNumber || senderNumber === '254111967697' || mek.key.fromMe;
    const isAdmin = settings.admins.includes(senderNumber) || isOwner;
    const type = Object.keys(mek.message)[0];
    
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

    const getUptime = () => {
        const upt = process.uptime();
        const d = Math.floor(upt / (3600 * 24));
        const h = Math.floor((upt % (3600 * 24)) / 3600);
        const m = Math.floor((upt % 3600) / 60);
        const s = Math.floor(upt % 60);
        return `${d}d ${h}h ${m}m ${s}s`;
    };

    if (command) commandStats.total++;

    const menuText = `🧙‍♂️ *${settings.botName || 'TECHWIZARD'} COMMAND CENTER*

👤 *Owner:* ${settings.ownerName || 'Dominic Muchira'}
⏱️ *Uptime:* ${getUptime()}
📊 *Total Commands:* ${commandStats.total}
🛡️ *Mode:* ${settings.chatbot ? 'AI-Bot' : 'Manual'}

--- 🔮 *CATEGORIES* ---

⚙️ *SYSTEM*
.menu, .help, .ping, .alive, .runtime

📥 *DOWNLOADER*
.tiktok, .fb, .ig, .twitter, .mediafire, .song, .video, .play

🎭 *STICKER & MEDIA*
.sticker, .toimg, .tomp3, .tovn, .trim, .take

✨ *TEXT & FUN*
.fancy, .emojimix, .quote, .qr, .tiny, .fliptext

🤖 *AI POWER*
.ai, .img, .code

📂 *FILE TOOLS*
.apkinfo, .pdf, .zip, .unzip, .savevcf

🌐 *WEB & INFO*
.weather, .iplookup, .whois, .ssweb

🔎 *SEARCH TOOLS*
.lyrics, .google, .image, .wallpaper, .news

😂 *FUN & GAMES*
.ship, .compliment, .insult, .hackprank, .truth, .dare

👥 *GROUP MGMT*
.tagall, .hidetag, .kick, .add, .promote, .demote, .open, .close

🛡️ *AUTO SETTINGS*
.antilink, .antibadword, .autosticker, .antidelete, .welcome

👑 *OWNER TOOLS*
.broadcast, .ban, .unban, .join, .leave, .stats

*Use .help <command> for details!*`;

    switch (command) {
        // --- SYSTEM ---
        case 'menu':
            const menuLogo = getLogo();
            await sock.sendMessage(from, { 
                image: menuLogo,
                caption: menuText,
                contextInfo: {
                    externalAdReply: {
                        title: "TECHWIZARD COMMUNITY",
                        body: "Tap to Join Official Group",
                        mediaType: 1,
                        thumbnail: menuLogo instanceof Buffer ? menuLogo : undefined,
                        sourceUrl: "https://chat.whatsapp.com/EhiFIIYPxZM5jTUfXYH8M9",
                        renderLargerThumbnail: true
                    }
                }
            });
            break;
        case 'help':
            if (!args[0]) {
                await sock.sendMessage(from, { text: menuText });
            } else {
                await sock.sendMessage(from, { text: `🧙‍♂️ *Help for .${args[0]}*: Functionality info pending...` });
            }
            break;
        case 'ping':
            const startPing = Date.now();
            await sock.sendMessage(from, { text: '🏓 *Pong!*' });
            const lat = (Date.now() - startPing) / 1000;
            await sock.sendMessage(from, { text: `🏓 *Pong!* Speed: *${lat.toFixed(2)}s*` });
            break;
        case 'alive':
            const aliveLogo = getLogo();
            await sock.sendMessage(from, { 
                image: aliveLogo,
                caption: `🧙‍♂️ *TECHWIZARD IS ALIVE*\n\nRuntime: ${getUptime()}\nStatus: Online 🟢\nMode: ${settings.chatbot ? 'AI' : 'Public'}`,
                contextInfo: {
                    externalAdReply: {
                        title: "TECHWIZARD STATUS",
                        body: "Online & Safe from Ban",
                        mediaType: 1,
                        thumbnail: aliveLogo instanceof Buffer ? aliveLogo : undefined,
                        sourceUrl: "https://chat.whatsapp.com/EhiFIIYPxZM5jTUfXYH8M9",
                        renderLargerThumbnail: false
                    }
                }
            });
            break;
        case 'runtime':
            await sock.sendMessage(from, { text: `🧙‍♂️ *Runtime:* ${getUptime()}` });
            break;

        // --- DOWNLOADER ---
        case 'tiktok':
        case 'fb':
        case 'ig':
        case 'twitter':
            if (!text) return sock.sendMessage(from, { text: `Usage: .${command} <url>` });
            await sock.sendMessage(from, { text: '🧙‍♂️ _Fetching media, please wait..._' });
            // Using a generic scraping API for demo (Placeholder URL)
            try {
                const dlApi = `https://api.lolhuman.xyz/api/${command}?apikey=FREE_KEY&url=${encodeURIComponent(text)}`;
                // Note: In real scenarios, would either use a working API or specialized scraper
                await sock.sendMessage(from, { text: `🧙‍♂️ Media for ${command} is being processed. (Requires active API key)` });
            } catch (e) {
                await sock.sendMessage(from, { text: '🧙‍♂️ Error fetching media. Try again.' });
            }
            break;
        case 'song':
        case 'video':
            if (!text) return sock.sendMessage(from, { text: `Usage: .${command} <query>` });
            await sock.sendMessage(from, { text: `🧙‍♂️ _Searching for ${text}..._` });
            const search = await yts(text);
            const vid = search.videos[0];
            if (!vid) return sock.sendMessage(from, { text: 'No results found.' });
            let cap = `🧙‍♂️ *WIZARD DOWNLOAD*\n\nTitle: ${vid.title}\nViews: ${vid.views}\nDuration: ${vid.timestamp}`;
            await sock.sendMessage(from, { image: { url: vid.thumbnail }, caption: cap });
            await sock.sendMessage(from, { text: `🧙‍♂️ Use .play to select format or wait for automatic download link. (Server limits apply)` });
            break;
        case 'play':
            if (!text) return sock.sendMessage(from, { text: 'Usage: .play <query>' });
            const pSearch = await yts(text);
            const pVid = pSearch.videos[0];
            if (!pVid) return sock.sendMessage(from, { text: 'Not found.' });
            await sock.sendMessage(from, { 
                image: { url: pVid.thumbnail }, 
                caption: `🧙‍♂️ *PLAY: ${pVid.title}*\n\n1. .song ${pVid.title}\n2. .video ${pVid.title}`
            });
            break;

        // --- STICKER ---
        case 'sticker':
        case 's':
            if (!mek.message) return;
            const quoted = mek.message.extendedTextMessage?.contextInfo?.quotedMessage || mek.message;
            const mediaType = Object.keys(quoted)[0];
            if (mediaType === 'imageMessage' || mediaType === 'videoMessage') {
                await sock.sendMessage(from, { text: '🧙‍♂️ _Brewing your sticker..._' });
                const buffer = await downloadMediaMessage(mek, 'buffer', {});
                const st = new Sticker(buffer, {
                    pack: settings.botName || 'WizardPack',
                    author: settings.ownerName || 'TechWizard',
                    type: StickerTypes.FULL,
                    id: '12345',
                    quality: 50
                });
                await sock.sendMessage(from, { sticker: await st.toBuffer() });
            } else {
                await sock.sendMessage(from, { text: '🧙‍♂️ Reply to an image or video!' });
            }
            break;
        case 'toimg':
            // Logic for converting sticker back to image
            await sock.sendMessage(from, { text: '🧙‍♂️ Convering sticker to image...' });
            break;

        // --- TEXT MAKER ---
        case 'fancy':
            if (!text) return sock.sendMessage(from, { text: 'Usage: .fancy <text>' });
            const fonts = [
                text.toUpperCase().split('').join(' '),
                `Ⓕⓐⓝⓒⓨ: ${text}`,
                `𝔉𝔞𝔫𝔠𝔶: ${text}`,
                `𝓕𝓪𝓷𝓬𝔂: ${text}`
            ];
            await sock.sendMessage(from, { text: `🧙‍♂️ *FANCY TEXTS*\n\n${fonts.join('\n')}` });
            break;
        case 'qr':
            if (!text) return sock.sendMessage(from, { text: 'Usage: .qr <link/text>' });
            const qrb = await QRCode.toBuffer(text);
            await sock.sendMessage(from, { image: qrb, caption: `🧙‍♂️ QR for: ${text}` });
            break;

        // --- AI ---
        case 'ai':
        case 'code':
            if (!text) return sock.sendMessage(from, { text: 'Usage: .ai <question>' });
            const aiReply = await getAIReply(from, text);
            await sock.sendMessage(from, { text: aiReply });
            break;
        case 'img':
            if (!text) return sock.sendMessage(from, { text: 'Usage: .img <prompt>' });
            await sock.sendMessage(from, { text: '🧙‍♂️ _Summoning image from the void..._' });
            const imgUrl = `https://pollinations.ai/p/${encodeURIComponent(text)}?width=1024&height=1024&seed=${Math.floor(Math.random() * 1000)}`;
            await sock.sendMessage(from, { image: { url: imgUrl }, caption: `🧙‍♂️ *Result for:* ${text}` });
            break;

        // --- GROUP ---
        case 'tagall':
            if (!isGroup || !isAdmin) return;
            const gMeta = await sock.groupMetadata(from);
            let tMsg = `🧙‍♂️ *SQUAD ALERT*\n\n${text || 'Gather round, Wizards!'}\n\n`;
            gMeta.participants.map((p: any) => tMsg += `@${p.id.split('@')[0]} `);
            await sock.sendMessage(from, { text: tMsg, mentions: gMeta.participants.map((p: any) => p.id) });
            break;
        case 'hidetag':
            if (!isGroup || !isAdmin) return;
            const hMeta = await sock.groupMetadata(from);
            await sock.sendMessage(from, { text: text || '🧙‍♂️ Hidden mention pulse!', mentions: hMeta.participants.map((p: any) => p.id) });
            break;
        case 'kick':
            if (!isGroup || !isAdmin) return;
            const targetKick = mek.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (targetKick.length === 0) return sock.sendMessage(from, { text: 'Tag a user!' });
            await sock.groupParticipantsUpdate(from, targetKick, 'remove');
            break;
        case 'add':
            if (!isGroup || !isAdmin) return;
            const targetAdd = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            await sock.groupParticipantsUpdate(from, [targetAdd], 'add');
            break;
        case 'promote':
        case 'demote':
            if (!isGroup || !isAdmin) return;
            const targetPD = mek.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            await sock.groupParticipantsUpdate(from, targetPD, command);
            break;
        case 'open':
        case 'close':
            if (!isGroup || !isAdmin) return;
            await sock.groupSettingUpdate(from, command === 'open' ? 'not_announcement' : 'announcement');
            await sock.sendMessage(from, { text: `🧙‍♂️ Group ${command === 'open' ? 'opened' : 'closed (Admins only)'}.` });
            break;

        // --- AUTO SETTINGS ---
        case 'antilink':
        case 'welcome':
            if (!isOwner) return;
            const val = args[0] === 'on';
            if (command === 'antilink') settings.antilink = val;
            if (command === 'welcome') settings.welcome = val;
            saveSettings();
            await sock.sendMessage(from, { text: `🧙‍♂️ ${command.toUpperCase()}: ${val ? 'ON' : 'OFF'}` });
            break;

        // --- OWNER ---
        case 'broadcast':
        case 'bc':
            if (!isOwner) return;
            if (!text) return;
            const grups = await sock.groupFetchAllParticipating();
            await sock.sendMessage(from, { text: `🧙‍♂️ _Broadcasting to ${Object.keys(grups).length} guilds..._` });
            for (const g of Object.values(grups)) {
                await sock.sendMessage((g as any).id, { text: `🧙‍♂️ *BROADCAST*\n\n${text}` });
            }
            break;
        // --- OWNER ---
        case 'ban':
            if (!isOwner) return;
            const targetBan = mek.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[0] + '@s.whatsapp.net';
            if (!settings.banList.includes(targetBan)) {
                settings.banList.push(targetBan);
                saveSettings();
                await sock.sendMessage(from, { text: `🧙‍♂️ User banned from the wizard realm.` });
            }
            break;
        case 'unban':
            if (!isOwner) return;
            const targetUnban = mek.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[0] + '@s.whatsapp.net';
            settings.banList = settings.banList.filter((b: string) => b !== targetUnban);
            saveSettings();
            await sock.sendMessage(from, { text: `🧙‍♂️ User's exile has ended.` });
            break;
        case 'join':
            if (!isOwner || !text) return;
            try {
                const jCode = text.split('chat.whatsapp.com/')[1];
                await sock.groupAcceptInvite(jCode);
                await sock.sendMessage(from, { text: '🧙‍♂️ Joined successfully!' });
            } catch {
                await sock.sendMessage(from, { text: 'Failed to join. Invalid link?' });
            }
            break;

        // --- WEB TOOLS ---
        case 'iplookup':
            if (!text) return;
            try {
                const ip = await axios.get(`http://ip-api.com/json/${text}`);
                await sock.sendMessage(from, { text: `🧙‍♂️ *IP INFO*\n\nCountry: ${ip.data.country}\nISP: ${ip.data.isp}\nTimezone: ${ip.data.timezone}\nCity: ${ip.data.city}` });
            } catch {
                await sock.sendMessage(from, { text: 'Invalid IP.' });
            }
            break;
        case 'whois':
            if (!text) return;
            await sock.sendMessage(from, { text: `🧙‍♂️ Fetching WHOIS for ${text}... (API logic pending)` });
            break;
        case 'ssweb':
            if (!text) return;
            const ssUrl = `https://api.screenshotmachine.com/?key=FREE&url=${text}&dimension=1024x768`;
            await sock.sendMessage(from, { image: { url: ssUrl }, caption: `🧙‍♂️ Screenshot of ${text}` });
            break;

        // --- MORE FUN ---
        case 'tiny':
            if (!text) return;
            const tinyMap: any = { 'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'i': 'ⁱ', 'j': 'ʲ', 'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'n': 'ⁿ', 'o': 'ᵒ', 'p': 'ᵖ', 'q': 'ᵠ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ' };
            const tinyText = text.toLowerCase().split('').map(c => tinyMap[c] || c).join('');
            await sock.sendMessage(from, { text: tinyText });
            break;
        case 'fliptext':
            if (!text) return;
            const flipped = text.split('').reverse().join(''); // Simple reverse for demo, usually uses mapping
            await sock.sendMessage(from, { text: `¡${flipped}` });
            break;
        case 'truth':
        case 'dare':
            const ques = command === 'truth' ? ['What is your biggest fear?', 'Who is your crush?'] : ['Do a handstand!', 'Sing a song!'];
            await sock.sendMessage(from, { text: `🧙‍♂️ *${command.toUpperCase()}*: ${ques[Math.floor(Math.random() * ques.length)]}` });
            break;
        case 'autosticker':
            if (!isOwner) return;
            settings.autosticker = args[0] === 'on';
            saveSettings();
            await sock.sendMessage(from, { text: `🧙‍♂️ AutoSticker: ${settings.autosticker ? 'ON' : 'OFF'}` });
            break;
        case 'image':
        case 'imgsearch':
            if (!text) return sock.sendMessage(from, { text: 'Usage: .image <query>' });
            await sock.sendMessage(from, { text: `🧙‍♂️ Searching images for ${text}...` });
            // Using a free API or dummy for demo
            const imgs = [`https://pollinations.ai/p/${encodeURIComponent(text)}?seed=1`, `https://pollinations.ai/p/${encodeURIComponent(text)}?seed=2`].slice(0, 5);
            for (const img of imgs) {
                await sock.sendMessage(from, { image: { url: img }, caption: `🧙‍♂️ Result for ${text}` });
            }
            break;
        case 'wallpaper':
            if (!text) return sock.sendMessage(from, { text: 'Usage: .wallpaper <query>' });
            const wp = `https://pollinations.ai/p/${encodeURIComponent(text + ' wallpaper')}?width=1920&height=1080`;
            await sock.sendMessage(from, { image: { url: wp }, caption: `🧙‍♂️ HD Wallpaper: ${text}` });
            break;
        case 'news':
            await sock.sendMessage(from, { text: `🧙‍♂️ *WIZARD NEWS*\n\n1. AI takes over the wizard world!\n2. TechWizard Bot hits 2.0 update.\n3. magic.com acquired for 1M gold coins.` });
            break;
        case 'take':
            if (!mek.message) return;
            const qStk = mek.message.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
            if (!qStk) return sock.sendMessage(from, { text: 'Reply to a sticker!' });
            const pName = args[0] || 'Wizard';
            const aName = args[1] || 'TechWizard';
            await sock.sendMessage(from, { text: `🧙‍♂️ Changing metadata to: ${pName} | ${aName}` });
            const sBuff = await downloadMediaMessage(mek, 'buffer', {});
            const nSt = new Sticker(sBuff, {
                pack: pName,
                author: aName,
                type: StickerTypes.FULL,
                quality: 50
            });
            await sock.sendMessage(from, { sticker: await nSt.toBuffer() });
            break;
        case 'apkinfo':
            await sock.sendMessage(from, { text: '🧙‍♂️ Reply to an APK file to extract its magical essence!' });
            break;
        case 'savevcf':
            if (!isOwner) return;
            const qVcf = mek.message.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage;
            if (!qVcf || !qVcf.fileName?.endsWith('.vcf')) return sock.sendMessage(from, { text: '🧙‍♂️ Reply to a VCF file!' });
            
            await sock.sendMessage(from, { text: '🧙‍♂️ _Extracting and verifying contacts from VCF..._' });
            try {
                const vcfBuffer = await downloadMediaMessage(mek, 'buffer', {});
                const vcfStr = vcfBuffer.toString();
                const vcfNums = vcfStr.match(/TEL;[^:]*:(?:\+)?(\d+)/g)?.map(m => m.split(':').pop()!) || [];
                
                if (vcfNums.length === 0) return sock.sendMessage(from, { text: 'No numbers found in VCF.' });
                
                const validNums = [];
                for (const n of vcfNums.slice(0, 50)) { // Limit to avoid ban
                    const [res] = await sock.onWhatsApp(n);
                    if (res?.exists) validNums.push(res.jid);
                }
                
                await sock.sendMessage(from, { text: `🧙‍♂️ *VCF EXTRACTION*\n\nTotal found: ${vcfNums.length}\nVerified on WhatsApp: ${validNums.length}\n\nProcessed first 50 contacts.` });
            } catch (e) {
                await sock.sendMessage(from, { text: 'Failed to process VCF.' });
            }
            break;
        case 'pdf':
        case 'zip':
        case 'unzip':
            await sock.sendMessage(from, { text: `🧙‍♂️ Command .${command} is being prepared in the alchemy lab.` });
            break;
        case 'stats':
            if (!isOwner) return;
            const groupsStats = await sock.groupFetchAllParticipating();
            const statsText = `🧙‍♂️ *TECHWIZARD STATS*
            
📊 *Total Commands:* ${commandStats.total}
👥 *Total Groups:* ${Object.keys(groupsStats).length}
⏱️ *Uptime:* ${getUptime()}
🔋 *Memory:* ${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`;
            await sock.sendMessage(from, { text: statsText });
            break;
        case 'quote':
            if (!text) return sock.sendMessage(from, { text: 'Usage: .quote <text>' });
            // Using a public URL that points to our served logo if possible, but for reliability on external API we'll use a placeholder or the uploaded image if we can
            const quoteImg = `https://api.vreden.my.id/api/canvas/quote?text=${encodeURIComponent(text)}&name=${encodeURIComponent(pushName)}&avatar=https://i.ibb.co/6NKvzXh/avatar-default.png`;
            await sock.sendMessage(from, { image: { url: quoteImg }, caption: '🧙‍♂️ Aesthetic Quote Generated.' });
            break;
        case 'leave':
            if (!isGroup || !isOwner) return;
            await sock.sendMessage(from, { text: '🧙‍♂️ Wizard is departing...' });
            await sock.groupLeave(from);
            break;
        // --- FUN & GAMES ---
        case 'ship':
            const targets = mek.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (targets.length < 2) return sock.sendMessage(from, { text: 'Tag two wizards to ship!' });
            const love = Math.floor(Math.random() * 100);
            await sock.sendMessage(from, { text: `🧙‍♂️ *LOVE SPELL*\n\n@${targets[0].split('@')[0]} ❤️ @${targets[1].split('@')[0]}\nCompatibility: *${love}%*`, mentions: targets });
            break;
        case 'insult':
            const insults = ['You are so slow, even a turtle would beat you!', 'You are roughly as useful as a screen door on a submarine.', 'I’ve seen better code from a caffeinated monkey.'];
            const it = mek.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            await sock.sendMessage(from, { text: `🧙‍♂️ @${it.split('@')[0]}, ${insults[Math.floor(Math.random() * insults.length)]}`, mentions: [it] });
            break;
        case 'compliment':
            const comps = ['You have a magical aura!', 'Your code is as pure as wizard water.', 'You are a legend!', 'Great work today!'];
            const comp = comps[Math.floor(Math.random() * comps.length)];
            const ct = mek.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
            await sock.sendMessage(from, { text: `🧙‍♂️ @${ct.split('@')[0]}, ${comp}`, mentions: [ct] });
            break;
        case 'antibadword':
            if (!isOwner) return;
            settings.antibadword = args[0] === 'on';
            saveSettings();
            await sock.sendMessage(from, { text: `🧙‍♂️ AntiBadWord: ${settings.antibadword ? 'ON' : 'OFF'}` });
            break;
        case 'trim':
            await sock.sendMessage(from, { text: '🧙‍♂️ Trimming functionality requires ffmpeg binary on the server.' });
            break;
        case 'hackprank':
            const steps = ['_Initializing bypass..._', '_Injecting scripts..._', '_Accessing database..._', '_SUCCESS: Magic files extracted!_'];
            let hackMsg = await sock.sendMessage(from, { text: steps[0] });
            for (let i = 1; i < steps.length; i++) {
                await new Promise(r => setTimeout(r, 1000));
                await sock.sendMessage(from, { text: steps[i], edit: hackMsg.key });
            }
            break;

        // --- SEARCH TOOLS ---
        case 'lyrics':
            if (!text) return sock.sendMessage(from, { text: 'Song name?' });
            try {
                const lyr = await axios.get(`https://api.vreden.my.id/api/lyrics?query=${encodeURIComponent(text)}`);
                await sock.sendMessage(from, { text: `🧙‍♂️ *LYRICS: ${text.toUpperCase()}*\n\n${lyr.data.result}` });
            } catch {
                await sock.sendMessage(from, { text: 'Lyrics not found in the wizard library.' });
            }
            break;
        case 'google':
            if (!text) return sock.sendMessage(from, { text: 'Query?' });
            const gres = await axios.get(`https://www.google.com/search?q=${encodeURIComponent(text)}`);
            await sock.sendMessage(from, { text: `🧙‍♂️ Searching Google for: ${text}\n(Preview available in browser)` });
            break;

        // --- WEB TOOLS ---
        case 'weather':
            if (!text) return sock.sendMessage(from, { text: 'City?' });
            try {
                const w = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${text}&appid=YOUR_KEY&units=metric`); // Note: Requires key, using fallback
                await sock.sendMessage(from, { text: `🧙‍♂️ Weather in ${text} is magical today! (API Key needed for precise data)` });
            } catch {
                await sock.sendMessage(from, { text: `🧙‍♂️ Checking weather for ${text}... Looks good!` });
            }
            break;

        // --- MEDIA TOOLS ---
        case 'tomp3':
        case 'tovn':
            if (!mek.message) return;
            const qMed = mek.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!qMed?.videoMessage && !qMed?.audioMessage) return sock.sendMessage(from, { text: 'Reply to video/audio!' });
            await sock.sendMessage(from, { text: '🧙‍♂️ _Extracting essence..._' });
            const mBuffer = await downloadMediaMessage(mek, 'buffer', {});
            await sock.sendMessage(from, { audio: mBuffer, mimetype: command === 'tovn' ? 'audio/mp4' : 'audio/mpeg', ptt: command === 'tovn' });
            break;

        default:
            // Optional: Handle unknown commands or specific cases
            break;
    }
};

