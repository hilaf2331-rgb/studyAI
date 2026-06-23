import type { VercelRequest, VercelResponse } from '@vercel/node';

// Node serverless runtime — no import.meta.env here (that's Vite-only), so
// the backend URL comes from a plain process env var instead, mirroring how
// lib/api-base.ts resolves it for the browser bundle.
const API_BASE_URL = process.env.API_URL ?? "https://studyai-zhyy.onrender.com";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;
  const targetUrl = `${API_BASE_URL}/api/materials/${id}/generate-all`;
  
  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Proxy failed' });
  }
}
