// proxy/index.js

//require('dotenv').config();
const path = require('path');
if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.log('Emulator detected: Load .env.local file');
    require('dotenv').config({ path: path.resolve(__dirname, '.env.local') });
} else {
  console.log('Emulator detected: Load .env.staging file');
  require('dotenv').config({ path: path.resolve(__dirname, '.env.staging') });  
}

//const functions = require("firebase-functions/v2/https");
// Use the v2 onRequest function for HTTP triggers
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const express = require("express");
const { GoogleAuth } = require("google-auth-library");

const app = express();
const auth = new GoogleAuth();

// --- ADD THESE TWO LINES ---
const admin = require("firebase-admin");
admin.initializeApp();
// -------------------------

// --- App Check Verification Middleware ---
const appCheckVerification = async (req, res, next) => {
  const appCheckToken = req.header("X-Firebase-AppCheck");
  if (!appCheckToken) {
      logger.info("Unauthorized Now");
      return res.status(401).send("Unauthorized Now");
  }
  try {
      await admin.appCheck().verifyToken(appCheckToken);
      next(); // Token is valid, proceed.
  } catch (err) {
    logger.info("Unauthorized Now 2");
    logger.info(err);
      res.status(401).send("Unauthorized Now 2");
  }
};

// --- Use the middleware ---
//app.use(appCheckVerification);

// --- Emulator-Aware Configuration ---

// This is the real, live URL of your private backend function.
const LIVE_API_URL = process.env.LIVE_API_URL;

// This is the local emulator URL for your private backend function.
const EMULATOR_API_URL = process.env.EMULATOR_API_URL;

const IS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';

// --- End of Configuration ---

if (process.env.APP_CHECK_DEBUG !== 'true') {
    app.use(appCheckVerification);
    logger.info("App Check middleware ENABLED.");
  } else {
    logger.warn("App Check middleware is DISABLED for local development use.");
  }

// Middleware to forward requests
app.use("/*", async (req, res) => {
  logger.info("Inside of proxy app.use generic");
  // Determine the correct backend URL based on the environment.
    const backendUrl = IS_EMULATOR ? EMULATOR_API_URL : LIVE_API_URL;
  
    // --- NEW: Transform the path for the backend request ---
    // This replaces the incoming '/proxy' with the '/api' that the backend expects.
    const backendPath = req.originalUrl.replace(/^\/proxy/, '/api');
    const requestUrl = `${backendUrl}${backendPath}`;
    // -----------------------------------------------------

    try {
      let client;
      let serviceRequestOptions = {
        url: requestUrl,
        method: req.method,
        data: req.body,
        headers: {},
        responseType: 'json'
      };
  
      // In a live environment, we need to get an ID token to authenticate.
      // In the emulator, we can call the other function directly.
      if (!IS_EMULATOR) {
        client = await auth.getIdTokenClient(backendUrl);
        const clientHeaders = await client.getRequestHeaders();
        serviceRequestOptions.headers['Authorization'] = clientHeaders['Authorization'];
      }
  
      // Make the request to the private backend.
      // We use a simple fetch for the emulator or the authenticated client for live.
      const fetch = (await import('node-fetch')).default;
      const response = IS_EMULATOR 
        ? await fetch(serviceRequestOptions.url, { method: serviceRequestOptions.method, body: JSON.stringify(serviceRequestOptions.data), headers: {'Content-Type': 'application/json'} })
        : await client.request(serviceRequestOptions);
  
      const data = IS_EMULATOR ? await response.json() : response.data;
      const status = IS_EMULATOR ? response.status : response.status;
  
      // Send the backend's response back to the original caller.
      res.status(status).json(data);
  
    } catch (error) {
      console.error("Proxy error:", error.response?.data || error.message);
      res.status(500).send("Proxy error.");
    }
  });
  
  // Export the proxy function, ensuring App Check is OFF for the proxy itself.
  //exports.proxy = onRequest({ region: "us-west2" }, app);
exports.proxy = onRequest(
    { 
        region: "us-west2", 
        enforceAppCheck: true,
        consumeAppCheckToken: true, 
    }, 
    app
);