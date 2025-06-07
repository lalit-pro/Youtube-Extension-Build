// src/offscreen/offscreen.js
console.log("Offscreen document script loaded.");

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'SUMMARIZE_CHUNK') {
    console.log('Offscreen received chunk to summarize:', message.chunk);
    const promptInput = document.getElementById('promptInput');
    const chatgptResponseDiv = document.getElementById('chatgptResponse');

    if (promptInput && chatgptResponseDiv) {
      // In a real scenario, this is where you would:
      // 1. Construct the prompt for ChatGPT.
      // 2. Use DOM manipulation or fetch to interact with the ChatGPT web UI
      //    (if loaded in an iframe within this offscreen document, though that has challenges)
      //    or make an API call if that was the chosen method (requires API key handling).
      // For now, we'll simulate this interaction.

      promptInput.value = `Summarize the following text:\n\n${message.chunk.text}`;

      // Simulate a delay and a response
      chatgptResponseDiv.innerHTML = `Processing chunk ${message.chunk.id}...`;

      try {
        // Simulate an async operation like fetching a summary
        const summary = await simulateChatGPTInteraction(message.chunk);
        console.log(`Offscreen: Simulated summary for chunk ${message.chunk.id}:`, summary);
        chatgptResponseDiv.innerHTML = `Summary for ${message.chunk.id}: ${summary}`;

        // Send the summary back to the service worker
        chrome.runtime.sendMessage({
          type: 'CHUNK_SUMMARIZED',
          chunkId: message.chunk.id,
          videoId: message.videoId, // Pass back videoId for storage key
          summary: summary,
          status: 'summarized'
        });
        sendResponse({ status: "success", summary: summary });
      } catch (error) {
        console.error('Offscreen: Error summarizing chunk:', error);
        chrome.runtime.sendMessage({
          type: 'CHUNK_SUMMARY_ERROR',
          chunkId: message.chunk.id,
          videoId: message.videoId,
          error: error.message,
          status: 'error'
        });
        sendResponse({ status: "error", error: error.message });
      }
    } else {
      console.error("Offscreen document UI elements not found.");
      sendResponse({ status: "error", error: "Offscreen UI not ready" });
    }
    return true; // Indicates you wish to send a response asynchronously
  }
});

// Simulate ChatGPT interaction (replace with actual logic later)
async function simulateChatGPTInteraction(chunk) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(`This is a simulated summary for chunk ID ${chunk.id} which started at ${chunk.startingTimestamp}. The text was: "${chunk.text.substring(0, 50)}..."`);
    }, 2000); // Simulate network delay
  });
}

// Example of how the button might be used (for manual testing within the offscreen doc itself)
const sendButton = document.getElementById('sendToChatGPT');
if (sendButton) {
  sendButton.addEventListener('click', async () => {
    const promptInput = document.getElementById('promptInput');
    const chatgptResponseDiv = document.getElementById('chatgptResponse');
    if (promptInput && promptInput.value) {
      chatgptResponseDiv.innerHTML = `Manually sending: ${promptInput.value.substring(0,30)}...`;
      // This is a placeholder for manual testing.
      // In the actual extension, messages will come from the service worker.
      try {
        const simulatedSummary = await simulateChatGPTInteraction({ id: "manual_test", text: promptInput.value, startingTimestamp: "0:00" });
        chatgptResponseDiv.innerHTML = `Manual Test Summary: ${simulatedSummary}`;
      } catch (error) {
        chatgptResponseDiv.innerHTML = `Error: ${error.message}`;
      }
    }
  });
}

console.log("Offscreen document event listeners set up.");
