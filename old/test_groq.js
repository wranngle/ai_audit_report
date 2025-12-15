import 'dotenv/config';

const apiKey = 'process.env.GROQ_API_KEY';
const url = 'https://api.groq.com/openai/v1/chat/completions';

const body = {
  model: 'llama-3.3-70b-versatile', // Fast, high-quality model
  messages: [
    {
      role: 'user',
      content: 'Say "Hello from Groq!" in exactly 3 words.'
    }
  ],
  temperature: 0.5,
  max_tokens: 100
};

console.log('Testing Groq API with llama-3.3-70b-versatile...\n');

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
    console.log('Response:', data.choices[0].message.content);
    console.log('\nUsage:');
    console.log('  Prompt tokens:', data.usage.prompt_tokens);
    console.log('  Completion tokens:', data.usage.completion_tokens);
    console.log('  Total tokens:', data.usage.total_tokens);
  } else {
    console.log('UNEXPECTED:', JSON.stringify(data, null, 2));
  }
})
.catch(err => console.error('FETCH ERROR:', err));
