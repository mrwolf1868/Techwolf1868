import { GoogleGenAI } from "@google/genai";

const conversationMemory: { [key: string]: any[] } = {};
const MAX_MEMORY = 10;

export async function getAIReply(chatId: string, text: string) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
    const history = conversationMemory[chatId] || [];
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [
                { role: "user", parts: [{ text: "You are TechWizard, a fast and smart WhatsApp bot. Keep your replies concise, helpful, and energetic. Support all languages." }] },
                ...history.map(h => ({ role: h.role, parts: [{ text: h.content }] })),
                { role: "user", parts: [{ text }] }
            ],
        });

        const reply = response.text || "I'm not sure how to respond to that.";
        
        history.push({ role: "user", content: text });
        history.push({ role: "model", content: reply });
        conversationMemory[chatId] = history.slice(-MAX_MEMORY);
        
        return reply;
    } catch (e) {
        console.error("Gemini AI Error:", e);
        return "I'm having a bit of a brain freeze. Try again in a second! 🧙‍♂️";
    }
}

export function resetAI(chatId: string) {
    conversationMemory[chatId] = [];
}

export async function translate(text: string, targetLang: string) {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
        const prompt = `Translate the following text to ${targetLang}. Only return the translated text: "${text}"`;
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
        });
        return response.text;
    } catch (e) {
        console.error("Translation Error:", e);
        return text;
    }
}
