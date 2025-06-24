// server/index.js
const functions = require('firebase-functions');
const express = require('express');
const crypto = require('crypto');
const cors = require('cors'); // <--- Import the cors package

const app = express();

// Use CORS middleware
// For development, you can allow all origins.
// For production, you'd want to restrict this to your frontend's domain.
app.use(cors({ origin: true })); // <--- Add this line

// Middleware to parse JSON bodies from POST requests
app.use(express.json());

// Your existing /api/hello route
app.get('/api/hello', (req, res) => {
  functions.logger.info("Request to /api/hello received!", {structuredData: true});
  res.json({ message: 'Hello from server API via Firebase Functions!' });
});

// NEW: Endpoint to generate a hash
app.post('/api/generate-hash', (req, res) => {
  const { textToHash } = req.body;

  if (typeof textToHash !== 'string') {
    functions.logger.error("Bad request to /api/generate-hash: textToHash is missing or not a string", req.body);
    return res.status(400).json({ error: 'Please provide a "textToHash" string in the request body.' });
  }

  try {
    const hash = crypto.createHash('sha256').update(textToHash).digest('hex');
    functions.logger.info(`Generated SHA-256 hash for: "${textToHash}"`, { originalText: textToHash, generatedHash: hash });
    res.status(200).json({ originalText: textToHash, hash: hash });
  } catch (error) {
    functions.logger.error("Error generating hash:", error);
    res.status(500).json({ error: 'Internal server error while generating hash.' });
  }
});

//exports.api = functions.https.onRequest(app);
// New code to specify the region
exports.api = functions.region('us-west2').https.onRequest(app);