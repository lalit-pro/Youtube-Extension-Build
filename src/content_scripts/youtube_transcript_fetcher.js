// src/content_scripts/youtube_transcript_fetcher.js
console.log("YouTube Transcript Fetcher content script loaded.");

/**
 * Observes the DOM for the transcript button and clicks it to reveal the transcript.
 * Then, it extracts the transcript text.
 *
 * This is a common approach, but YouTube's DOM can change.
 */
function getTranscriptFromDOM() {
  return new Promise((resolve, reject) => {
    // Selector for the "Show transcript" button. This might need updating.
    const transcriptButtonSelector =
      'ytd-engagement-panel-title-header-renderer button[aria-label="Show transcript"], button[aria-label="Transcript"]'; // Common selectors

    // Selector for the transcript segments container. This might also need updating.
    const transcriptContainerSelector = 'ytd-transcript-segment-list-renderer, ytd-transcript-body-renderer';
    const transcriptSegmentSelector = 'ytd-transcript-segment-renderer, .ytd-transcript-body-renderer .cue'; // Segment or cue element

    let attempts = 0;
    const maxAttempts = 20; // Try for 10 seconds (20 * 500ms)

    const intervalId = setInterval(() => {
      attempts++;
      const transcriptButton = document.querySelector(transcriptButtonSelector);

      if (transcriptButton) {
        console.log("Transcript button found. Clicking...");
        transcriptButton.click();

        // Wait for transcript panel to load
        setTimeout(() => {
          const transcriptContainer = document.querySelector(transcriptContainerSelector);
          if (transcriptContainer) {
            console.log("Transcript container found.");
            const segments = transcriptContainer.querySelectorAll(transcriptSegmentSelector);
            let fullTranscript = [];

            segments.forEach(segment => {
              // Try to get timestamp and text. Selectors might vary.
              const timestampEl = segment.querySelector('.ytd-transcript-segment-renderer-timestamp');
              const textEl = segment.querySelector('.ytd-transcript-segment-renderer-text, .cue-group .cue'); // Text can be in different places

              if (textEl) {
                const time = timestampEl ? timestampEl.textContent.trim() : "0:00";
                const text = textEl.textContent.trim().replace(/\n/g, ' ');
                if (text) {
                  fullTranscript.push({ timestamp: time, text: text });
                }
              }
            });

            if (fullTranscript.length > 0) {
              console.log(`Extracted ${fullTranscript.length} transcript segments.`);
              clearInterval(intervalId);
              resolve(fullTranscript);
            } else {
              console.warn("Transcript segments found, but no text could be extracted.");
              // Potentially try another method or wait longer if segments appear empty initially
            }
          } else if (attempts >= maxAttempts) {
            clearInterval(intervalId);
            console.error("Transcript container not found after clicking button.");
            reject("Transcript container not found.");
          } else {
            console.log("Transcript container not yet available, retrying...");
          }
        }, 1000); // Wait 1s for panel to open
      } else if (attempts >= maxAttempts) {
        clearInterval(intervalId);
        console.error("Transcript button not found.");
        reject("Transcript button not found. This video might not have a transcript, or the selectors are outdated.");
      } else {
          console.log("Transcript button not yet available, retrying...");
      }
    }, 500); // Check every 500ms
  });
}

/**
 * Attempts to extract transcript data directly from the YouTube player response
 * often found in a script tag within the HTML.
 */
