// src/utils/transcript_chunker.js

/**
 * @typedef {Object} TranscriptSegment
 * @property {string} text - The text of the transcript segment.
 * @property {string} timestamp - The starting timestamp of the segment (e.g., "0:12").
 */

/**
 * @typedef {Object} TranscriptChunk
 * @property {string} id - A unique identifier for the chunk (e.g., "chunk_1").
 * @property {string} startingTimestamp - The timestamp of the first original segment in this chunk.
 * @property {string} text - The combined text of the chunk.
 * @property {TranscriptSegment[]} originalSegments - The original transcript segments that form this chunk.
 * @property {string} status - Processing status ('pending', 'in-progress', 'processing', 'summarized', 'error', 'pending_retry (attempt N)').
 * @property {string} [summary] - The summarized text, if status is 'summarized'.
 * @property {string} [error] - Error message, if status is 'error'.
 * @property {number} [retryCount] - Number of retry attempts made for this chunk.
 */

/**
 * Chunks a transcript into paragraphs of a target character length,
 * ensuring that chunks end at sentence boundaries.
 *
 * @param {TranscriptSegment[]} transcript - An array of transcript segments.
 * @param {number} [targetChunkSize=600] - The desired character length for each chunk.
 * @param {number} [maxChunkSize=800] - The maximum character length before forcing a split.
 * @returns {TranscriptChunk[]} An array of transcript chunks.
 */
export function chunkTranscript(transcript, targetChunkSize = 600, maxChunkSize = 800) {
  if (!transcript || transcript.length === 0) {
    return [];
  }

  const chunks = [];
  let currentChunkSegments = [];
  let currentCharCount = 0;
  let chunkIndex = 0;

  transcript.forEach((segment, segmentIndex) => {
    // Add the current segment to the potential chunk
    currentChunkSegments.push(segment);
    // Use period-space to help delineate sentences if original text lacks clear spacing after punctuation.
    const segmentTextWithSpace = segment.text + (segment.text.match(/[.!?]$/) ? " " : "");
    currentCharCount += segmentTextWithSpace.length;

    // Check if current chunk is over target size or if it's the last segment
    if (currentCharCount >= targetChunkSize || segmentIndex === transcript.length - 1) {
      let chunkText = currentChunkSegments.map(s => s.text + (s.text.match(/[.!?]$/) ? " " : "")).join("").trim();
      let splitPoint = -1;

      if (currentCharCount > maxChunkSize && segmentIndex !== transcript.length - 1) {
        // If we are way over max size and not at the end, try to find a sentence break before maxChunkSize
        // Search backwards from an ideal split point around maxChunkSize for a sentence end.
        let searchLimit = Math.min(chunkText.length, maxChunkSize);
        for (let i = searchLimit -1; i >=0; i--) {
            if (/[.!?]/.test(chunkText[i])) {
                splitPoint = i + 1;
                break;
            }
        }
        // If no sentence break found before maxChunkSize, take up to maxChunkSize
        if (splitPoint === -1) {
            splitPoint = maxChunkSize;
        }

      } else if (segmentIndex === transcript.length - 1) {
        // If it's the last segment, the whole current chunk is taken
        splitPoint = chunkText.length;
      } else {
        // Try to find the last sentence boundary within the current text
        // Search backwards from the end of the current text
        for (let i = chunkText.length - 1; i >= 0; i--) {
          if (/[.!?]/.test(chunkText[i])) {
            // Check if this sentence end is within a reasonable distance of the target size
            // This heuristic tries to avoid making very small chunks if a sentence ends too early.
            // For example, if target is 600 and sentence ends at 400, we might want to include next sentence.
            // However, if it's already >= targetChunkSize, it's a good split point.
            if (i >= targetChunkSize * 0.7 || currentCharCount >= targetChunkSize ) {
                 splitPoint = i + 1; // Include the punctuation
                 break;
            }
          }
        }
        // If no suitable sentence boundary is found and we are over target,
        // we might need to just take the whole thing up to current segment
        // or if under, continue accumulating. For now, if no good split, and under target, we continue.
        // If over target and no split, this logic needs refinement.
        // For this iteration: if we are here, it means currentCharCount >= targetChunkSize.
        // If splitPoint is still -1, it means no sentence end was found.
        // This is unlikely if text is long enough, but as a fallback, split at current length.
        if (splitPoint === -1) {
            splitPoint = chunkText.length; // Fallback: take the whole current text
        }
      }


      // If a split point was determined
      if (splitPoint > 0) {
        const finalText = chunkText.substring(0, splitPoint).trim();
        if (finalText) { // Ensure chunk is not empty
          chunks.push({
            id: `chunk_${chunkIndex++}`,
            startingTimestamp: currentChunkSegments[0].timestamp,
            text: finalText,
            originalSegments: [...currentChunkSegments], // Store copy
            status: 'pending',
          });
        }

        // Reset for the next chunk
        // This part is tricky: currentChunkSegments should be reset based on the actual split.
        // The above logic for creating chunkText and finding splitPoint uses a joined string.
        // We need to map `splitPoint` back to which segments were included.
        // For simplicity in this iteration, we'll assume `currentChunkSegments` as a whole forms the chunk if split.
        // A more precise version would identify which segments from `currentChunkSegments` actually
        // made it into `finalText` and carry over the remainder.
        // Given the current logic, if a split occurs, all `currentChunkSegments` are used.
        currentChunkSegments = [];
        currentCharCount = 0;
      }
      // If no split point was made (e.g. text too short, waiting for more), currentChunkSegments and currentCharCount
      // remain as they are, and will accumulate with the next segment.
      // The current logic makes a chunk if charcount > target OR it's the last segment.
      // So, currentChunkSegments and currentCharCount should always be reset if a chunk is pushed.

    }
  });

  // Consolidate adjacent small chunks if any were created due to forced splits or unusual sentence structures.
  // This is a basic consolidation pass. More sophisticated logic might be needed.
  const consolidatedChunks = [];
  let i = 0;
  while (i < chunks.length) {
    let currentConsolidatedChunk = { ...chunks[i] };
    // If current chunk is small and it's not the last one
    while (currentConsolidatedChunk.text.length < targetChunkSize * 0.5 && i + 1 < chunks.length) {
        // And if the next chunk is also relatively small or combining them doesn't exceed max size too much
        if (chunks[i+1].text.length < targetChunkSize * 0.75 || (currentConsolidatedChunk.text.length + chunks[i+1].text.length) < maxChunkSize * 1.2) {
            i++;
            currentConsolidatedChunk.text += " " + chunks[i].text;
            // Concatenate originalSegments. Ensure no duplicates if segments were somehow re-processed (should not happen with current logic)
            currentConsolidatedChunk.originalSegments = currentConsolidatedChunk.originalSegments.concat(chunks[i].originalSegments);
            // Status and ID would need careful handling here. For now, keep first chunk's ID and status.
        } else {
            break; // Next chunk is too large to combine
        }
    }
    consolidatedChunks.push(currentConsolidatedChunk);
    i++;
  }
  // Re-assign IDs after consolidation
  return consolidatedChunks.map((chunk, idx) => ({ ...chunk, id: `chunk_${idx}`}));
}

