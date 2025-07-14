// client/main.js

// --- MODULE IMPORTS ---
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// We will add App Check back in the next step.
import { initializeAppCheck, ReCaptchaV3Provider, getToken} from "firebase/app-check";
// Import the game logic from our local file
import { STATES, EVENTS, transition, getInitialGameState } from './fsm.js';


// --- FIREBASE INITIALIZATION ---
// Your web app's Firebase configuration
// Vite automatically selects the correct .env file based on the environment
const firebaseConfig = {
    apiKey: import.meta.env.VITE_API_KEY,
    authDomain: import.meta.env.VITE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

let appCheck; // <-- Define appCheck outside the block

// --- INITIALIZE APP CHECK CONDITIONALLY ---
if (import.meta.env.VITE_APP_CHECK_DEBUG !== "true") {
  appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true
  });
  console.log("App Check ENABLED.");
} else {
  console.warn("App Check is DISABLED for local development.");
}

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element References ---
    const boardElement = document.getElementById('game-board');
    const statusElement = document.getElementById('game-status');
    const restartButton = document.getElementById('restart-button');

    // --- Game Session State ---
    let currentGameState;
    let gameLog;
    let latestEntryChainHash;
    let sequenceNumber;
    let sessionGameId; // To store the ID from the server
    let sessionPublicKey; // To store the public key from the server

    // Player IDs are hardcoded for the POC
    const playerX_Id = 'DOGE';
    const playerO_Id = 'PEPE';

    // --- Crypto Helper Functions ---

    /**
     * Converts a PEM-formatted public key string into a CryptoKey object
     * that the Web Crypto API can use for encryption.
     * @param {string} pem - The public key in PEM format.
     * @returns {Promise<CryptoKey>} A promise that resolves to the CryptoKey object.
     */
    async function importPublicKey(pem) {
        const pemHeader = "-----BEGIN PUBLIC KEY-----";
        const pemFooter = "-----END PUBLIC KEY-----";
        const pemContents = pem
            .replace(pemHeader, '')
            .replace(pemFooter, '')
            .replace(/\s/g, '');
            
        const binaryDer = window.atob(pemContents);
        const binaryDerArray = new Uint8Array(binaryDer.length);
        for (let i = 0; i < binaryDer.length; i++) {
            binaryDerArray[i] = binaryDer.charCodeAt(i);
        }

        return await window.crypto.subtle.importKey(
            "spki",
            binaryDerArray.buffer,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["encrypt"]
        );
    }

    /**
     * Implements hybrid encryption and submits the final game log to the server.
     */
    async function encryptAndSubmitLog() {
        if (!sessionPublicKey) {
            console.error("Cannot submit log: session public key is not available.");
            return;
        }
        console.log("Game over. Encrypting final game log for submission...");
        statusElement.textContent = "Encrypting and submitting log...";

        try {
            // --- ADD THIS BLOCK TO GET THE APP CHECK TOKEN ---
            const headers = { 'Content-Type': 'application/json' };
            let appCheckTokenResponse;
            try {
                if (appCheck) {
                    appCheckTokenResponse = await getToken(appCheck, /* forceRefresh= */ false);
                    headers['X-Firebase-AppCheck'] = appCheckTokenResponse.token;
                }
            } catch (err) {
                console.error("Failed to get App Check token:", err);
                throw new Error("Could not get App Check token.");
            }
            // ---------------------------------------------
            
            // --- HYBRID ENCRYPTION IMPLEMENTATION ---
            const symmetricKey = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const logString = JSON.stringify(gameLog);
            const encoder = new TextEncoder();
            const encryptedLogBuffer = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, symmetricKey, encoder.encode(logString));
            const exportedSymmetricKey = await window.crypto.subtle.exportKey("raw", symmetricKey);
            const rsaPublicKey = await importPublicKey(sessionPublicKey);
            const encryptedSymmetricKeyBuffer = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaPublicKey, exportedSymmetricKey);
            
            console.log("Log successfully encrypted. Submitting to server...");
            
            const response = await fetch('/api/submit-log', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    gameId: sessionGameId,
                    encryptedLog: arrayBufferToBase64(encryptedLogBuffer),
                    encryptedKey: arrayBufferToBase64(encryptedSymmetricKeyBuffer),
                    iv: arrayBufferToBase64(iv)
                })
            });

            // --- REFACTORED ERROR HANDLING ---
            const result = await response.json(); // Always try to parse the JSON body

            if (!response.ok) {
                // If the response is not OK, construct an error with the server's reason
                const reason = result.reason || 'Unknown server error';
                throw new Error(`Server rejected submission: ${reason}`);
            }
            console.log("Server response to submission:", result);
            statusElement.textContent = "Log Submitted Successfully!";

        } catch (error) {
            console.error("Failed to encrypt or submit log:", error.message); // Log just the error message
            statusElement.textContent = "Error during log submission.";
        }
    }

    /**
     * Converts an ArrayBuffer to a Base64 string for network transmission.
     * @param {ArrayBuffer} buffer The buffer to convert.
     * @returns {string} The Base64 encoded string.
     */
    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
    
    // --- UPDATED HASHING FUNCTIONS ---

    /**
     * Creates a truly canonical, sorted string from a log entry object by recursively
     * handling nested objects and arrays. This is the only guaranteed way to ensure
     * a stable string representation for cryptographic hashing.
     * @param {*} obj - The object, array, or primitive to be stringified.
     * @returns {string} A stable, canonical JSON string representation of the object.
     */
    function getCanonicalString(obj) {
        if (obj === null || typeof obj !== 'object') {
            return JSON.stringify(obj);
        }

        if (Array.isArray(obj)) {
            const arrayValues = obj.map(item => getCanonicalString(item));
            return `[${arrayValues.join(',')}]`;
        }

        const sortedKeys = Object.keys(obj).sort();
        const keyValuePairs = sortedKeys.map(key => {
            const value = getCanonicalString(obj[key]);
            return `${JSON.stringify(key)}:${value}`;
        });

        return `{${keyValuePairs.join(',')}}`;
    }

    /**
     * Creates the object that will actually be hashed, by removing the hash of the
     * object itself from the object.
     * @param {object} logEntry - The full log entry, which may contain its own hash.
     * @returns {object} The object to be passed to getCanonicalString.
     */
    function getObjectToHash(logEntry) {
        const { currentEntryChainHash, ...entryToHash } = logEntry;
        return entryToHash;
    }

    /**
     * Hashes a log entry using SHA-256.
     * @param {object} logEntry - The log entry to hash.
     * @returns {Promise<string>} A promise that resolves to the hex string of the hash.
     */
    async function calculateEntryHash(logEntry) {
        const objectToHash = getObjectToHash(logEntry);
        const canonicalString = getCanonicalString(objectToHash);
        const encoder = new TextEncoder();
        const data = encoder.encode(canonicalString);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // --- Core Actions ---

    /**
     * Creates a log entry, hashes it, and adds it to the game log array.
     */
    async function addLogEntry(eventType, eventData) {
        const logEntry = {
            sequence: sequenceNumber,
            eventType,
            clientTimestamp: Date.now(),
            eventData,
            boardState: cloneBoard(currentGameState.board),
            fsmState: currentGameState.currentState,
            previousEntryChainHash: latestEntryChainHash,
        };

        const newHash = await calculateEntryHash(logEntry);
        logEntry.currentEntryChainHash = newHash; 
        latestEntryChainHash = newHash;

        gameLog.push(logEntry);
        sequenceNumber++;

        console.log(`Log Entry #${logEntry.sequence} Added:`, logEntry);
        console.log(`Latest Hash Chain Value: ${latestEntryChainHash}`);
    }

    // --- Game Initialization ---
    async function startGame() {
        statusElement.textContent = "Creating new game on server...";
        
        try {
            // --- ADD THIS BLOCK TO GET THE APP CHECK TOKEN ---
            const headers = { 'Content-Type': 'application/json' };
            let appCheckTokenResponse;
            try {
                if (appCheck) {
                    appCheckTokenResponse = await getToken(appCheck, /* forceRefresh= */ false);
                    headers['X-Firebase-AppCheck'] = appCheckTokenResponse.token;
                }
            } catch (err) {
                console.error("Failed to get App Check token:", err);
                throw new Error("Could not get App Check token.");
            }
            // ---------------------------------------------

            const response = await fetch('/api/create-game', {
                method: 'POST',
                headers: headers
            });
            
            if (!response.ok) throw new Error(`Server failed to create game: ${response.status}`);
            
            const gameData = await response.json();
            sessionGameId = gameData.gameId;
            sessionPublicKey = gameData.publicKeyPem;
            
            if (!sessionGameId || !sessionPublicKey) throw new Error("Invalid response from /create-game.");
            
            console.log(`--- NEW GAME STARTED (ID: ${sessionGameId}) ---`);

            gameLog = [];
            sequenceNumber = 0;
            latestEntryChainHash = "0".repeat(64);

            currentGameState = getInitialGameState(playerX_Id, playerO_Id);
            
            await addLogEntry("GAME_CREATED", { playerX: playerX_Id, playerO: playerO_Id });

            render();
        } catch (error) {
            console.error("Could not start new game:", error);
            statusElement.textContent = "Error: Could not start new game.";
        }
    }
    
    // --- Rendering Logic ---
    function render() {
        boardElement.innerHTML = '';
        if (!currentGameState) return; // Guard against render before start
        const isGameOver = currentGameState.currentState.startsWith('GAME_OVER');
        boardElement.classList.toggle('game-over', isGameOver);
        
        currentGameState.board.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
                const cellDiv = document.createElement('div');
                cellDiv.classList.add('cell');
                cellDiv.dataset.row = rowIndex;
                cellDiv.dataset.col = colIndex;
                if (cell) {
                    // We will use CSS to set the background image
                    cellDiv.classList.add(cell.toLowerCase());
                }
                boardElement.appendChild(cellDiv);
            });
        });
        
        switch (currentGameState.currentState) {
            case STATES.PLAYER_X_TURN:
                statusElement.textContent = `DOGE's Turn (Game ID: ${sessionGameId ? sessionGameId.substring(0, 5) : ''}...)`;
                break;
            case STATES.PLAYER_O_TURN:
                statusElement.textContent = `PEPE's Turn (Game ID: ${sessionGameId ? sessionGameId.substring(0, 5) : ''}...)`;
                break;
            case STATES.GAME_OVER_X_WINS:
                statusElement.textContent = "Game Over: DOGE Wins!";
                break;
            case STATES.GAME_OVER_O_WINS:
                statusElement.textContent = "Game Over: PEPE Wins!";
                break;
            case STATES.GAME_OVER_DRAW:
                statusElement.textContent = "Game Over: It's a Draw!";
                break;
        }

        if (isGameOver && gameLog.length > 0 && gameLog[gameLog.length-1].eventType.startsWith('PLAYER_')) {
            const finalEventType = currentGameState.currentState === STATES.GAME_OVER_DRAW ? "GAME_DRAWN" : "GAME_WON";
            const finalEventData = finalEventType === "GAME_WON" 
                ? { winningPlayerId: currentGameState.currentState === STATES.GAME_OVER_X_WINS ? playerX_Id : playerO_Id }
                : {};
            // This async function handles the end-of-game logic with a delay.
            const handleGameOver = async () => {
                // First, log the final game state event.
                await addLogEntry(finalEventType, finalEventData);
                
                // Wait for 2 seconds so the user can see the "Game Over" message.
                await new Promise(resolve => setTimeout(resolve, 2000));

                // After the delay, proceed with encryption and submission.
                encryptAndSubmitLog();
            };

            handleGameOver();
        }
    }
    
    // --- Event Handling (CORRECTED LOGIC) ---
    async function handleCellClick(event) {
        const clickedCell = event.target;
        if (!clickedCell.classList.contains('cell') || !currentGameState || currentGameState.currentState.startsWith('GAME_OVER')) return;

        const rowIndex = parseInt(clickedCell.dataset.row, 10);
        const colIndex = parseInt(clickedCell.dataset.col, 10);
        const currentPlayerId = (currentGameState.currentState === STATES.PLAYER_X_TURN) ? playerX_Id : playerO_Id;
        const currentSymbol = (currentGameState.currentState === STATES.PLAYER_X_TURN) ? 'X' : 'O';

        const eventData = { move: { rowIndex, colIndex }, playerId: currentPlayerId };
        
        // 1. Get the result of the move from the FSM
        const transitionResult = transition(currentGameState, EVENTS.PLAYER_MOVE_ATTEMPTED, eventData);

        // 2. IMPORTANT: Update the central game state *before* logging
        currentGameState.currentState = transitionResult.newState;
        if (transitionResult.isValidMove) {
            currentGameState.board = transitionResult.newBoard;
        }

        // 3. Now, log the event based on the outcome. The log will capture the *new* state.
        if (transitionResult.isValidMove) {
            await addLogEntry("PLAYER_MOVE_VALIDATED", { 
                playerId: currentPlayerId, 
                move: { rowIndex, colIndex }, 
                symbolPlaced: currentSymbol 
            });
        } else {
            await addLogEntry("PLAYER_MOVE_REJECTED", { 
                playerId: currentPlayerId, 
                attemptedMove: { rowIndex, colIndex }, 
                reason: transitionResult.error 
            });
            console.warn(`Invalid move: ${transitionResult.error}`);
        }
        
        // 4. Finally, re-render the UI with the updated state
        render();
    }

    // --- Utility Functions ---
    function cloneBoard(board) {
        return JSON.parse(JSON.stringify(board));
    }

    // --- Attach Event Listeners ---
    boardElement.addEventListener('click', handleCellClick);
    restartButton.addEventListener('click', startGame);

    // --- Initial Game Start ---
    startGame();
});