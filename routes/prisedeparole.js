const User = require('../models/User');

const express = require('express');
const router = express.Router();
const axios = require('axios');

router.post('/', async (req, res) => {
  const { question } = req.body;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "Tu aides à rédiger des discours inspirés : éloges funèbres, discours de mariage, intentions de prière. Ton ton est respectueux, structuré, incarné et sobre, toujours adapté au contexte humain et spirituel."
          },
          {
            role: "user",
            content: question
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ reply: response.data.choices[0].message.content });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Erreur lors de la réponse de l'IA." });
  }
});

module.exports = router;