// server/index.js

// Use the v2 onRequest function for HTTP triggers
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

// Import necessary modules
const admin = require('firebase-admin');
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// --- Import the FSM logic ---
const fsm = require('./fsm.js');

// Initialize the Firebase Admin SDK.
admin.initializeApp();
const db = getFirestore();

// --- Hashing Helper Functions (Server-Side) ---
function getCanonicalString(obj) {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return `[${obj.map(item => getCanonicalString(item)).join(',')}]`;
    }
    const sortedKeys = Object.keys(obj).sort();
    const keyValuePairs = sortedKeys.map(key => {
        const value = getCanonicalString(obj[key]);
        return `${JSON.stringify(key)}:${value}`;
    });
    return `{${keyValuePairs.join(',')}}`;
}

function getObjectToHash(logEntry) {
    const { currentEntryChainHash, ...entryToHash } = logEntry;
    return entryToHash;
}

function calculateEntryHash(logEntry) {
    const objectToHash = getObjectToHash(logEntry);
    const canonicalString = getCanonicalString(objectToHash);
    return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

// --- Verification Functions ---

function verifyHashChain(gameLog) {
    let previousHash = "0".repeat(64);
    for (const entry of gameLog) {
        if (entry.previousEntryChainHash !== previousHash) {
            logger.error("Hash chain broken!", { sequence: entry.sequence, expected: previousHash, found: entry.previousEntryChainHash });
            return false;
        }
        const recalculatedHash = calculateEntryHash(entry);
        if (recalculatedHash !== entry.currentEntryChainHash) {
            logger.error("Entry hash mismatch! Data may be tampered.", { sequence: entry.sequence, calculated: recalculatedHash, stored: entry.currentEntryChainHash });
            return false;
        }
        previousHash = entry.currentEntryChainHash;
    }
    logger.info("Hash chain successfully verified.");
    return true;
}

/**
 * Verifies the gameplay logic by re-simulating the game using the FSM.
 * Includes a final state check to prevent false win claims.
 * @param {Array<object>} gameLog - The array of decrypted game log entries.
 * @param {string} playerX_Id - The ID of Player X for this game.
 * @param {string} playerO_Id - The ID of Player O for this game.
 * @returns {boolean} True if the gameplay is valid according to the FSM, false otherwise.
 */
function verifyFsmGameplay(gameLog, playerX_Id, playerO_Id) {
    // Start with the initial game state from our trusted FSM module
    let serverGameState = fsm.getInitialGameState(playerX_Id, playerO_Id);
    
    // We only need to simulate based on validated moves.
    const validatedMoves = gameLog.filter(entry => entry.eventType === 'PLAYER_MOVE_VALIDATED');

    for (const moveEntry of validatedMoves) {
        const eventData = {
            move: moveEntry.eventData.move,
            playerId: moveEntry.eventData.playerId
        };

        // Get the FSM's result for this move based on our current server state
        const transitionResult = fsm.transition(serverGameState, fsm.EVENTS.PLAYER_MOVE_ATTEMPTED, eventData);

        // Check 1: Was the move considered valid by our server-side FSM?
        if (!transitionResult.isValidMove) {
            logger.error("FSM re-simulation failed: A move considered valid by the client was rejected by the server FSM.", { sequence: moveEntry.sequence });
            return false;
        }

        // Check 2: Does the FSM state recorded in the log match our simulation?
        if (transitionResult.newState !== moveEntry.fsmState) {
            logger.error("FSM state mismatch!", { sequence: moveEntry.sequence, expected: transitionResult.newState, found: moveEntry.fsmState });
            return false;
        }

        // Check 3: Does the board state hash recorded in the log match our simulation?
        const serverNewBoardHash = crypto.createHash('sha256').update(getCanonicalString(transitionResult.newBoard)).digest('hex');
        const clientNewBoardHash = crypto.createHash('sha256').update(getCanonicalString(moveEntry.boardState)).digest('hex');

        if(serverNewBoardHash !== clientNewBoardHash) {
            logger.error("FSM board state mismatch!", { sequence: moveEntry.sequence });
            return false;
        }

        // If all checks pass, update our server's game state for the next iteration
        serverGameState = {
            ...serverGameState, // carry over player IDs
            currentState: transitionResult.newState,
            board: transitionResult.newBoard
        };
    }
    
    // Final State Verification
    const serverFinalState = serverGameState.currentState;
    const clientFinalLogEntry = gameLog[gameLog.length - 1];
    
    if (!clientFinalLogEntry.eventType.startsWith('GAME_')) {
        logger.error("FSM final state error: Final log entry is not a game over event.");
        return false;
    }

    if (clientFinalLogEntry.fsmState !== serverFinalState) {
        logger.error("FSM final state mismatch!", { expectedByServer: serverFinalState, reportedByClient: clientFinalLogEntry.fsmState });
        return false;
    }

    logger.info("FSM gameplay successfully verified.");
    return true;
}

// --- NEW: App Check Verification Middleware ---
const appCheckVerification = async (req, res, next) => {
    const appCheckToken = req.header("X-Firebase-AppCheck");
  
    if (!appCheckToken) {
        res.status(401).send("Unauthorized");
      return;
    }
  
    try {
      await admin.appCheck().verifyToken(appCheckToken);
      next(); // If token is valid, proceed to the next handler
    } catch (err) {
        res.status(401).send("Unauthorized");
    }
  };

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// --- USE THE MIDDLEWARE ---
// This line tells Express to run our verification on every single request
// --- USE THE MIDDLEWARE CONDITIONALLY ---
// Only enforce App Check if the debug flag is NOT set to "true"
if (process.env.APP_CHECK_DEBUG !== "true") {
    //app.use('/api', appCheckVerification);
    app.use(appCheckVerification);
    logger.info("App Check middleware ENABLED.");
  } else {
    logger.warn("App Check middleware is DISABLED for local development.");
  }


// --- API Routes ---
app.post('/api/create-game', async (req, res) => {
    logger.info("Request received for /api/create-game");
    try {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });

        // ---vvv--- CHANGE IS HERE ---vvv---
        const gameRef = await db.collection('games').add({
            privateKeyPem: privateKey,
            playerX_Id: "DOGE", // Changed from "playerX"
            playerO_Id: "PEPE", // Changed from "playerO"
            createdAt: FieldValue.serverTimestamp(),
            fsmState: 'PLAYER_X_TURN'
        });
        // ---^^^--- END OF CHANGE ---^^^---

        const gameId = gameRef.id;
        logger.info(`New game created with ID: ${gameId}`);
        res.status(200).json({ gameId: gameId, publicKeyPem: publicKey });
    } catch (error) {
        logger.error("Error creating new game:", error);
        res.status(500).json({ error: 'Failed to create new game.' });
    }
});

