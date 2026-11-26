
import jwt from "jsonwebtoken";

const auth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "No token provided"
            });
        }

        const token = authHeader.split(" ")[1];

        if (!process.env.JWT_SECRET) {
            console.error("JWT_SECRET is missing from environment variables");

            return res.status(500).json({
                success: false,
                message: "Server authentication configuration error"
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded.id) {
            return res.status(401).json({
                success: false,
                message: "Invalid token payload"
            });
        }

        // Keep this property name consistent with rankController.js
        req.userID = decoded.id;

        next();

    } catch (error) {
        console.error("Authentication error:", error.message);

        return res.status(401).json({
            success: false,
            message: "Not authorized, token failed"
        });
    }
};

export default auth;
