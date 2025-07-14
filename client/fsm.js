// server/fsm.js

/**
 * fsm.js
 *
 * This module represents the Finite State Machine (FSM) and core game logic
 * for a game of Tic-Tac-Toe. It is a pure module with no external dependencies
 * on web servers or databases, making it testable in isolation.
 *
 * It exports:
 * - STATES: An object containing all possible game states.
 * - EVENTS: An object containing all possible events that can trigger a state transition.
 * - transition: The core function that calculates the next state based on the current state and an event.
 * - getInitialGameState: A factory function to create a new game state object.
 */

// Define all possible states for the game.
const STATES = {
    GAME_STARTING: 'GAME_STARTING',
    PLAYER_X_TURN: 'PLAYER_X_TURN',
    PLAYER_O_TURN: 'PLAYER_O_TURN',
    GAME_OVER_X_WINS: 'GAME_OVER_X_WINS',
    GAME_OVER_O_WINS: 'GAME_OVER_O_WINS',
    GAME_OVER_DRAW: 'GAME_OVER_DRAW',
};

// Define all possible events that can drive the FSM.
const EVENTS = {
    PLAYER_MOVE_ATTEMPTED: 'PLAYER_MOVE_ATTEMPTED',
};

/**
 * A helper function to create a deep copy of the board array.
 * @param {Array<Array<string>>} board - The 3x3 game board.
 * @returns {Array<Array<string>>} A new copy of the board.
 */
function cloneBoard(board) {
    return JSON.parse(JSON.stringify(board));
}

/**
 * Checks if a given player has won the game.
 * @param {Array<Array<string>>} board - The 3x3 game board.
 * @param {string} playerSymbol - The player's symbol ('X' or 'O').
 * @returns {boolean} True if the player has won, false otherwise.
 */
function checkWin(board, playerSymbol) {
    const winConditions = [
        [[0, 0], [0, 1], [0, 2]], // Top row
        [[1, 0], [1, 1], [1, 2]], // Middle row
        [[2, 0], [2, 1], [2, 2]], // Bottom row
        [[0, 0], [1, 0], [2, 0]], // Left column
        [[0, 1], [1, 1], [2, 1]], // Middle column
        [[0, 2], [1, 2], [2, 2]], // Right column
        [[0, 0], [1, 1], [2, 2]], // Diagonal L-R
        [[0, 2], [1, 1], [2, 0]], // Diagonal R-L
    ];

    return winConditions.some(combination =>
        combination.every(([r, c]) => board[r][c] === playerSymbol)
    );
}

/**
 * Checks if the game is a draw (no empty cells left).
 * @param {Array<Array<string>>} board - The 3x3 game board.
 * @returns {boolean} True if the game is a draw, false otherwise.
 */
function checkDraw(board) {
    return board.every(row => row.every(cell => cell !== ''));
}

/**
 * @typedef {object} FSMTransitionResult
 * @property {string} newState - The state of the FSM after the transition.
 * @property {boolean} isValidMove - Indicates if the attempted move was valid.
 * @property {Array<Array<string>>} [newBoard] - The updated board state, only present if the move was valid.
 * @property {string} [error] - A description of the error, only present if the move was invalid.
 */

/**
 * The core FSM transition function. It takes the current game state and an event payload,
 * applies game rules, and returns the new state and outcome. This function is pure
 * and has no side effects.
 *
 * @param {object} currentGameState - The full current state of the game.
 * Includes { currentState: string, board: Array<Array<string>>, playerX: string, playerO: string }
 * @param {string} event - The event that is occurring (e.g., 'PLAYER_MOVE_ATTEMPTED').
 * @param {object} eventData - Data associated with the event.
 * Includes { move: { rowIndex: number, colIndex: number }, playerId: string }
 * @returns {FSMTransitionResult} An object describing the outcome of the transition.
 */