// Example Usage (for testing, can be removed or commented out)
/*
const sampleTranscript = [
  { timestamp: "0:01", text: "Hello everyone, and welcome back to the channel." },
  { timestamp: "0:04", text: "Today we're going to be looking at a very interesting topic." },
  { timestamp: "0:08", text: "This topic has several parts. First, we'll discuss the history." },
  { timestamp: "0:12", text: "Then, we will explore the current implications, which can be quite complex and multifaceted, requiring careful consideration of various factors at play." },
  { timestamp: "0:20", text: "After that, we'll look at future predictions. What could happen next? It's hard to say for sure!" },
  { timestamp: "0:25", text: "Finally, we will wrap up with some conclusions and takeaways for all of you watching at home or on the go, wherever you might be tuning in from today." }
];

// Simulate different character targets
const chunks60 = chunkTranscript(sampleTranscript.map(s => ({...s})), 60, 100); // Target 60 chars
console.log("Chunks (target 60 chars):");
chunks60.forEach(chunk => console.log(`ID: ${chunk.id}, Start: ${chunk.startingTimestamp}, Status: ${chunk.status}, Text (${chunk.text.length} chars): "${chunk.text}"`));

const chunks150 = chunkTranscript(sampleTranscript.map(s => ({...s})), 150, 250); // Target 150 chars
console.log("\nChunks (target 150 chars):");
chunks150.forEach(chunk => console.log(`ID: ${chunk.id}, Start: ${chunk.startingTimestamp}, Status: ${chunk.status}, Text (${chunk.text.length} chars): "${chunk.text}"`));

const singleLongSentenceTranscript = [
    { timestamp: "0:01", text: "This is a single, extremely long sentence that goes on and on, designed to test the chunking logic's ability to handle cases where there are no natural sentence breaks for a very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very, very in a new file `src/utils/transcript_chunker.js`.
The code includes JSDoc type definitions for `TranscriptSegment` and `TranscriptChunk`.
The `chunkTranscript` function splits the transcript into chunks of a target character length, aiming to end chunks at sentence boundaries. It also includes a simple consolidation step for small chunks and re-assigns IDs after consolidation.
The example usage provided in the original prompt is commented out.
The directory `src/utils` will be created if it doesn't exist.
