import KeywordTracking from "../models/keywordTracking.js";
import { keywordTracking } from "../services/keywordTrackingService.js";

// Get authenticated user ID (supports both req.userId and req.userID)
const getAuthenticatedUserId = (req) => {
    return req.userId || req.userID;
};

// Add a keyword to track
export const addKeyword = async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        const { keyword, url } = req.body;

        if (!keyword?.trim() || !url?.trim()) {
            return res.status(400).json({
                success: false,
                message: "Keyword and URL are required"
            });
        }

        let normalizedUrl;
        let domain;

        try {
            normalizedUrl = /^https?:\/\//i.test(url.trim())
                ? url.trim()
                : `https://${url.trim()}`;

            const urlObj = new URL(normalizedUrl);

            domain = urlObj.hostname
                .replace(/^www\./i, "")
                .toLowerCase();

        } catch {
            return res.status(400).json({
                success: false,
                message: "Invalid URL format"
            });
        }

        const normalizedKeyword = keyword.trim().toLowerCase();

        const existing = await KeywordTracking.findOne({
            userId,
            keyword: normalizedKeyword,
            domain
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: "Keyword is already being tracked for this domain"
            });
        }

        const tracking = await KeywordTracking.create({
            userId,
            keyword: normalizedKeyword,
            url: normalizedUrl,
            domain,
            status: "checking"
        });

        // Respond before starting the ranking check
        res.status(201).json({
            success: true,
            message: "Keyword tracking added successfully",
            tracking
        });

        // Run ranking check in the background
        Promise.resolve()
            .then(() => keywordTracking(tracking))
            .catch((error) => {
                console.error("Background keyword tracking error:", error);
            });

    } catch (error) {
        console.error("Add keyword error:", error);

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "Keyword is already being tracked for this domain"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

// Get all tracked keywords
export const getKeywords = async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        const keywords = await KeywordTracking.find({ userId })
            .sort({ createdAt: -1 })
            .select("-rankHistory");

        return res.json({
            success: true,
            keywords
        });

    } catch (error) {
        console.error("Get keywords error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// Get single keyword with full history
export const getKeyword = async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);

        const tracking = await KeywordTracking.findOne({
            _id: req.params.id,
            userId
        });

        if (!tracking) {
            return res.status(404).json({
                success: false,
                message: "Keyword tracking not found"
            });
        }

        return res.json({
            success: true,
            tracking
        });

    } catch (error) {
        console.error("Get keyword error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// Manually refresh keyword ranking
export const refreshKeyword = async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);

        const tracking = await KeywordTracking.findOne({
            _id: req.params.id,
            userId
        });

        if (!tracking) {
            return res.status(404).json({
                success: false,
                message: "Keyword tracking not found"
            });
        }

        tracking.status = "checking";
        await tracking.save();

        res.json({
            success: true,
            message: "Rank check started"
        });

        Promise.resolve()
            .then(() => keywordTracking(tracking))
            .catch((error) => {
                console.error("Refresh tracking error:", error);
            });

    } catch (error) {
        console.error("Refresh keyword error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// Delete tracked keyword
export const deleteKeyword = async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);

        const tracking = await KeywordTracking.findOneAndDelete({
            _id: req.params.id,
            userId
        });

        if (!tracking) {
            return res.status(404).json({
                success: false,
                message: "Keyword tracking not found"
            });
        }

        return res.json({
            success: true,
            message: "Keyword tracking deleted"
        });

    } catch (error) {
        console.error("Delete keyword error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// Toggle tracking active/inactive
export const toggleTracking = async (req, res) => {
    try {
        const userId = getAuthenticatedUserId(req);

        const tracking = await KeywordTracking.findOne({
            _id: req.params.id,
            userId
        });

        if (!tracking) {
            return res.status(404).json({
                success: false,
                message: "Keyword tracking not found"
            });
        }

        tracking.active = !tracking.active;
        await tracking.save();

        return res.json({
            success: true,
            tracking
        });

    } catch (error) {
        console.error("Toggle tracking error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};