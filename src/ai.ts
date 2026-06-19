import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";

const conversationMemory: { [key: string]: any[] } = {};
const MAX_MEMORY = 10;

// Primary API (TechWiz Portal)
const TECHWIZARD_API_KEY = process.env.TECHWIZARD_API_KEY || "sk-6e13bbb968861da27993f1b3765ee684";
const ENDPOINTS = [
    "https://techwizgpt.lovable.app/api/public/v1/chat/completions",
    "https://techwizgpt.techwiz.app/api/public/v1/chat/completions",
    "https://techwizgpt.lovable.app/api/v1/chat/completions"
];

// Fallback Google AI
const getGeminiModel = () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    const genAI = new GoogleGenerativeAI(key);
    return genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
};

export async function getAIReply(chatId: string, text: string, imageBuffer?: Buffer) {
    const history = conversationMemory[chatId] || [];
    
    // Try TechWiz Endpoints
    for (const endpoint of ENDPOINTS) {
        try {
            let content: any = text;
            if (imageBuffer) {
                content = [
                    { type: "text", text: text || "Analyze this image" },
                    { type: "image_url", image_url: { url: `data:image/png;base64,${imageBuffer.toString("base64")}` } }
                ];
            }

            const messages = [
                { role: "system", content: "You are TechWizard, a smart and friendly WhatsApp assistant. Be helpful, concise, and energetic." },
                ...history.map(h => ({ role: h.role === 'model' ? 'assistant' : h.role, content: h.content })),
                { role: "user", content: content }
            ];

            const res = await axios.post(endpoint, {
                model: "google/gemini-3-flash-preview",
                messages: messages,
            }, {
                headers: {
                    "Authorization": `Bearer ${TECHWIZARD_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 10000
            });

            const reply = res.data.choices?.[0]?.message?.content;
            if (reply) {
                if (!imageBuffer) {
                    history.push({ role: "user", content: text });
                    history.push({ role: "model", content: reply });
                    conversationMemory[chatId] = history.slice(-MAX_MEMORY);
                }
                return reply;
            }
        } catch (e: any) {
            console.warn(`TechWiz Endpoint failed [${endpoint}]:`, e.message);
        }
    }

    // 2. Fallback to Official Gemini API
    try {
        const model = getGeminiModel();
        if (model) {
            const promptParts: any[] = [];
            if (imageBuffer) {
                promptParts.push({ text: text || "Analyze this image" });
                promptParts.push({
                    inlineData: {
                        data: imageBuffer.toString("base64"),
                        mimeType: "image/png"
                    }
                });
            } else {
                promptParts.push({ text: text || (history.length === 0 ? "Hello, suggest what you can do" : "Continue") });
            }

            const historyForGemini = history.map(h => ({
                role: h.role === 'model' ? 'model' : 'user',
                parts: [{ text: h.content }]
            }));

            const result = await model.generateContent({
                contents: [
                    { role: 'user', parts: [{ text: "You are TechWizard, a fast and smart WhatsApp bot. Keep your replies concise, helpful, and energetic." }] },
                    { role: 'model', parts: [{ text: "Understood! I'm ready to help. 🧙‍♂️" }] },
                    ...historyForGemini,
                    { role: 'user', parts: promptParts }
                ],
            });

            const reply = result.response.text();
            if (reply) {
                if (!imageBuffer) {
                    history.push({ role: "user", content: text });
                    history.push({ role: "model", content: reply });
                    conversationMemory[chatId] = history.slice(-MAX_MEMORY);
                }
                return reply;
            }
        }
    } catch (err: any) {
        console.error("Gemini Fallback Error:", err.message);
    }

    // 3. Last Resort - Nice User Message
    return "🧙‍♂️ _The wizard is briefly resting. I'll be back to help you in just a moment!_";
}

export function resetAI(chatId: string) {
    conversationMemory[chatId] = [];
}

export async function translate(text: string, targetLang: string) {
    const prompt = `Translate to ${targetLang}. Only return the translation: "${text}"`;
    
    // Try TechWiz Endpoints
    for (const endpoint of ENDPOINTS) {
        try {
            const res = await axios.post(endpoint, {
                model: "google/gemini-3-flash-preview",
                messages: [{ role: "user", content: prompt }]
            }, {
                headers: {
                    "Authorization": `Bearer ${TECHWIZARD_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 5000
            });
            if (res.data.choices?.[0]?.message?.content) return res.data.choices[0].message.content;
        } catch {}
    }

    // Fallback Gemini
    try {
        const model = getGeminiModel();
        if (model) {
            const result = await model.generateContent(prompt);
            return result.response.text();
        }
    } catch {}

    return text;
}
