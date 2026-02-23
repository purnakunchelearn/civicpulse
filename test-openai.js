const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function testOpenAI() {
    console.log("Testing OpenAI with key from .env...");
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "user",
                    content: "Hello, are you active?"
                }
            ],
            max_tokens: 5
        });
        console.log("Success! Response:", response.choices[0].message.content);
    } catch (err) {
        console.error("OpenAI Test Failed!");
        console.error("Error Message:", err.message);
        if (err.response) {
            console.error("Status:", err.status);
            console.error("Data:", err.response.data);
        }
    }
}

testOpenAI();
