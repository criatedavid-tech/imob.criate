import dotenv from "dotenv";
dotenv.config();
console.log("SUPABASE_KEY:", process.env.SUPABASE_KEY ? process.env.SUPABASE_KEY.substring(0, 10) + "..." : "NOT SET");
console.log("SUPABASE_ANON_KEY:", process.env.SUPABASE_ANON_KEY ? process.env.SUPABASE_ANON_KEY.substring(0, 10) + "..." + process.env.SUPABASE_ANON_KEY.slice(-5) : "NOT SET");
