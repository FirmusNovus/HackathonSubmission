// Tiny path-routing proxy: one public ngrok URL, two services behind it.
//
//   https://<ngrok>/issuer/*    →  http://localhost:3001/*
//   https://<ngrok>/verifier/*  →  http://localhost:3002/*
//
// Required because ngrok free tier collapses multiple tunnels into the same
// subdomain. With a single tunnel + path prefixes, we sidestep the issue.

import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const PORT = process.env.PORT ?? 3000;

const app = express();

app.get("/", (req, res) => {
  res.send(`<!doctype html>
<html><head><title>Lex Nova spike</title>
<style>body{font-family:monospace;max-width:680px;margin:2rem auto;padding:1rem}
a{display:inline-block;background:#0070ff;color:white;padding:0.75rem 1.5rem;text-decoration:none;border-radius:4px;margin:0.5rem}
</style></head><body>
<h1>Lex Nova spike</h1>
<p>One public URL routes to two services. Pick a side:</p>
<a href="/issuer/">→ Issuer (bar association)</a>
<a href="/verifier/">→ Verifier (platform)</a>
</body></html>`);
});

// (No redirects — operator UIs compute URLs from window.location, so they
//  work whether the path has a trailing slash or not.)

app.use(
  "/issuer",
  createProxyMiddleware({
    target: "http://localhost:3001",
    changeOrigin: true,
    pathRewrite: { "^/issuer": "" },
    // forward as-is, including request body
    selfHandleResponse: false,
  })
);

app.use(
  "/verifier",
  createProxyMiddleware({
    target: "http://localhost:3002",
    changeOrigin: true,
    pathRewrite: { "^/verifier": "" },
    selfHandleResponse: false,
  })
);

app.listen(PORT, () => {
  console.log(`Lex spike proxy listening on port ${PORT}`);
  console.log(`  /issuer/*    → http://localhost:3001/*`);
  console.log(`  /verifier/*  → http://localhost:3002/*`);
});
