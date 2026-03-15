export const menu = async (m: any, sock: any, text: string, from: string, sender: string, prefix: string, settings: any, phoneNumber: string, BOT_NAME: string, runtime: any) => {
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
┃ ${prefix}deploybot / deploy
┃ ${prefix}afk
┃ ${prefix}reminder
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 🤖 AI SYSTEM 〕━━┈⊷
┃ ${prefix}autoreply on/off
┃ ${prefix}chatbot on/off
┃ ${prefix}resetai
┃ ${prefix}ai / ask / chatgpt
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 👑 OWNER COMMANDS 〕━━┈⊷
┃ ${prefix}admin
┃ ${prefix}addadmin
┃ ${prefix}removeadmin
┃ ${prefix}broadcast / bc
┃ ${prefix}setprefix
┃ ${prefix}setmenuimage
┃ ${prefix}shutdown
┃ ${prefix}userjoin
┃ ${prefix}join / autojoin
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 ⚙️ AUTO SYSTEM 〕━━┈⊷
┃ ${prefix}autoread on/off
┃ ${prefix}autotyping on/off
┃ ${prefix}autorecording on/off
┃ ${prefix}autoreact on/off
┃ ${prefix}autoadd on/off
┃ ${prefix}alwaysonline on/off
┃ ${prefix}autoviewstatus on/off
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 👥 GROUP COMMANDS 〕━━┈⊷
┃ ${prefix}add
┃ ${prefix}kick
┃ ${prefix}promote
┃ ${prefix}demote
┃ ${prefix}tagall
┃ ${prefix}hidetag
┃ ${prefix}addall
┃ ${prefix}stopadd
┃ ${prefix}linkgc
┃ ${prefix}leave
┃ ${prefix}mute / closegroup
┃ ${prefix}unmute / opengroup
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
┃ ${prefix}vv / viewonce
┃ ${prefix}sticker / s
┃ ${prefix}toimg
┃ ${prefix}play
╰━━━━━━━━━━━━━━━┈⊷

╭━━〔 📁 CONTACT COMMANDS 〕━━┈⊷
┃ ${prefix}vcf
┃ ${prefix}add (reply vcf)
╰━━━━━━━━━━━━━━━┈⊷

╰━❮ ${BOT_NAME} SYSTEM ACTIVE ❯━╯`;
    await m.reply(menuText, from, { mentions: ['254111967697@s.whatsapp.net'] });
};

export const help = menu;
export const allmenu = menu;
