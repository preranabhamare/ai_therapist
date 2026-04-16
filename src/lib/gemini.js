const geminiApiKey = process.env.REACT_APP_GEMINI_API_KEY;
const geminiModel = process.env.REACT_APP_GEMINI_MODEL ;

export const hasGeminiConfig = Boolean(geminiApiKey);

const THERAPIST_SYSTEM_PROMPT = `You are a supportive AI wellness companion inside a mental health app.
Keep responses empathetic, calm, practical, and concise.
Do not claim to be a licensed therapist.
Do not provide diagnosis.
Encourage professional or emergency help if the user mentions self-harm, suicide, or immediate danger.
Focus on reflective listening, grounding, coping strategies, and helpful next steps.`;

function toGeminiContents(messages) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.text }],
    }));
}

export async function generateGeminiReply(messages) {
  if (!hasGeminiConfig) {
    throw new Error('Gemini API key is missing. Add REACT_APP_GEMINI_API_KEY to continue.');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: THERAPIST_SYSTEM_PROMPT }],
        },
        contents: toGeminiContents(messages),
        generationConfig: {
          temperature: 0.8,
          topP: 0.95,
          maxOutputTokens: 400,
        },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || 'Gemini request failed.');
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();

  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  return {
    text,
    model: data?.modelVersion || geminiModel,
  };
}
