// src/content_scripts/chatgpt_interactor.js
console.log("ChatGPT Interactor content script loaded.");

// --- Configuration ---
const INPUT_SELECTOR = "textarea[id='prompt-textarea']";
const SEND_BUTTON_SELECTOR = "button[data-testid='send-button']";
// More specific selector for the container of the latest response:
const RESPONSE_CONTAINER_SELECTOR = "div.group.w-full.text-token-text-primary"; // This is an example, might need to be very specific to the last message block
const RESPONSE_AREA_SELECTOR = "div.markdown.prose"; // Selector for response text elements within a message block
const LAST_RESPONSE_SELECTOR = "div[data-message-author-role='assistant']:last-child .markdown.prose";
const CHATGPT_DONE_INDICATOR_SELECTOR = "form button[data-testid='send-button']:not([disabled])";

// Modal and initial screen selectors (these are examples and need verification)
const WELCOME_MODAL_BUTTON_SELECTOR = "button.btn-neutral"; // General class for some buttons
const NEXT_BUTTON_SELECTOR = "button.btn-primary"; // General class for primary action buttons
const ONBOARDING_MODAL_SELECTOR = "div[role='dialog']"; // Generic dialog selector

// --- Helper Functions ---
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function typeText(element, text) {
  element.focus();
  element.value = ''; // Clear existing text
  for (const char of text) {
    element.value += char;
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    await delay(Math.random() * 40 + 10); // 10-50ms delay
  }
  element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  await delay(50 + Math.random() * 50); // Small delay after typing all text
}

function clickElement(element) {
  if (element) {
    element.scrollIntoViewIfNeeded ? element.scrollIntoViewIfNeeded() : element.scrollIntoView({ block: 'center' });
    element.click();
    return true;
  }
  return false;
}


async function handleModalsAndInitialScreen() {
  console.log("ChatGPT Interactor: Checking for modals or initial screen elements...");
  try {
    await delay(1500); // Wait for page to settle

    const onboardingDialog = document.querySelector(ONBOARDING_MODAL_SELECTOR);
    if (onboardingDialog) {
        console.log("ChatGPT Interactor: Found an onboarding dialog.");
        const buttons = onboardingDialog.querySelectorAll('button');
        let clickedButton = false;
        for (const btn of buttons) {
            const buttonText = btn.innerText.toLowerCase();
            if (buttonText.includes('okay, let’s go') || buttonText.includes('next') || buttonText.includes('done')) {
                console.log(`ChatGPT Interactor: Attempting to click modal button: "${btn.innerText}"`);
                clickElement(btn);
                clickedButton = true;
                await delay(1200); // Wait for next state
                // Re-check for more buttons in a sequence if necessary
                const nextButtonsInModal = onboardingDialog.querySelectorAll('button');
                if (nextButtonsInModal.length > 0) {
                    for (const nextBtn of nextButtonsInModal) {
                        const nextButtonText = nextBtn.innerText.toLowerCase();
                        if (nextButtonText.includes('next') || nextButtonText.includes('done')) {
                             console.log(`ChatGPT Interactor: Attempting to click next modal button: "${nextBtn.innerText}"`);
                             clickElement(nextBtn);
                             await delay(1200);
                        }
                    }
                }
                break;
            }
        }
        if(clickedButton){
            console.log("ChatGPT Interactor: Modal button clicked. Re-checking for send button presence.");
        } else {
            console.log("ChatGPT Interactor: No actionable buttons found in the dialog, or dialog not as expected.");
        }
    } else {
        console.log("ChatGPT Interactor: No onboarding dialog detected by selector.");
    }

    await delay(500); // Final small delay
    console.log("ChatGPT Interactor: Modal handling attempt complete.");
    return true;
  } catch (error) {
    console.warn("ChatGPT Interactor: Error during modal handling:", error);
    return false;
  }
}


