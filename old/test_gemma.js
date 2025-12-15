import 'dotenv/config';

const apiKey = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1/models/gemma-3-27b:generateContent?key=${apiKey}`;

const body = {
  contents: [{
    parts: [{ text: 'Say hello in exactly 2 words' }]
  }]
};

console.log('Testing gemma-3-27b with v1 API...');

fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})
.then(r => r.json())
.then(data => {
  if (data.error) {
    console.log('ERROR:', JSON.stringify(data.error, null, 2));
  } else if (data.candidates) {
    console.log('SUCCESS! Response:', data.candidates[0].content.parts[0].text);
  } else {
    console.log('UNEXPECTED:', JSON.stringify(data, null, 2));
  }
})
.catch(err => console.error('FETCH ERROR:', err));
