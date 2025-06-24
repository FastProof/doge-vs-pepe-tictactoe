// client/main.js
console.log("Hash Verifier client-side JavaScript loaded.");

document.addEventListener('DOMContentLoaded', () => {
    const textInput = document.getElementById('textToHashInput');
    const generateButton = document.getElementById('generateHashButton');
    const resultArea = document.getElementById('resultArea');

    if (generateButton) {
        generateButton.addEventListener('click', async () => {
            const textToHash = textInput.value;
            resultArea.innerHTML = 'Generating hash...'; // Provide feedback

            if (!textToHash) {
                resultArea.innerHTML = '<p style="color: red;">Please enter some text to hash.</p>';
                return;
            }

            // IMPORTANT: Replace YOUR_PROJECT_ID with your actual Firebase Project ID
            // You can find this in your .firebaserc file or the Firebase console.
            const projectId = 'hash-verifier'; // <--- !!! REPLACE THIS !!!
            //const functionUrl = `http://127.0.0.1:5001/${projectId}/us-central1/api/api/generate-hash`;
            const functionUrl = 'https://5001-firebase-hash-verifier-1749019524192.cluster-rhptpnrfenhe4qarq36djxjqmg.cloudworkstations.dev/hash-verifier/us-central1/api/api/generate-hash';
            //const functionUrl = '/hash-verifier/us-central1/api/api/generate-hash';
            // Note: When deploying, this URL will change.
            // For a deployed app, you'd use '/api/generate-hash' if using hosting rewrites,
            // or the full cloud function URL.

            try {
                const response = await fetch(functionUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ textToHash: textToHash }),
                });

                if (!response.ok) {
                    // Try to get more details from the error response if possible
                    const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
                    throw new Error(`Network response was not ok: ${response.status} ${response.statusText}. ${errorData.error || ''}`);
                }

                const data = await response.json();

                if (data.hash) {
                    resultArea.innerHTML = `
                        <p><strong>Original Text:</strong> ${escapeHTML(data.originalText)}</p>
                        <p><strong>SHA-256 Hash:</strong> ${escapeHTML(data.hash)}</p>
                    `;
                } else {
                    resultArea.innerHTML = `<p style="color: orange;">Received a response, but no hash was found.</p>`;
                }

            } catch (error) {
                console.error('Error generating hash:', error);
                resultArea.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
            }
        });
    } else {
        console.error("Generate Hash Button not found!");
    }
});

// Helper function to escape HTML to prevent XSS (basic version)
function escapeHTML(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}