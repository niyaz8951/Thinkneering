// functions/api/ask/index.js
// Natural-language Q&A endpoint (separate from compliance engine)

export async function onRequestPost(context) {
  const { request, env } = context;

  const { question } = await request.json();
  if (!question) {
    return new Response(JSON.stringify({ error: "Missing 'question' field" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const systemPrompt = `
You are a clear, factual engineering assistant.
Answer in natural language.
Use datasheet facts only when provided.
Never invent specifications, dimensions, or ratings.
If the user asks about compliance, explain it conceptually — do not output compliance statuses.
Keep answers concise, helpful, and conversational.
  `;

  const userPrompt = `
User question:
${question}
  `;

  const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });

  return new Response(JSON.stringify({ answer: response }), {
    headers: { "Content-Type": "application/json" }
  });
}