function transition(currentGameState, event, eventData) {
    // --- Input validation for the function itself ---
    if (!currentGameState || !event || !eventData || !eventData.move) {
        throw new Error("Invalid arguments provided to FSM transition function.");
    }

    const { currentState, board, playerX, playerO } = currentGameState;
    const { move, playerId } = eventData;
    const { rowIndex, colIndex } = move;

    // --- Main FSM logic ---
    switch (currentState) {
        case STATES.PLAYER_X_TURN:
            if (event === EVENTS.PLAYER_MOVE_ATTEMPTED) {
                // --- Game Rule Validation ---
                if (playerId !== playerX) {
                    return { newState: currentState, isValidMove: false, error: "Not player X's turn." };
                }
                if (rowIndex < 0 || rowIndex > 2 || colIndex < 0 || colIndex > 2 || board[rowIndex][colIndex] !== '') {
                    return { newState: currentState, isValidMove: false, error: "Invalid move: cell is occupied or out of bounds." };
                }

                // --- Apply the Move ---
                const newBoardX = cloneBoard(board);
                newBoardX[rowIndex][colIndex] = 'X';

                // --- Check for Win/Draw Condition ---
                if (checkWin(newBoardX, 'X')) {
                    return { newState: STATES.GAME_OVER_X_WINS, newBoard: newBoardX, isValidMove: true };
                }
                if (checkDraw(newBoardX)) {
                    return { newState: STATES.GAME_OVER_DRAW, newBoard: newBoardX, isValidMove: true };
                }

                // --- Transition to Next State ---
                return { newState: STATES.PLAYER_O_TURN, newBoard: newBoardX, isValidMove: true };
            }
            break;

        case STATES.PLAYER_O_TURN:
            if (event === EVENTS.PLAYER_MOVE_ATTEMPTED) {
                // --- Game Rule Validation ---
                if (playerId !== playerO) {
                    return { newState: currentState, isValidMove: false, error: "Not player O's turn." };
                }
                if (rowIndex < 0 || rowIndex > 2 || colIndex < 0 || colIndex > 2 || board[rowIndex][colIndex] !== '') {
                    return { newState: currentState, isValidMove: false, error: "Invalid move: cell is occupied or out of bounds." };
                }

                // --- Apply the Move ---
                const newBoardO = cloneBoard(board);
                newBoardO[rowIndex][colIndex] = 'O';

                // --- Check for Win/Draw Condition ---
                if (checkWin(newBoardO, 'O')) {
                    return { newState: STATES.GAME_OVER_O_WINS, newBoard: newBoardO, isValidMove: true };
                }
                if (checkDraw(newBoardO)) {
                    return { newState: STATES.GAME_OVER_DRAW, newBoard: newBoardO, isValidMove: true };
                }

                // --- Transition to Next State ---
                return { newState: STATES.PLAYER_X_TURN, newBoard: newBoardO, isValidMove: true };
            }
            break;

        // Cases for GAME_OVER states (no further moves allowed)
        case STATES.GAME_OVER_X_WINS:
        case STATES.GAME_OVER_O_WINS:
        case STATES.GAME_OVER_DRAW:
            return { newState: currentState, isValidMove: false, error: "Game is already over." };
    }

    // Default case if no transition matches
    return { newState: currentState, isValidMove: false, error: `No valid transition for event ${event} from state ${currentState}.` };
}

/**
 * A factory function to create the initial state object for a new game.
 * @param {string} playerX_Id - The ID for the player who will be 'X'.
 * @param {string} playerO_Id - The ID for the player who will be 'O'.
 * @returns {object} The initial game state object.
 */
function getInitialGameState(playerX_Id, playerO_Id) {
    return {
        // Player X is typically the first to move in Tic-Tac-Toe
        currentState: STATES.PLAYER_X_TURN,
        board: [
            ['', '', ''],
            ['', '', ''],
            ['', '', '']
        ],
        playerX: playerX_Id,
        playerO: playerO_Id,
    };
}

// Export the functions and constants so other files in the server can use them.
export {
    STATES,
    EVENTS,
    transition,
    getInitialGameState,
};