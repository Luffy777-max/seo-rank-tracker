import Analysis from "../models/Analysis.js";
import { scrapeUrl } from "../services/scraperService.js";
import { analyzeSeoData } from "../services/geminiService.js";

const getAuthenticatedUserId = (req) => req.userId || req.userID;

// Analyze a URL
export const analyzeUrl = async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const { url } = req.body;
        if (!url?.trim()) {
            return res.status(400).json({
                success: false,
                message: "URL is required",
            });
        }

        let validUrl;
        try {
            validUrl = new URL(
                /^https?:\/\//i.test(url.trim())
                    ? url.trim()
                    : `https://${url.trim()}`
            );
        } catch {
            return res.status(400).json({
                success: false,
                message: "Invalid URL format",
            });
        }

        const analysis = await Analysis.create({
            userId,
            url: validUrl.href,
            status: "processing",
        });

        // Respond immediately so frontend can poll GET /api/analysis/:id
        res.status(201).json({
            success: true,
            message: "Analysis started",
            analysisId: analysis._id,
        });

        // Run scraping + Gemini AI audit in background
        (async () => {
            try {
                const scrapeResult = await scrapeUrl(validUrl.href);
                if (!scrapeResult.success) {
                    analysis.status = "failed";
                    await analysis.save();
                    return;
                }

                const aiResult = await analyzeSeoData(scrapeResult.data);
                if (!aiResult || !aiResult.success) {
                    analysis.status = "failed";
                    await analysis.save();
                    return;
                }

                analysis.overallScore = aiResult.data.overallScore || 0;
                analysis.categories = aiResult.data.categories || {};
                analysis.metadata = scrapeResult.data.metadata || {};
                analysis.headings = scrapeResult.data.headings || {};
                analysis.links = scrapeResult.data.links || {};
                analysis.images = scrapeResult.data.images || {};
                analysis.keywords = aiResult.data.keywords || [];
                analysis.issues = aiResult.data.issues || [];
                analysis.loadTime = scrapeResult.data.loadTime || 0;
                analysis.pageSize = scrapeResult.data.pageSize || 0;
                analysis.wordCount = scrapeResult.data.wordCount || 0;
                analysis.status = "completed";

                await analysis.save();
            } catch (bgError) {
                console.error("Background analysis error:", bgError.message);
                try {
                    analysis.status = "failed";
                    await analysis.save();
                } catch (saveError) {
                    console.error("Failed to save failed status:", saveError.message);
                }
            }
        })();
    } catch (error) {
        console.error("Analyze URL error:", error.message);
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: "Server error",
            });
        }
    }
};

// Get single analysis by ID
export const getAnalysis = async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);
        const analysis = await Analysis.findOne({
            _id: req.params.id,
            userId,
        });

        if (!analysis) {
            return res.status(404).json({
                success: false,
                message: "Analysis not found",
            });
        }

        return res.json({
            success: true,
            analysis,
        });
    } catch (error) {
        console.error("Get analysis error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};

// Get all analyses for logged-in user
export const getAnalyses = async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const analyses = await Analysis.find({ userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select("-issues -keywords");

        const total = await Analysis.countDocuments({ userId });

        return res.json({
            success: true,
            analyses,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error("Get analyses error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};

// Delete analysis
export const deleteAnalysis = async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);
        const analysis = await Analysis.findOneAndDelete({
            _id: req.params.id,
            userId,
        });

        if (!analysis) {
            return res.status(404).json({
                success: false,
                message: "Analysis not found",
            });
        }

        return res.json({
            success: true,
            message: "Analysis deleted",
        });
    } catch (error) {
        console.error("Delete analysis error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};