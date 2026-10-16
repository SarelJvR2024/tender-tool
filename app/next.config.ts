import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // Default is 1MB, which a scanned reference letter / completion
      // certificate, CV or vault document (uploaded via Server Actions on
      // /experience, /people/[id] and /company) can easily exceed.
      //
      // Raised from 4mb to 4.5mb (Sarel, 2026-10-16: "would rather increase
      // it"). 4.5 MB is the ceiling, not a choice: Vercel Functions reject any
      // request body over 4.5 MB with 413 FUNCTION_PAYLOAD_TOO_LARGE
      // (vercel.com/docs/functions/limitations, "Request body size"), before
      // Next.js ever sees it, so a 15-20mb setting here would only move the
      // failure from a clear Next.js error to a Vercel 413. The multipart
      // overhead around the file (~10-20 KB) means the largest file that
      // actually fits is ~4.4 MB - the cap /company enforces with a friendly
      // message. Going genuinely bigger needs a direct browser-to-Supabase
      // Storage upload (createSignedUploadUrl), which bypasses the function
      // body entirely - not built yet.
      bodySizeLimit: "4.5mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
