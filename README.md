# TECHWIZARD WhatsApp Bot 🧙‍♂️

A professional, multi-device WhatsApp bot built with Node.js and the Baileys library.

## Features

- **Authentication:** Pairing Code login system (no QR needed).
- **Basic Commands:** `.menu`, `.ping`, `.alive`, `.owner`, `.runtime`.
- **Group Management:** Auto-welcome, Anti-link, `.tagall`, `.hidetag`.
- **Utility:** `.ai` (Gemini AI), `.sticker`, `.toimg`, `.play` (YouTube Audio).
- **Owner Features:** `.block`, `.unblock`, `.broadcast`, `.restart`.
- **VCF Support:** Extract numbers from VCF files.

## Installation

### 1. Configure Environment Variables
Create a `.env` file (or set in your hosting provider):
```env
GEMINI_API_KEY="your_gemini_api_key"
OWNER_NUMBER="254700000000"
BOT_NAME="TECHWIZARD"
PREFIX="."
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Start the Bot
```bash
npm run dev
```

### 4. Link Your Account
1. Watch the terminal logs for the **Pairing Code**.
2. Open WhatsApp on your phone.
3. Go to **Settings > Linked Devices > Link a Device > Link with phone number instead**.
4. Enter the code displayed in the logs.

## Hosting

This bot is ready for deployment on:
- **Railway**
- **Replit**
- **Heroku**
- **VPS**

Ensure you have `ffmpeg` installed on your server for media processing.
