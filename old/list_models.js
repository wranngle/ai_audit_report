import 'dotenv/config';

const apiKey = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;

console.log('Fetching available models...\n');

fetch(url)
.then(r => r.json())
.then(data => {
  if (data.models) {
    const generateModels = data.models.filter(m =>
      m.supportedGenerationMethods?.includes('generateContent')
    );

    console.log('Models supporting generateContent:');
    generateModels.forEach(m => {
      console.log(`  - ${m.name.replace('models/', '')}`);
    });
    console.log(`\nTotal: ${generateModels.length} models`);
  } else {
    console.log('ERROR:', JSON.stringify(data, null, 2));
  }
})
.catch(err => console.error('FETCH ERROR:', err));
