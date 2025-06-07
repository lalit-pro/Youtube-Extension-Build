// src/background/service_worker.js
import { chunkTranscript } from '../utils/transcript_chunker.js';
import { saveVideoTranscript, getVideoTranscript, updateChunkInVideo, getAllVideoTranscripts, deleteVideoTranscript } from '../utils/indexeddb_helper.js';

console.log("Background service worker started.");

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000; // 5 seconds

let isProcessingPaused = false;
// Load persisted pause state
chrome.storage.local.get('isProcessingPaused', (data) => {
   isProcessingPaused = !!data.isProcessingPaused;
   console.log('Initial processing pause state loaded:', isProcessingPaused);
});

let chatGPTTabId = null;
let chatGPTTabStatus = "unloaded"; // 'unloaded', 'loading', 'ready', 'busy', 'error_creation', 'error_interact'
let tabCreationPromise = null;
// let tabReadyPromise = null; // This can be merged into tabCreationPromise logic

// Queue for chunks to be summarized
// Each item will be { videoId, chunkId, text, originalSegments, retryCount }
let chunkQueue = [];
/** @type {boolean} Flag to indicate if a chunk is currently being processed (sent to ChatGPT and awaiting response). */
let isProcessingChunk = false;
/** @type {{videoId: string, chunkId: string, text: string, originalSegments: any[], retryCount: number} | null} Stores the full chunk object currently being processed. */
let currentProcessingChunk = null;

// --- Tab Management ---

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId) {
        if (changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          console.log(`Tab ${tabId} finished loading.`);
          resolve(tab);
        } else if (changeInfo.status === 'error') { // Not a standard status, but for completeness
          chrome.tabs.onUpdated.removeListener(listener);
          console.error(`Tab ${tabId} encountered an error during loading.`);
          reject(new Error(`Tab ${tabId} failed to load.`));
        }
      }
    };

    // Check current status first, in case it's already loaded
    chrome.tabs.get(tabId, (currentTab) => {
      if (chrome.runtime.lastError) {
        // Tab might have been closed before we could get it
        reject(new Error(`Failed to get tab ${tabId}: ${chrome.runtime.lastError.message}`));
        return;
      }
      if (currentTab.status === 'complete') {
        resolve(currentTab);
      } else {
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  });
}

/**
 * Ensures that a tab for ChatGPT is open, loaded, and ready for interaction.
 * Manages a single ChatGPT tab identified by `chatGPTTabId`.
 * If no tab exists, or the existing one is closed, it creates a new one.
 * It then sends a "CHECK_CHATGPT_READY" message to the content script in that tab
 * to ensure the page is interactable (e.g., modals are dismissed).
 * Implements retry logic for readiness checks.
 * @returns {Promise<number | null>} Resolves with the tab ID if successful, or null/rejects on failure.
 */