app.post('/api/submit-log', async (req, res) => {
    // This function is updated with the final verification step
    const { gameId, encryptedLog, encryptedKey, iv } = req.body;
    logger.info(`Received log submission for gameId: ${gameId}`);
    if (!gameId || !encryptedLog || !encryptedKey || !iv) {
        return res.status(400).json({ error: 'Request body must contain all required fields.' });
    }

    try {
        // Step 1: Retrieve Private Key
        const gameDoc = await db.collection('games').doc(gameId).get();
        if (!gameDoc.exists) return res.status(404).json({ error: "Game session not found." });
        const { privateKeyPem, playerX_Id, playerO_Id } = gameDoc.data();
        if (!privateKeyPem) return res.status(500).json({ error: "Key not found." });

        // Step 2 & 3: Decrypt Log
        const encryptedKeyBuffer = Buffer.from(encryptedKey, 'base64');
        const decryptedSymmetricKey = crypto.privateDecrypt({ key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, encryptedKeyBuffer);
        const encryptedLogBuffer = Buffer.from(encryptedLog, 'base64');
        const ivBuffer = Buffer.from(iv, 'base64');
        const authTag = encryptedLogBuffer.slice(encryptedLogBuffer.length - 16);
        const ciphertext = encryptedLogBuffer.slice(0, encryptedLogBuffer.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', decryptedSymmetricKey, ivBuffer);
        decipher.setAuthTag(authTag);
        const decryptedLogString = decipher.update(ciphertext, 'utf8', 'utf8') + decipher.final('utf8');
        const gameLog = JSON.parse(decryptedLogString);
        logger.info(`Successfully decrypted log for gameId: ${gameId}.`);
        
        // Step 4: Verify Hash Chain
        const isChainValid = verifyHashChain(gameLog);
        if (!isChainValid) {
            return res.status(400).json({ status: "verification_failed", reason: "Hash chain mismatch." });
        }

        // --- Step 5: NEW - Verify FSM Gameplay ---
        const isFsmValid = verifyFsmGameplay(gameLog, playerX_Id, playerO_Id);
        if (!isFsmValid) {
            return res.status(400).json({ status: "verification_failed", reason: "FSM gameplay mismatch." });
        }

        // If all checks pass, the log is fully verified.
        res.status(200).json({ status: "verified", message: "Log successfully decrypted and all integrity checks passed." });

    } catch (error) {
        logger.error(`Failed to process log for gameId: ${gameId}`, error);
        res.status(500).json({ error: "An error occurred during log processing." });
    }
});

// Export the Express app, specifying the region for the function
exports.api = onRequest(
    { 
        region: "us-west2", 
        enforceAppCheck: true,
        consumeAppCheckToken: true, 
    }, 
    app
);