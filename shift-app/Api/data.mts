import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import * as crypto from "crypto";

const VALID_STORES = [
  "users",
  "shifts",
  "registrations",
  "cancellationRequests",
  "inviteCodes",
  "googleCalendarSettings",
];

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-me";
const RATE_LIMIT_MAP = new Map<string, number[]>();

// Password hashing utilities
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + JWT_SECRET).digest("hex");
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

// JWT utilities
function createJWT(userId: number, email: string): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      userId,
      email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400 * 7,
    })
  );
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `${header}.${payload}.${signature}`;
}

function verifyJWT(token: string): { userId: number; email: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1]));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) return null;

    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

// Rate limiting
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const limit = 5;
  const window = 60000;

  if (!RATE_LIMIT_MAP.has(ip)) {
    RATE_LIMIT_MAP.set(ip, [now]);
    return true;
  }

  const times = RATE_LIMIT_MAP.get(ip)!.filter((t) => now - t < window);
  if (times.length >= limit) {
    return false;
  }

  times.push(now);
  RATE_LIMIT_MAP.set(ip, times);
  return true;
}

// CORS headers
function getCORSHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// Handle OPTIONS request (CORS preflight)
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders(),
  });
}

// Main handler
export default async (req: Request, context: Context) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleOptions();
  }

  const url = new URL(req.url);
  const path = url.pathname;
  const ip = context.clientContext?.ip || "unknown";

  // Rate limiting
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json", ...getCORSHeaders() },
    });
  }

  try {
    // Handle GET /api/data - get all data
    if (path === "/.netlify/functions/data" && req.method === "GET") {
      const store = getStore("data");
      
      try {
        const data = await store.get("all");
        const parsed = data ? JSON.parse(data) : {};
        
        return new Response(JSON.stringify(parsed), {
          status: 200,
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        });
      } catch {
        // Return empty object if no data exists yet
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        });
      }
    }

    // Handle POST /api/data/[store] - save data
    if (path.startsWith("/.netlify/functions/data/") && req.method === "POST") {
      const storeName = path.split("/").pop();
      
      if (!storeName || !VALID_STORES.includes(storeName)) {
        return new Response(JSON.stringify({ error: "Invalid store" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        });
      }

      const body = await req.json();
      const store = getStore("data");
      
      // Get existing data
      let allData: Record<string, any> = {};
      try {
        const existing = await store.get("all");
        if (existing) {
          allData = JSON.parse(existing);
        }
      } catch {
        allData = {};
      }

      // Update the store
      allData[storeName] = body;
      await store.set("all", JSON.stringify(allData));

      return new Response(JSON.stringify({ success: true, store: storeName }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...getCORSHeaders() },
      });
    }

    // Route not found
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...getCORSHeaders() },
    });
  } catch (error) {
    console.error("API Error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...getCORSHeaders() },
      }
    );
  }
};

export const config: Config = {
  path: "/.netlify/functions/data",
};
