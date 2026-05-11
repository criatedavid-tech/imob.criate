import dotenv from 'dotenv';
dotenv.config();
console.log("GEMINI", process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 5) + "..." : "UNSET");
