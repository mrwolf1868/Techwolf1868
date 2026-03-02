import axios from 'axios';
import { GoogleGenAI } from "@google/genai";

const conversationMemory: { [key: string]: any[] } = {};
const MAX_MEMORY = 5;

function isEnglish(text: string) {
    const allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?'-\"():;/@#&$%*+=<>[]{}\n";
    return [...text].every(c => allowed.includes(c));
}

export async function getAIReply(chatId: string, text: string) {
    if (!isEnglish(text)) return "Please speak English 🙂";
    
    const history = conversationMemory[chatId] || [];
    
    const systemPrompt = {
        role: "system",
        content: "You are a friendly human chatting on Telegram. Reply in ENGLISH only. Keep replies short and natural. No long explanations."
    };

    const payload = {
        messages: [systemPrompt, ...history, { role: "user", content: text }]
    };

    try {
        const response = await axios.post("https://chatbot-ji1z.onrender.com/chatbot-ji1z", payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 15000
        });

        if (response.status === 200) {
            const reply = response.data.choices[0].message.content;
            history.push({ role: "user", content: text });
            history.push({ role: "assistant", content: reply });
            conversationMemory[chatId] = history.slice(-MAX_MEMORY);
            return reply;
        }
    } catch (e) {
        console.log("External AI Error:", e);
    }
    return "Tell more 🙂";
}

export function resetAI(chatId: string) {
    conversationMemory[chatId] = [];
}

export async function translate(text: string, targetLang: string) {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `Translate the following text to ${targetLang}: "${text}". Only return the translated text.`;
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
        });
        return response.text;
    } catch (e) {
        console.error("Translation Error:", e);
        throw e;
    }
}