async function ensureChatGPTTab() {
  if (tabCreationPromise) {
    console.log("ChatGPT tab creation/validation is already in progress.");
    return tabCreationPromise;
  }

  tabCreationPromise = (async () => {
    if (chatGPTTabId) {
      try {
        const tab = await chrome.tabs.get(chatGPTTabId);
        // If tab exists and is loaded, check its readiness for interaction
        if (tab.status === 'complete') {
            console.log(`ChatGPT tab ${chatGPTTabId} exists and is loaded. Verifying readiness...`);
            chatGPTTabStatus = 'loading'; // Mark as loading while we check readiness
            // Fall through to readiness check
        } else {
            console.log(`ChatGPT tab ${chatGPTTabId} exists but not fully loaded (status: ${tab.status}). Waiting for load.`);
            chatGPTTabStatus = 'loading';
            await waitForTabLoad(chatGPTTabId);
            // Fall through to readiness check
        }
      } catch (e) {
        console.log("ChatGPT tab ID present but tab not found. Resetting.", e.message);
        chatGPTTabId = null;
        chatGPTTabStatus = "unloaded";
      }
    }

    if (!chatGPTTabId) {
      console.log("No valid ChatGPT tab ID. Querying for existing or creating new.");
      const tabs = await chrome.tabs.query({ url: "https://chat.openai.com/*" });
      const existingTab = tabs.find(t => t.id && t.url && t.url.startsWith("https://chat.openai.com"));

      if (existingTab) {
        chatGPTTabId = existingTab.id;
        console.log("Found existing ChatGPT tab:", chatGPTTabId);
        if (existingTab.status !== "complete") {
          console.log(`Existing ChatGPT tab ${chatGPTTabId} not complete. Waiting for load.`);
          chatGPTTabStatus = 'loading';
          await waitForTabLoad(chatGPTTabId);
        }
        // Fall through to readiness check
      } else {
        console.log("Creating new ChatGPT tab.");
        chatGPTTabStatus = 'loading';
        const tab = await chrome.tabs.create({ url: 'https://chat.openai.com/', active: false });
        chatGPTTabId = tab.id;
        await waitForTabLoad(chatGPTTabId);
        // Fall through to readiness check
      }
    }

    // At this point, chatGPTTabId should be set and the tab should be loaded (status 'complete').
    // Now, check if the content script is responsive and the page is ready (e.g. modals handled).
    console.log(`ChatGPT tab ${chatGPTTabId} loaded. Sending CHECK_CHATGPT_READY.`);
    chatGPTTabStatus = 'loading'; // Represents checking readiness, not page load.

    let checkAttempts = 0;
    const maxCheckAttempts = 3;

    while (checkAttempts < maxCheckAttempts) {
      checkAttempts++;
      try {
        console.log(`Attempt ${checkAttempts} to check ChatGPT readiness for tab ${chatGPTTabId}.`);
        const response = await chrome.tabs.sendMessage(chatGPTTabId, { action: "CHECK_CHATGPT_READY" });

        if (response && response.status === "ready") { // Content script confirms ready
          console.log("ChatGPT tab is ready for interaction.");
          chatGPTTabStatus = 'ready';
          return chatGPTTabId;
        } else if (response && response.status === "not_ready") {
          console.warn(`ChatGPT tab not ready (attempt ${checkAttempts}): ${response.message}. Waiting before retry...`);
          if (checkAttempts < maxCheckAttempts) await new Promise(r => setTimeout(r, 3000 + checkAttempts * 1000)); // wait longer each attempt
          else throw new Error(`ChatGPT tab not ready after ${maxCheckAttempts} attempts. Last reason: ${response.message}`);
        } else { // Includes undefined response (if content script didn't load/respond) or unexpected status
             console.warn(`Unexpected response or no response from CHECK_CHATGPT_READY (attempt ${checkAttempts}):`, response);
             if (checkAttempts < maxCheckAttempts) await new Promise(r => setTimeout(r, 3000 + checkAttempts * 1000));
             else throw new Error(`No valid response from ChatGPT content script after ${maxCheckAttempts} attempts.`);
        }
      } catch (error) { // Error sending message (e.g., tab closed, extension reloaded, content script error)
        console.error(`Error sending CHECK_CHATGPT_READY or processing its response (attempt ${checkAttempts}):`, error.message);
        if (error.message.includes("Receiving end does not exist") || error.message.includes("Could not establish connection")) {
            console.log("Content script likely not injected or tab is non-responsive. Re-injection might be needed or tab is bad.");
            // Try to reload the tab as a recovery measure on the last attempt, then re-check.
            if (checkAttempts === maxCheckAttempts -1) { // one attempt before the last one
                console.log("Trying to reload the ChatGPT tab and re-check readiness as a last resort...");
                await chrome.tabs.reload(chatGPTTabId);
                await waitForTabLoad(chatGPTTabId); // wait for reload to complete
                // The loop will then make the final attempt.
                continue;
            }
        }
        if (checkAttempts < maxCheckAttempts) await new Promise(r => setTimeout(r, 3000 + checkAttempts * 1000));
        else throw new Error(`Failed to confirm ChatGPT tab readiness after ${maxCheckAttempts} attempts. Last error: ${error.message}`);
      }
    }
    // If loop finishes without returning, it means it failed all attempts
    chatGPTTabStatus = 'error_interact';
    throw new Error(`ChatGPT tab failed readiness check after ${maxCheckAttempts} attempts.`);

  })(); // end of the main async IIFE for tabCreationPromise

  try {
    // This makes ensureChatGPTTab() itself return the promise from the IIFE
    return await tabCreationPromise;
  } catch(error) {
    // Ensure tabCreationPromise is cleared on failure to allow new attempts.
    chatGPTTabId = null; // Critical error, reset tabId
    chatGPTTabStatus = 'error_creation'; // Or more specific error
    tabCreationPromise = null;
    console.error("ensureChatGPTTab final error:", error.message);
    throw error; // Re-throw for the caller (processNextChunk) to handle
  } finally {
    // tabCreationPromise is now the promise from the IIFE,
    // so clearing it here might be too soon if multiple callers are awaiting the same promise.
    // A better pattern might be to only set it to null if it resolves or rejects.
    // Given the current single-threaded processing of chunks, this might be okay,
    // but for broader use, a more robust promise cache clearing is needed.
    // For now, let's clear it when this specific call sequence is done.
    if (await tabCreationPromise === undefined) tabCreationPromise = null;
  }
}


chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (tabId === chatGPTTabId) {
    console.log("ChatGPT tab was closed by user or system.");
    chatGPTTabId = null;
    chatGPTTabStatus = "unloaded";
    isProcessingChunk = false;
    if (currentProcessingChunk) {
        console.warn(`ChatGPT tab closed during processing of chunk ${currentProcessingChunk.chunkId}. Re-queuing.`);
        // Update status in DB to 'pending' or 'pending_retry'
        updateChunkInVideo(currentProcessingChunk.videoId, currentProcessingChunk.chunkId, {
            status: `pending (tab closed)`,
            error: "ChatGPT tab was closed during processing."
        }).catch(e => console.error("DB error on tab closed:", e));

        chunkQueue.unshift(currentProcessingChunk); // Add back to front
        currentProcessingChunk = null;
    }
  }
});


// --- Message Handling ---
/**
 * Listener for messages from other parts of the extension (content scripts, popup).
 * Handles various actions like receiving transcripts, errors, summaries, and UI commands.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "transcript_data") {
    console.log(`Received transcript data for video ID: ${message.videoId}`);
    console.log(`Transcript has ${message.transcript.length} segments.`);

    const chunks = chunkTranscript(message.transcript); // This function should ensure chunks have id, text, originalSegments, and default status 'pending'
    console.log(`Transcript chunked into ${chunks.length} chunks.`);

    const videoId = message.videoId;
    const videoData = {
      videoId: videoId,
      originalTranscript: message.transcript,
      // Ensure chunks from chunkTranscript have status, summary, error initialized
      chunks: chunks.map(chunk => ({
        ...chunk,
        status: 'pending',
        summary: null,
        error: null
      })),
      status: 'chunked', // Initial status after chunking
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (async () => {
      try {
        await saveVideoTranscript(videoData);
        console.log(`Video ${videoId} and its chunks saved to IndexedDB.`);
        sendResponse({ status: "Transcript received, chunked, and saved. Queued for summarization." });
        chrome.runtime.sendMessage({ type: "VIDEO_DATA_UPDATED", videoId: videoId, videoData: videoData });

        // Add chunks to the processing queue with retryCount initialized
        chunkQueue.push(...videoData.chunks.map(c => ({
            videoId,
            chunkId: c.id,
            text: c.text,
            originalSegments: c.originalSegments,
            retryCount: 0
        })));
        if (!isProcessingChunk) {
          processNextChunk();
        }
      } catch (error) {
        console.error(`Failed to save video ${videoId} to IndexedDB:`, error);
        sendResponse({ status: "Error saving initial data to IndexedDB." });
      }
    })();
    return true; // Async response

  } else if (message.type === "transcript_error") {
    console.error(`Error fetching transcript for video ID: ${message.videoId}: ${message.error}`);
    (async () => {
      try {
        let videoData = await getVideoTranscript(message.videoId);
        if (!videoData) {
          videoData = {
            videoId: message.videoId,
            chunks: [],
            originalTranscript: [],
            createdAt: new Date().toISOString(),
            // Ensure other required fields by VideoTranscriptData are present
            status: 'error_fetching',
            updatedAt: new Date().toISOString()
          };
        }
        videoData.status = 'error_fetching';
        videoData.fetchError = message.error;
        videoData.updatedAt = new Date().toISOString();
        await saveVideoTranscript(videoData);
        console.log(`Error state for video ${message.videoId} saved to IndexedDB.`);
        chrome.runtime.sendMessage({ type: "VIDEO_DATA_UPDATED", videoId: message.videoId, videoData: videoData });
        sendResponse({ status: "Transcript error received and saved to IndexedDB." });
      } catch (dbError) {
        console.error(`Failed to save error state for video ${message.videoId} to IndexedDB:`, dbError);
        sendResponse({ status: "Failed to save transcript error to IndexedDB." });
      }
    })();
    return true;

  } else if (message.type === "CHUNK_SUMMARIZED") { // From chatgpt_interactor.js
    console.log(`Background: Received summary for chunk ${message.chunkId} of video ${message.videoId}`);
    (async () => {
      let updatedVideoData;
      try {
        // Ensure the message corresponds to the currently processed chunk
        if (currentProcessingChunk && currentProcessingChunk.chunkId === message.chunkId && currentProcessingChunk.videoId === message.videoId) {
            updatedVideoData = await updateChunkInVideo(message.videoId, message.chunkId, {
              status: 'summarized',
              summary: message.summary,
              error: null // Clear any previous error
            });
            console.log(`Chunk ${message.chunkId} for video ${message.videoId} summarized and saved to IDB.`);
            if (updatedVideoData) {
              chrome.runtime.sendMessage({ type: "VIDEO_DATA_UPDATED", videoId: message.videoId, videoData: updatedVideoData });
            }
            currentProcessingChunk = null; // Clear current chunk
        } else {
            console.warn(`Received summary for unexpected chunk: ${message.chunkId}. Currently processing: ${currentProcessingChunk?.chunkId}`);
        }
        sendResponse({ status: "Summary noted, saved." });
      } catch (error) {
        console.error(`Failed to save summary for chunk ${message.chunkId} to IDB:`, error);
        sendResponse({ status: "Failed to save summary to IDB." });
      }
      chatGPTTabStatus = 'ready';
      isProcessingChunk = false;
      // currentProcessingChunkId = null; // Moved to currentProcessingChunk = null
      processNextChunk();
    })();
    return true;

  } else if (message.type === "CHATGPT_INTERACTION_ERROR") { // From chatgpt_interactor.js
    console.error(`Background: ChatGPT interaction error for video ${message.videoId}, chunk ${message.chunkId}:`, message.message);

    const failedChunkInfo = currentProcessingChunk;

    if (failedChunkInfo && failedChunkInfo.chunkId === message.chunkId && failedChunkInfo.videoId === message.videoId) {
        failedChunkInfo.retryCount = (failedChunkInfo.retryCount || 0) + 1;

        if (failedChunkInfo.retryCount <= MAX_RETRIES) {
            const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, failedChunkInfo.retryCount - 1);
            console.log(`Retrying chunk ${message.chunkId} (attempt ${failedChunkInfo.retryCount}/${MAX_RETRIES}) in ${delayMs / 1000}s...`);

            (async () => {
                try {
                    await updateChunkInVideo(message.videoId, message.chunkId, {
                        status: `pending_retry (attempt ${failedChunkInfo.retryCount})`,
                        error: `Interaction Error (retry ${failedChunkInfo.retryCount}): ${message.message}`
                    });
                    const videoData = await getVideoTranscript(message.videoId);
                    if (videoData) chrome.runtime.sendMessage({ type: "VIDEO_DATA_UPDATED", videoId: message.videoId, videoData: videoData });
                } catch (dbError) { console.error("DB error updating chunk for retry:", dbError); }

                isProcessingChunk = false; // Release lock BEFORE setTimeout
                currentProcessingChunk = null; // Clear current chunk
                chatGPTTabStatus = 'ready'; // Assume tab might recover or will be re-checked

                setTimeout(() => {
                    console.log(`Adding chunk ${failedChunkInfo.chunkId} back to queue for retry.`);
                    chunkQueue.unshift(failedChunkInfo); // Add to front
                    processNextChunk();
                }, delayMs);
            })();

        } else {
            console.error(`Max retries reached for chunk ${message.chunkId}. Marking as permanent error.`);
            (async () => {
                try {
                    const updatedVideoData = await updateChunkInVideo(message.videoId, message.chunkId, {
                        status: 'error',
                        error: `Max retries reached. Last error: ${message.message}`
                    });
                    if (updatedVideoData) {
                         chrome.runtime.sendMessage({ type: "VIDEO_DATA_UPDATED", videoId: message.videoId, videoData: updatedVideoData });
                    }
                } catch (dbError) { console.error("DB error marking chunk as permanent error:", dbError); }

                isProcessingChunk = false;
                currentProcessingChunk = null;
                chatGPTTabStatus = 'ready';
                processNextChunk(); // Process next chunk from queue
            })();
        }
    } else {
        console.error("Mismatch in failed chunk info, cannot process retry. Current:", currentProcessingChunk, "Message:", message);
        // This case should ideally not happen if currentProcessingChunk is managed correctly.
        // If it does, it means the error message is for a chunk that is no longer considered "current".
        // We should still try to mark the reported chunk as error in DB if possible.
        if(message.videoId && message.chunkId) {
            updateChunkInVideo(message.videoId, message.chunkId, {
                status: 'error',
                error: `Error reported for non-current chunk: ${message.message}`
            }).catch(e => console.error("DB error updating non-current chunk:", e));
        }
        isProcessingChunk = false; // Release lock
        currentProcessingChunk = null;
        chatGPTTabStatus = 'ready';
        processNextChunk();
    }
    sendResponse({ status: "CHATGPT_INTERACTION_ERROR handled by service worker with retry logic." });
    return true; // Async due to setTimeout and async DB calls
  } else if (message.type === "GET_ALL_VIDEO_DATA") {
    (async () => {
      processNextChunk();
    })();
    return true;

  } else if (message.type === "GET_ALL_VIDEO_DATA") {
    (async () => {
      try {
        const allVideos = await getAllVideoTranscripts();
        sendResponse({ status: "success", data: allVideos });
      } catch (e) {
        console.error("Error fetching all video data from IDB:", e);
        sendResponse({ status: "error", message: e.toString() });
      }
    })();
    return true; // Required for async sendResponse
  } else if (message.type === "TOGGLE_PROCESSING_PAUSE") {
    isProcessingPaused = !isProcessingPaused;
    chrome.storage.local.set({ isProcessingPaused }, () => {
        if(chrome.runtime.lastError) {
            console.error("Error saving pause state:", chrome.runtime.lastError);
        } else {
            console.log("Processing pause state saved:", isProcessingPaused);
        }
    });
    console.log("Processing pause toggled to:", isProcessingPaused);
    chrome.runtime.sendMessage({ type: "PROCESSING_PAUSE_STATE_CHANGED", isPaused: isProcessingPaused });
    sendResponse({ status: "success", isPaused: isProcessingPaused });
    if (!isProcessingPaused && !isProcessingChunk && chunkQueue.length > 0) {
      console.log("Resuming processing due to toggle, calling processNextChunk.");
      setTimeout(() => processNextChunk(), 100);
    }
    return false; // Synchronous response for the direct toggle, async for the potential processNextChunk
  } else if (message.type === "GET_PROCESSING_PAUSE_STATE") {
    sendResponse({ status: "success", isPaused: isProcessingPaused });
    return false; // Synchronous response
  } else if (message.type === "EXPORT_ALL_SUMMARIES") {
    (async () => {
      try {
        const allVideos = await getAllVideoTranscripts();
        if (!allVideos || allVideos.length === 0) {
          sendResponse({ status: "warn", message: "No video data available to export." });
          return;
        }

        let markdownContent = "# YouTube Video Summaries\n\n";
        let foundSummaries = false;

        allVideos.forEach(video => {
          const summarizedChunks = video.chunks.filter(c => c.status === 'summarized' && c.summary);
          if (summarizedChunks.length > 0) {
            foundSummaries = true;
            markdownContent += `## Video: ${video.videoId}\n\n`;
            // Could add more video metadata here if available, e.g., title if we store it

            summarizedChunks.forEach(chunk => {
              markdownContent += `### Chunk ${chunk.id} (Timestamp: ${chunk.startingTimestamp})\n`;
              markdownContent += `${chunk.summary}\n\n`;
            });
            markdownContent += "---\n\n";
          }
        });

        if (!foundSummaries) {
             sendResponse({ status: "warn", message: "No completed summaries found to export." });
             return;
        }

        const mdBlob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
        const mdUrl = URL.createObjectURL(mdBlob);

        chrome.downloads.download({
          url: mdUrl,
          filename: 'youtube_summaries_export.md',
          saveAs: true
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error("Markdown Download failed:", chrome.runtime.lastError.message);
            // Cannot sendResponse here if saveAs dialog is open, channel might be closed.
            // The initial sendResponse({ status: "success" }) is optimistic.
          } else {
            console.log("Markdown Download initiated, ID:", downloadId);
          }
          URL.revokeObjectURL(mdUrl);
        });
        sendResponse({ status: "success", message: "Export process initiated for Markdown." });

      } catch (e) {
        console.error("Error exporting summaries:", e);
        sendResponse({ status: "error", message: e.message || e.toString() });
      }
    })();
    return true; // Required for async sendResponse
  }
  return false;
});

// --- Chunk Processing Logic ---

// processChunksSequentially is effectively replaced by adding to queue in transcript_data handler
// and calling processNextChunk.

/**
 * Processes the next chunk in the `chunkQueue`.
 * - Checks if processing is paused or if another chunk is already being processed.
 * - Ensures the ChatGPT tab is ready using `ensureChatGPTTab`.
 * - Updates the chunk's status to 'processing' in IndexedDB.
 * - Sends the chunk text to `chatgpt_interactor.js` for summarization.
 * - Handles errors during this process, including re-queuing chunks for retry.
 */
