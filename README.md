# TECHWIZARD WhatsApp Bot 🧙‍♂️

Welcome to **TECHWIZARD**, a cutting-edge, professional multi-device WhatsApp automation tool. Built on top of the **Baileys** library and powered by **TypeScript/Node.js**, this bot is designed for speed, security, and a seamless user experience.

Whether you need advanced group management, AI-driven conversations, or powerful utility tools, TECHWIZARD has you covered.

---

## 🚀 Key Features

*   **Zero-QR Pairing:** Link your phone number directly using WhatsApp's official Pairing Code system.
*   **AI Integration:** Built-in support for **Google Gemini AI** for smart, contextual conversations.
*   **Advanced Group Management:** Automated welcome/goodbye, protective anti-link/anti-spam filters, and mass-contact management.
*   **Safe Mass Contacting:** Specialized `.vcf` extraction and `.autoadd` tools with built-in safety delays to protect your account.
*   **Always Online Monitoring:** Ensures your bot stays active 24/7 with automatic reconnection logic.
*   **Media Processing:** Convert images to stickers, download YouTube audio, and more.

---

## 🛠️ Complete Command List

| Category | Commands |
| :--- | :--- |
| **🧙‍♂️ General** | `menu`, `ping`, `alive`, `owner`, `runtime`, `speed`, `id`, `link`, `deploybot`, `afk`, `reminder` |
| **🤖 AI System** | `ai`, `ask`, `chatgpt`, `chatbot (on/off)`, `autoreply (on/off)`, `resetai` |
| **📁 Contact Tools** | `vcf`, `vcf <group_link>`, `addall`, `autoadd (on/off)`, `add (reply vcf)` |
| **⚙️ Auto System** | `autoread`, `autotyping`, `autorecording`, `autoreact`, `alwaysonline`, `autoviewstatus` |
| **👥 Group Admin** | `add`, `kick`, `promote`, `demote`, `tagall`, `hidetag`, `linkgc`, `mute`, `unmute`, `welcome`, `goodbye` |
| **🛡️ Protection** | `antilink`, `antispam`, `antimention`, `antitag`, `warn`, `block`, `unblock` |
| **🧰 Utilities** | `sticker`, `toimg`, `play`, `translate`, `calc`, `tts`, `shorturl`, `qr`, `readqr`, `viewonce (vv)` |
| **👑 Owner Only** | `admin`, `addadmin`, `removeadmin`, `broadcast (bc)`, `setprefix`, `setmenuimage`, `shutdown`, `userjoin` |

---

## 📦 Installation & Setup

### 1. Prerequisites
*   [Node.js](https://nodejs.org/) v18 or higher.
*   [FFmpeg](https://ffmpeg.org/) (Required for media processing).

### 2. Configuration
Create a `.env` file in the root directory:
```env
GEMINI_API_KEY="your_api_key_here"
OWNER_NUMBER="254XXXXXXXXX"
BOT_NAME="TECHWIZARD"
PREFIX="."
```

### 3. Start the Engine
```bash
# Install dependencies
npm install

# Run in Development mode
npm run dev
```

### 4. Direct Linking (Dashboard)
You can link your bot directly via the deployment dashboard. Access the URL provided in your logs (e.g., `http://localhost:3000`) and enter your phone number to receive your 8-digit Pairing Code instantly.

---

## 🌩️ Deployment

This bot is optimized for cloud deployment:

*   **PaaS:** Deploy easily on **Railway**, **Render**, or **Northflank**.
*   **VPS:** Use **PM2** to keep the process running 24/7.
*   **Persistent Storage:** **CRITICAL:** Ensure the `sessions/` folder is mapped to a persistent volume to preserve your login session across restarts.

---

## 🤝 Support
Join our community for updates and troubleshooting:
*   [Support Group](https://chat.whatsapp.com/EhiFIIYPxZM5jTUfXYH8M9)
*   [News Channel](https://whatsapp.com/channel/0029Vb6Vxo960eBmxo0Q5z0Z)

---

**Disclaimer:** This bot is not affiliated with WhatsApp Inc. Use it responsibly and do not violate WhatsApp's Terms of Service.