async function getTranscriptFromPlayerData() {
  try {
    // YouTube often stores player data in a global variable or inline JSON.
    // This is highly susceptible to change.
    const playerResponse = window.ytInitialPlayerResponse;

    if (playerResponse && playerResponse.captions && playerResponse.captions.playerCaptionsTracklistRenderer) {
      const tracklist = playerResponse.captions.playerCaptionsTracklistRenderer;
      const captionTracks = tracklist.captionTracks;

      if (captionTracks && captionTracks.length > 0) {
        // Prefer user-uploaded tracks, then auto-generated ones.
        // Look for English tracks first.
        let chosenTrack = captionTracks.find(track => track.languageCode === 'en' && !track.kind); // Manual English
        if (!chosenTrack) {
          chosenTrack = captionTracks.find(track => track.languageCode === 'en'); // Any English
        }
        if (!chosenTrack) {
          chosenTrack = captionTracks[0]; // Fallback to the first available track
        }

        if (chosenTrack && chosenTrack.baseUrl) {
          console.log(`Found transcript track: ${chosenTrack.name.simpleText} (${chosenTrack.languageCode})`);
          const response = await fetch(chosenTrack.baseUrl + '&fmt=json3'); // json3 is a common format
          if (!response.ok) {
            throw new Error(`Failed to fetch transcript data: ${response.statusText}`);
          }
          const transcriptData = await response.json();

          if (transcriptData && transcriptData.events) {
            const fullTranscript = transcriptData.events
              .filter(event => event.segs && event.segs.some(seg => seg.utf8 && seg.utf8.trim()))
              .map(event => {
                const text = event.segs.map(seg => seg.utf8).join('').trim().replace(/\n/g, ' ');
                const tStartMs = event.tStartMs;
                const minutes = Math.floor(tStartMs / 60000);
                const seconds = Math.floor((tStartMs % 60000) / 1000);
                const timestamp = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
                return { timestamp, text };
              });

            if (fullTranscript.length > 0) {
              console.log(`Extracted ${fullTranscript.length} transcript segments from player data.`);
              return fullTranscript;
            }
          }
        }
      }
    }
    console.log("Transcript data not found in ytInitialPlayerResponse or no suitable tracks.");
    return null; // Indicate that this method didn't find the transcript
  } catch (error) {
    console.error("Error fetching transcript from player data:", error);
    return null; // Indicate failure
  }
}


// Main execution
async function fetchAndSendTranscript() {
  console.log("Attempting to fetch transcript...");
  let transcript = null;

  // Try fetching from player data first (less intrusive)
  try {
    transcript = await getTranscriptFromPlayerData();
  } catch (error) {
    console.warn("Failed to get transcript from player data:", error.message);
  }

  // If player data method fails or returns no transcript, try DOM method
  if (!transcript || transcript.length === 0) {
    console.log("Player data method failed or yielded no transcript. Trying DOM method...");
    try {
      transcript = await getTranscriptFromDOM();
    } catch (error) {
      console.error("DOM method for transcript fetching failed:", error.message);
      // Notify background script of failure
      chrome.runtime.sendMessage({ type: "transcript_error", videoId: getVideoId(), error: error.message });
      return;
    }
  }

  if (transcript && transcript.length > 0) {
    console.log("Successfully fetched transcript. Sending to background script.");
    chrome.runtime.sendMessage({
      type: "transcript_data",
      videoId: getVideoId(),
      transcript: transcript,
    });
  } else {
    console.error("Could not retrieve transcript using any method.");
    chrome.runtime.sendMessage({ type: "transcript_error", videoId: getVideoId(), error: "Transcript not available or extraction failed." });
  }
}

function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Ensure the page is fully loaded before trying to fetch the transcript.
// YouTube pages can be dynamic, so a simple 'load' event might not be enough.
// We'll use a MutationObserver or a more robust method if needed,
// but for now, let's try after a short delay or on 'yt-navigate-finish'.

if (document.readyState === "complete" || document.readyState === "interactive") {
    // Delay slightly to allow YouTube's SPA framework to fully render the page
    setTimeout(fetchAndSendTranscript, 2000);
} else {
    window.addEventListener("load", () => {
        setTimeout(fetchAndSendTranscript, 2000);
    }, { once: true });
}

// YouTube uses SPAs, so navigation might not trigger a full page load.
// Listen for 'yt-navigate-finish' which signifies a page transition in YouTube.
// This event is specific to YouTube's Polymer framework.
document.body.addEventListener('yt-navigate-finish', (event) => {
  // Check if the new page is a watch page
  if (window.location.pathname === '/watch') {
    console.log("YouTube navigation to a new video page detected (yt-navigate-finish). Refetching transcript.");
    // Add a delay because the page content might not be ready immediately
    setTimeout(fetchAndSendTranscript, 2000);
  }
});

// Listen for messages from the popup or background, e.g., to retry fetching
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "RETRY_TRANSCRIPT_FETCH") {
    console.log("Received request to retry transcript fetching.");
    fetchAndSendTranscript();
    sendResponse({status: "ok"});
  }
  return true; // Keep message channel open for async response if needed
});