async function processNextChunk() {
  if (isProcessingPaused || chatGPTTabStatus !== 'ready' || isProcessingChunk || chunkQueue.length === 0) {
    if(isProcessingPaused) console.log("Processing is paused. processNextChunk will not proceed.");
    if(chatGPTTabStatus !== 'ready' && !isProcessingPaused) console.log("ChatGPT tab not ready. processNextChunk will not proceed.");
    if(isProcessingChunk && !isProcessingPaused) console.log("Already processing a chunk.");
    if(chunkQueue.length === 0 && !isProcessingPaused) console.log("Chunk queue is empty.");
    // No need to log other conditions as they are normal flow control
    return;
  }

  // This log helps confirm that processing is attempting to start for a new chunk
  console.log("processNextChunk: Conditions met, proceeding to process a chunk.");

  isProcessingChunk = true;
  const currentTask = chunkQueue.shift(); // { videoId, chunkId, text, originalSegments }
  currentProcessingVideoId = currentTask.videoId;
  currentProcessingChunkId = currentTask.chunkId;

  console.log(`Background: Attempting to summarize chunk ${currentTask.chunkId} for video ${currentTask.videoId}`);

  try {
    // Update chunk status to 'processing' in IndexedDB
    await updateChunkInVideo(currentTask.videoId, currentTask.chunkId, { status: 'processing' }); // 'processing' or 'in-progress'
    console.log(`Chunk ${currentTask.chunkId} for video ${currentTask.videoId} status updated to 'processing' in IDB.`);

    const tabId = await ensureChatGPTTab();

    if (!tabId || chatGPTTabStatus !== 'ready') {
      console.error(`ChatGPT tab not ready (status: ${chatGPTTabStatus}). Re-queuing chunk ${currentTask.chunkId}.`);
      chunkQueue.unshift(currentTask); // Add back to the front
      isProcessingChunk = false;
      currentProcessingChunkId = null;
      chatGPTTabStatus = 'unloaded'; // Force re-evaluation
      await updateChunkInVideo(currentTask.videoId, currentTask.chunkId, { status: 'pending', error: 'ChatGPT tab not ready.' });
      setTimeout(processNextChunk, 5000); // Retry after delay
      return;
    }

    chatGPTTabStatus = 'busy';
    console.log(`Background: Sending chunk ${currentTask.chunkId} to ChatGPT tab ${tabId}.`);

    const prompt = `Please summarize the following text concisely. The text is a segment of a video transcript:\n\n"${currentTask.text}"`;

    chrome.tabs.sendMessage(tabId, {
      action: "SUMMARIZE_TEXT_IN_CHATGPT_TAB",
      text: prompt,
      chunkId: currentTask.chunkId,
      videoId: currentTask.videoId
    }, response => { // Callback for the direct response from content script's listener
      if (chrome.runtime.lastError) {
        console.error(`Error sending SUMMARIZE_TEXT_IN_CHATGPT_TAB to tab ${tabId} for chunk ${currentTask.chunkId}:`, chrome.runtime.lastError.message);
        updateChunkInVideo(currentTask.videoId, currentTask.chunkId, { status: 'error', error: `Send message error: ${chrome.runtime.lastError.message}` })
          .finally(() => {
            chatGPTTabStatus = 'ready';
            isProcessingChunk = false;
            currentProcessingChunkId = null;
            processNextChunk();
          });
      } else if (response && response.status === 'error') {
        console.error(`Content script reported error for chunk ${currentTask.chunkId} before processing:`, response.message);
        updateChunkInVideo(currentTask.videoId, currentTask.chunkId, { status: 'error', error: `Content script error: ${response.message}` })
          .finally(() => {
            chatGPTTabStatus = 'ready';
            isProcessingChunk = false;
            currentProcessingChunkId = null;
            processNextChunk();
          });
      } else if (response && response.status === 'success') {
        console.log(`Background: Message SUMMARIZE_TEXT_IN_CHATGPT_TAB acknowledged by content script for chunk ${currentTask.chunkId}. Waiting for summary...`);
        // isProcessingChunk remains true, chatGPTTabStatus remains 'busy'
        // The CHUNK_SUMMARIZED or CHATGPT_INTERACTION_ERROR handler will reset these and call processNextChunk.
      } else {
         console.warn(`Unexpected response from content script for chunk ${currentTask.chunkId}:`, response);
         updateChunkInVideo(currentTask.videoId, currentTask.chunkId, { status: 'error', error: 'Unexpected response from content script.' })
          .finally(() => {
            chatGPTTabStatus = 'ready';
            isProcessingChunk = false;
            currentProcessingChunkId = null;
            processNextChunk();
          });
      }
    });

  } catch (error) {
    console.error(`Error in processNextChunk for chunk ${currentTask.chunkId}:`, error);
    // Ensure currentProcessingChunkId and currentProcessingVideoId are valid before updating DB
    if (currentTask && currentTask.videoId && currentTask.chunkId) {
        await updateChunkInVideo(currentTask.videoId, currentTask.chunkId, { status: 'error', error: error.message || "Unknown error in background summarization process" });
    }
    chatGPTTabStatus = 'error_interact';
    isProcessingChunk = false;
    currentProcessingChunkId = null;
    processNextChunk();
  }
}

// --- Storage Helper Functions --- (REMOVED as logic moved to IndexedDB helper or inline)
// async function updateChunkInStorage(videoId, chunkId, updates) { ... }
// async function updateVideoStatus(videoId, status, errorMessage = null) { ... }

// Example of how to check storage:
// chrome.storage.local.get(null, (items) => { console.log("Current storage:", items); }); // Old way
// To interact with IndexedDB directly for debugging:
// (async () => {
//   const allData = await getAllVideoTranscripts();
//   console.log("All videos in IDB:", allData);
//   // await deleteVideoTranscript("VIDEO_ID_TO_DELETE");
// })();
// To clear all video data (use with caution):
// (async () => {
//   const allData = await getAllVideoTranscripts();
//   for (const video of allData) {
//     await deleteVideoTranscript(video.videoId);
//   }
//   console.log("All video transcripts deleted from IndexedDB.");
// })();
