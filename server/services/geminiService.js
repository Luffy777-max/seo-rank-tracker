import { GoogleGenAI, Type } from "@google/genai";

function getGeminiClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is missing in server .env");
    }
    return new GoogleGenAI({ apiKey });
}

const seoAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        overallScore: { type: Type.NUMBER },
        categories: {
            type: Type.OBJECT,
            properties: {
                seo: { type: Type.NUMBER },
                performance: { type: Type.NUMBER },
                accessibility: { type: Type.NUMBER },
                bestPractices: { type: Type.NUMBER },
            },
            required: ["seo", "performance", "accessibility", "bestPractices"],
        },
        keywords: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    word: { type: Type.STRING },
                    count: { type: Type.NUMBER },
                    density: { type: Type.NUMBER },
                },
                required: ["word", "count", "density"],
            },
        },
        issues: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    severity: {
                        type: Type.STRING,
                        enum: ["critical", "warning", "info"],
                    },
                    category: { type: Type.STRING },
                    message: { type: Type.STRING },
                    recommendation: { type: Type.STRING },
                },
                required: ["severity", "category", "message", "recommendation"],
            },
        },
    },
    required: ["overallScore", "categories", "keywords", "issues"],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function analyzeSeoData(scrapedData) {
    const ai = getGeminiClient();

    const prompt = `You are an expert technical SEO auditor. Analyze the following scraped website data and generate an accurate SEO audit report.
Return valid JSON matching the schema with:
- overallScore: integer 0-100 reflecting overall site health
- categories: scores (0-100) for seo, performance, accessibility, and bestPractices
- keywords: top 8-10 prominent keywords found in the content with word, count, and density (percentage)
- issues: 5-10 concrete, actionable SEO/performance/accessibility/best-practice findings with severity ("critical", "warning", or "info"), category, message, and recommendation.

Scraped Website Data:
${JSON.stringify(scrapedData, null, 2)}`;

    const modelsToTry = [
        "gemini-3.5-flash-lite",
        "gemini-3.6-flash",
        "gemini-3.8-flash",
    ];

    let lastError = null;

    for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
        const modelName = modelsToTry[attempt];
        try {
            const response = await ai.models.generateContent({
                model: modelName,
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }],
                    },
                ],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: seoAnalysisSchema,
                },
            });

            const analysis = JSON.parse(response.text);

            return {
                success: true,
                data: analysis,
            };
        } catch (error) {
            lastError = error;
            const msg = error.message || "";
            const isTransient =
                msg.includes("503") ||
                msg.includes("UNAVAILABLE") ||
                msg.includes("429") ||
                msg.includes("RESOURCE_EXHAUSTED");

            console.warn(
                `Gemini attempt ${attempt + 1} (${modelName}) failed: ${msg}`
            );

            if (isTransient && attempt < modelsToTry.length - 1) {
                await sleep(2000 * (attempt + 1));
                continue;
            }
            break;
        }
    }

    console.error("Gemini analysis error:", lastError?.message);
    return {
        success: false,
        error: lastError?.message || "Gemini analysis failed",
    };
}