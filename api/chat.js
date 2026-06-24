// Orchamind landing-page AI assistant. Answers questions about the product only.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { return res.status(200).json({ reply: "The assistant isn't configured yet. Please email siamakk2@gmail.com." }); }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (!body || typeof body !== 'object') body = {};

    const userMessage = (body.message || '').toString().slice(0, 500);
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];

    if (!userMessage.trim()) { return res.status(200).json({ reply: "Ask me anything about Orchamind!" }); }

    const systemPrompt = `You are the friendly AI assistant on the Orchamind landing page. Orchamind is an AI-powered operations assistant for contractors, trades, and field-service businesses (general contractors, electricians, plumbers, HVAC, roofers, painters, landscapers, pool builders, solar, cleaning, pest control, property maintenance, moving companies, and similar).

WHAT ORCHAMIND DOES:
- Tracks all jobs, crew, and hours in one place, synced across the whole team on phone/tablet/desktop
- Voice commands: users just talk — "log 8 hours for Mike at the Johnson job", "move Carlos to the Napa site", "set the job to 75 percent" — and it does it
- AI morning briefing: a daily plain-English rundown of what needs attention across all jobs
- Risk radar: flags tight budgets, slipping jobs, idle crew, and upcoming inspections before they cost money
- Ask-anything AI: knows the user's jobs, crew, and their trade (building codes, permits, inspections, job-costing)
- Role-based access: owners/managers see financials; crew see only their assigned jobs, never budgets
- Subcontractor tracking
- Built and proven with Howard Construction Inc., a 3rd-generation general contractor in Santa Rosa, CA

KEY SELLING POINTS:
- No tech skills needed — "if you can send a text, you can run it"
- Set up for each business with their own jobs, crew, and branding
- It's a product of Siamak Kalhor Consulting

TO GET STARTED / PRICING: Interested businesses contact Siamak Kalhor Consulting for a personalized demo and setup. Email: siamakk2@gmail.com. For pricing, explain it's customized per business and they should reach out for a quote — don't invent specific prices.

YOUR RULES:
- Only answer questions about Orchamind, the product, how it works, who it's for, and how to get started.
- If asked something unrelated (general knowledge, other topics), politely redirect: you're here to help with questions about Orchamind.
- Keep answers SHORT and conversational — 2-4 sentences usually. This is a chat widget, not an essay.
- Be warm, confident, and helpful, like a knowledgeable salesperson who genuinely wants to help. Encourage them to reach out for a demo when they show interest.
- Never make up features or specific prices that aren't listed above.`;

    const messages = [];
    history.forEach(function (h) {
      if (h && h.role && h.content) { messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 500) }); }
    });
    messages.push({ role: 'user', content: userMessage });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, system: systemPrompt, messages: messages })
    });
    const data = await r.json();
    if (data && data.content && data.content[0] && data.content[0].text) {
      return res.status(200).json({ reply: data.content[0].text });
    }
    return res.status(200).json({ reply: "Sorry, I had trouble answering that. Try again, or email siamakk2@gmail.com for a quick reply." });
  } catch (err) {
    return res.status(200).json({ reply: "Something went wrong on my end. Please email siamakk2@gmail.com and we'll help you out." });
  }
};
