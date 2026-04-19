export const speed = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any) => {
    const start = Date.now();
    await m.reply('Pinging...');
    const end = Date.now();
    await m.reply(`Pong! Speed: ${end - start}ms`);
};

export const ping = speed;

export const alive = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any) => {
    m.reply(`*I am alive!* ⚡\n\n*Runtime:* ${runtime(process.uptime())}\n*Bot Name:* ${BOT_NAME}`);
};

export const owner = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any, OWNER_NUMBER: string) => {
    const vcard = 'BEGIN:VCARD\n' // metadata of the contact card
        + 'VERSION:3.0\n' 
        + 'FN:TechWizard Owner\n' // full name
        + 'ORG:TechWizard;\n' // the organization of the contact
        + `TEL;type=CELL;type=VOICE;waid=${OWNER_NUMBER}:+${OWNER_NUMBER}\n` // WhatsApp ID + phone number
        + 'END:VCARD';
    await m.reply('', from, { 
        contacts: { 
            displayName: 'TechWizard Owner', 
            contacts: [{ vcard }] 
        }
    });
};

export const runtimeCmd = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any) => {
    m.reply(`*System Runtime:* ${runtime(process.uptime())}`);
};

export const id = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any) => {
    m.reply(from);
};

export const afk = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any) => {
    if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Sets your status to Away From Keyboard.\n*Usage:* ${prefix}afk <reason>\n*Example:* ${prefix}afk Sleeping`);
    m.reply(`You are now AFK: ${text}`);
};

export const link = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any, OWNER_NUMBER: string, SERVER_ID: string, CONTROL_LINK: string) => {
    m.reply(`*🔗 BOT CONTROL LINK*\n\nYour bot is connected at:\n${CONTROL_LINK}\n\n_Use this link to manage your bot dashboard._`);
};

export const reminder = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any) => {
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
        m.reply(`⏰ *REMINDER:* ${remMessage}`);
    }, delayMs);
};
