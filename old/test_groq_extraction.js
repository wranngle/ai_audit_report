import 'dotenv/config';

const apiKey = 'process.env.GROQ_API_KEY';
const url = 'https://api.groq.com/openai/v1/chat/completions';

// Simulate a real extraction task
const systemPrompt = `You are a data extraction specialist. Extract structured JSON from the input text. Output ONLY valid JSON, no markdown, no explanation.`;

const userPrompt = `Extract the following into JSON:

Input: "ABC Corp has 50 employees processing 200 invoices per month. Average processing time is 4 hours per invoice. Error rate is about 15%."

Output format:
{
  "company": "...",
  "volume": {...},
  "metrics": [...]
}`;

const body = {
  model: 'llama-3.3-70b-versatile',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ],
  temperature: 0.3,
  max_tokens: 1000
};

console.log('Testing Groq API with extraction task...\n');

fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(body)
})
.then(r => r.json())
.then(data => {
  if (data.error) {
    console.log('ERROR:', JSON.stringify(data.error, null, 2));
  } else if (data.choices && data.choices[0]) {
    console.log('SUCCESS!');
    console.log('Model:', data.model);
    console.log('\nResponse:');
    console.log(data.choices[0].message.content);

    // Try parsing as JSON
    try {
      const jsonText = data.choices[0].message.content.trim()
        .replace(/^```json\n/, '')
        .replace(/^```\n/, '')
        .replace(/\n```$/, '');
      const parsed = JSON.parse(jsonText);
      console.log('\n✓ Valid JSON parsed successfully!');
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('\n⚠️  JSON parsing failed:', e.message);
    }

    console.log('\nUsage:');
    console.log('  Total tokens:', data.usage.total_tokens);
  } else {
    console.log('UNEXPECTED:', JSON.stringify(data, null, 2));
  }
})
.catch(err => console.error('FETCH ERROR:', err));