// --- Core Interaction Logic ---
async function performSummarization(chunkText, chunkId, videoId) {
  console.log(`ChatGPT Interactor: performSummarization called for chunk ${chunkId}, video ${videoId}`);
  try {
    // It's assumed ensureChatGPTTab in service worker calls CHECK_CHATGPT_READY, which runs handleModalsAndInitialScreen.
    // If not, call it here: await handleModalsAndInitialScreen();

    let inputEl = document.querySelector(INPUT_SELECTOR);
    let sendButton = document.querySelector(SEND_BUTTON_SELECTOR);

    // Retry finding elements a few times if not immediately available
    let findAttempts = 0;
    while ((!inputEl || !sendButton) && findAttempts < 5) {
        await delay(1000);
        inputEl = document.querySelector(INPUT_SELECTOR);
        sendButton = document.querySelector(SEND_BUTTON_SELECTOR);
        findAttempts++;
        console.log(`ChatGPT Interactor: Retrying to find elements, attempt ${findAttempts}`);
    }

    if (!inputEl) throw new Error(`ChatGPT input element not found (selector: ${INPUT_SELECTOR}). Chunk: ${chunkId}`);
    if (!sendButton) throw new Error(`ChatGPT send button not found (selector: ${SEND_BUTTON_SELECTOR}). Chunk: ${chunkId}`);

    let waitAttempts = 0;
    while(sendButton && sendButton.disabled && waitAttempts < 20) { // Max wait 10s (20 * 500ms)
        console.log(`ChatGPT Interactor: Send button is disabled, waiting... (Chunk: ${chunkId})`);
        await delay(500);
        sendButton = document.querySelector(SEND_BUTTON_SELECTOR);
        if (!sendButton) break; // Button might disappear/change
        waitAttempts++;
    }
    if (!sendButton) throw new Error(`ChatGPT send button disappeared while waiting for it to enable. Chunk: ${chunkId}`);
    if (sendButton.disabled) {
        throw new Error(`ChatGPT send button remained disabled after ${waitAttempts * 0.5}s. Chunk: ${chunkId}`);
    }

    await typeText(inputEl, chunkText);
    await delay(300 + Math.random() * 400);

    clickElement(sendButton);
    console.log(`ChatGPT Interactor: Sent chunk ${chunkId} for video ${videoId} to ChatGPT.`);
    await delay(500 + Math.random() * 500);

    let observer;
    const summary = await new Promise((resolve, reject) => {
      const timeoutDuration = 120000; // 120 seconds
      let observationTimeout = setTimeout(() => {
        if(observer) observer.disconnect();
        console.error(`ChatGPT Interactor: Timeout waiting for response for chunk ${chunkId}.`);
        reject(new Error(`Timeout waiting for ChatGPT response completion for chunk ${chunkId}.`));
      }, timeoutDuration);

      const responseRoot = document.querySelector("main form")?.parentElement || document.body;

      observer = new MutationObserver((mutationsList, obs) => {
        const currentSendButton = document.querySelector(SEND_BUTTON_SELECTOR); // Re-query inside observer

        // Primary condition: send button is enabled again
        if (currentSendButton && !currentSendButton.disabled) {
            const assistantMessages = document.querySelectorAll("div[data-message-author-role='assistant']");
            const lastAssistantMessageGroup = assistantMessages[assistantMessages.length - 1];

            if (lastAssistantMessageGroup) {
                // Check for ChatGPT's "stop generating" button within the last message. If present, it's still typing.
                const stopGeneratingButton = lastAssistantMessageGroup.querySelector('button[aria-label="Stop generating"]');
                if (stopGeneratingButton) {
                    // console.log(`ChatGPT Interactor: Still generating (found stop button), chunk ${chunkId}.`);
                    return; // Still generating
                }

                const proseElement = lastAssistantMessageGroup.querySelector(RESPONSE_AREA_SELECTOR); // typically div.markdown.prose
                if (proseElement) {
                    const summaryText = proseElement.innerText || proseElement.textContent;
                     if (summaryText && summaryText.trim().length > 0) {
                        // Additional check: ensure it's not an error message from ChatGPT UI itself
                        if (proseElement.querySelector('div[class*="error"]')) {
                            console.warn(`ChatGPT Interactor: Detected error styling in response for chunk ${chunkId}.`);
                            // Do not resolve yet, wait for button or timeout. Or, could reject here.
                            // For now, let it timeout if it's a persistent UI error message.
                            return;
                        }
                        console.log(`ChatGPT Interactor: Response fully detected for chunk ${chunkId}. Length: ${summaryText.trim().length}`);
                        clearTimeout(observationTimeout);
                        obs.disconnect();
                        resolve(summaryText.trim());
                        return;
                    }
                }
            }
        }
      });

      const config = { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: ['disabled'] };
      observer.observe(responseRoot, config);
      console.log(`ChatGPT Interactor: MutationObserver started for response (chunk ${chunkId}). Observing ${responseRoot.tagName}.`);
    });

    await delay(200 + Math.random() * 300);
    return summary;

  } catch (error) {
    console.error(`ChatGPT Interactor: Error in performSummarization for chunk ${chunkId} (video ${videoId}):`, error.message, error.stack);
    throw error; // Propagate to be caught by the sendMessage promise in service worker
  }
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SUMMARIZE_TEXT_IN_CHATGPT_TAB") {
    console.log(`ChatGPT Interactor: Received SUMMARIZE_TEXT_IN_CHATGPT_TAB for chunk ${request.chunkId}`);
    performSummarization(request.text, request.chunkId, request.videoId)
      .then(summary => {
        sendResponse({
          type: "CHUNK_SUMMARIZED", // Changed from status: "success" for clarity in SW
          summary: summary,
          chunkId: request.chunkId,
          videoId: request.videoId
        });
      })
      .catch(error => {
        sendResponse({
          type: "CHATGPT_INTERACTION_ERROR", // Changed for clarity
          message: error.message,
          stack: error.stack,
          chunkId: request.chunkId,
          videoId: request.videoId
        });
      });
    return true; // Indicates async response

  } else if (request.action === "CHECK_CHATGPT_READY") {
    console.log("ChatGPT Interactor: Received CHECK_CHATGPT_READY request.");
    (async () => {
      await handleModalsAndInitialScreen(); // Attempt to clear any blockers
      await delay(500); // Short delay for UI to update after modal clicks
      const inputEl = document.querySelector(INPUT_SELECTOR);
      const sendButton = document.querySelector(SEND_BUTTON_SELECTOR);
      if (inputEl && sendButton && !sendButton.disabled) {
        console.log("ChatGPT Interactor: CHECK_CHATGPT_READY: Ready.");
        sendResponse({ status: "success", ready: true });
      } else {
        let reason = "";
        if (!inputEl) reason += "Input not found. ";
        if (!sendButton) reason += "Send button not found. ";
        if (sendButton && sendButton.disabled) reason += "Send button disabled. ";
        console.warn("ChatGPT Interactor: CHECK_CHATGPT_READY: Not ready.", reason.trim());
        sendResponse({ status: "success", ready: false, reason: reason.trim() });
      }
    })();
    return true; // Async
  }
});

// Initial check for modals when the script loads.
// This helps prepare the page if it's opened fresh.
(async () => {
    console.log("ChatGPT Interactor: Initial load - attempting to handle modals.");
    await handleModalsAndInitialScreen();
    // We can't easily send a message back here as there's no specific request.
    // The service worker will use CHECK_CHATGPT_READY before sending a task.
    console.log("ChatGPT Interactor: Initial modal handling attempt finished.");
})();

console.log("ChatGPT Interactor: Event listeners set up.");
