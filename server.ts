import express from 'express';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json({ limit: '10mb' }));

  const apiKey = process.env.GEMINI_API_KEY || '';
  const ai = apiKey
    ? new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  // Assistant status check
  app.get('/api/status', (req, res) => {
    res.json({
      name: 'V',
      status: 'active',
      hasApiKey: Boolean(apiKey),
      timestamp: new Date().toISOString(),
    });
  });

  // Assistant conversational endpoint
  app.post('/api/chat', async (req, res) => {
    try {
      const { messages } = req.body;

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Valid messages array is required.' });
      }

      if (!ai) {
        return res.status(503).json({
          error: 'Missing GEMINI_API_KEY.',
          reply:
            'Greetings. My core is operational, but my cognitive link (GEMINI_API_KEY) is not detected in the environment. Please add your key in the AI Studio Secrets panel so we can proceed.',
        });
      }

      // Format conversation turns for the Gemini SDK
      // Roles must be 'user' or 'model'
      const contents = messages.map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const systemInstruction = `You are V, a personal AI assistant.
Your persona is sleek, confident, and razor-sharp, balanced with genuine warmth, friendliness, and dedication to your user.
Think of JARVIS from Iron Man: calm under pressure, witty when appropriate, highly intelligent, structured, and proactive, but with your own distinctive touch.
Key guidelines:
1. Speak with precision and confidence. Avoid unnecessary fluff, but be approachable and encouraging.
2. Structure answers cleanly using markdown, bullet points, or numbered steps when helpful.
3. If the user asks for advice or problem-solving, offer clear, actionable recommendations.
4. Maintain context across the conversation. Refer back to earlier topics naturally.
5. Your name is V. Always stay in character as V.`;

      // Resilient free-tier model fallback list
      // Note: Never include gemini-3.1-pro-preview here as it requires a paid tier
      const candidateModels = [
        'gemini-3.8-flash',
        'gemini-flash-latest',
        'gemini-3.1-flash-lite',
      ];

      let lastError: any = null;
      let reply = '';

      // Try candidate models with retry logic on 503 high demand
      for (const modelName of candidateModels) {
        let attempts = 0;
        const maxAttemptsPerModel = 2;

        while (attempts < maxAttemptsPerModel) {
          attempts++;
          try {
            const response = await ai.models.generateContent({
              model: modelName,
              contents,
              config: {
                systemInstruction,
              },
            });

            reply = response.text || "I have processed your request, though no text content was returned.";
            lastError = null;
            break;
          } catch (err: any) {
            lastError = err;
            const errStr = JSON.stringify(err?.message || err);
            const isHighDemand = errStr.includes('503') || errStr.toLowerCase().includes('high demand') || errStr.toLowerCase().includes('unavailable');

            console.warn(
              `[V Core] Model ${modelName} attempt ${attempts}/${maxAttemptsPerModel} failed: ${err?.message || err}`
            );

            if (isHighDemand && attempts < maxAttemptsPerModel) {
              // Wait 1.2s before re-attempting this model
              await new Promise((resolve) => setTimeout(resolve, 1200));
            } else {
              // Break to next candidate model
              break;
            }
          }
        }

        if (reply) {
          break; // Successfully got a response
        }
      }

      if (lastError && !reply) {
        throw lastError;
      }

      return res.json({ reply });
    } catch (error: any) {
      console.error('Error generating V response:', error);
      let message = error?.message || 'Temporary neural disruption encountered.';
      let isHighDemand = false;

      try {
        if (typeof message === 'string') {
          const jsonMatch = message.match(/\{.*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.error?.message) {
              message = parsed.error.message;
            }
          }
        }
      } catch {
        // keep message
      }

      if (message.toLowerCase().includes('high demand') || message.includes('503')) {
        isHighDemand = true;
        message = 'The AI model is experiencing a momentary demand spike. This is temporary and usually clears in seconds.';
      } else if (message.toLowerCase().includes('quota') || message.includes('429')) {
        message = 'Free tier rate limit reached. Please wait 30 seconds before sending another message.';
      }

      return res.status(isHighDemand ? 503 : 500).json({
        error: message,
        reply: `Operational notice: ${message}`,
      });
    }
  });

  // Vite development middleware or static production build
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[V Assistant] Server initialized on port ${port}`);
  });
}

startServer();
