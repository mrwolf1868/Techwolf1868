export const add = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any) => {
    if (!m.isGroup) return m.reply('Groups only!');
    if (!text) return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Adds a member to the group.\n*Usage:* ${prefix}add <number>\n*Example:* ${prefix}add 254700000000`);
    
    try {
        const groupMetaAdd = await sock.groupMetadata(from);
        const botIdAdd = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const botIsAdminAdd = groupMetaAdd.participants.find((p: any) => p.id === botIdAdd)?.admin;
        if (!botIsAdminAdd) return m.reply('Bot must be an admin to add members!');

        const addJid = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await sock.groupParticipantsUpdate(from, [addJid], 'add');
        m.reply('Added!');
    } catch (e) {
        m.reply('Failed to add. They might have privacy settings or I might be rate-limited.');
    }
};

export const kick = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any, isAdmin: boolean) => {
    if (!m.isGroup) return m.reply('Groups only!');
    
    const groupMetaKick = await sock.groupMetadata(from);
    const groupAdminsKick = groupMetaKick.participants.filter((v: any) => v.admin !== null).map((v: any) => v.id);
    const isGroupAdminKick = groupAdminsKick.includes(sender) || isAdmin;
    if (!isGroupAdminKick) return m.reply('Admins only!');

    const botIdKick = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const botIsAdminKick = groupMetaKick.participants.find((p: any) => p.id === botIdKick)?.admin;
    if (!botIsAdminKick) return m.reply('Bot must be an admin to kick members!');

    const kickJid = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    if (!kickJid || kickJid === '@s.whatsapp.net') return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Kicks a member from the group.\n*Usage:* ${prefix}kick <tag/reply/number>`);
    
    await sock.groupParticipantsUpdate(from, [kickJid], 'remove');
    m.reply('Kicked!');
};

export const promote = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any, isAdmin: boolean) => {
    if (!m.isGroup) return m.reply('Groups only!');
    
    const groupMetaProm = await sock.groupMetadata(from);
    const groupAdminsProm = groupMetaProm.participants.filter((v: any) => v.admin !== null).map((v: any) => v.id);
    const isGroupAdminProm = groupAdminsProm.includes(sender) || isAdmin;
    if (!isGroupAdminProm) return m.reply('Admins only!');

    const botIdProm = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const botIsAdminProm = groupMetaProm.participants.find((p: any) => p.id === botIdProm)?.admin;
    if (!botIsAdminProm) return m.reply('Bot must be an admin to promote members!');

    const promJid = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    if (!promJid || promJid === '@s.whatsapp.net') return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Promotes a member to group admin.\n*Usage:* ${prefix}promote <tag/reply/number>`);
    
    await sock.groupParticipantsUpdate(from, [promJid], 'promote');
    m.reply('Promoted!');
};

export const demote = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any, isAdmin: boolean) => {
    if (!m.isGroup) return m.reply('Groups only!');
    
    const groupMetaDem = await sock.groupMetadata(from);
    const groupAdminsDem = groupMetaDem.participants.filter((v: any) => v.admin !== null).map((v: any) => v.id);
    const isGroupAdminDem = groupAdminsDem.includes(sender) || isAdmin;
    if (!isGroupAdminDem) return m.reply('Admins only!');

    const botIdDem = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const botIsAdminDem = groupMetaDem.participants.find((p: any) => p.id === botIdDem)?.admin;
    if (!botIsAdminDem) return m.reply('Bot must be an admin to demote members!');

    const demJid = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    if (!demJid || demJid === '@s.whatsapp.net') return m.reply(`*⚠️ MISSING ARGUMENTS*\n\n*Description:* Demotes a group admin to member.\n*Usage:* ${prefix}demote <tag/reply/number>`);
    
    await sock.groupParticipantsUpdate(from, [demJid], 'demote');
    m.reply('Demoted!');
};
