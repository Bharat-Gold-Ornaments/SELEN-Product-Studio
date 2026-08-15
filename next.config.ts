import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Leonardo-generated image CDN.
      { protocol: "https", hostname: "cdn.leonardo.ai" },
      // Google Drive public file links.
      { protocol: "https", hostname: "drive.google.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // Shopify CDN, once images are attached to products.
      { protocol: "https", hostname: "cdn.shopify.com" },
    ],
  },
  webpack: (config) => {
    // Opt-in polling fallback for `next dev` on Windows. Native OS file
    // watching (libuv's fs-event backend) can crash there with
    // "Assertion failed: !_wcsnicmp(filename, dir, dirlen)" — most often
    // when the project lives inside a cloud-synced folder (OneDrive,
    // Dropbox). Moving the project to a plain local path fixes it for most
    // people; this env var is a fallback for anyone who still hits it.
    // Usage: set WATCH_POLL=1 before `npm run dev`.
    if (process.env.WATCH_POLL === "1") {
      config.watchOptions = {
        poll: 800,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};

export default nextConfig;
