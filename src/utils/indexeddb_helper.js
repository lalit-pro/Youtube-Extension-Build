// src/utils/indexeddb_helper.js

const DB_NAME = 'YouTubeSummariesDB';
const DB_VERSION = 1;
const STORE_VIDEOS = 'videos'; // Object store for video transcripts and their chunks

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
      reject('IndexedDB error: ' + event.target.error);
    };

    request.onsuccess = (event) => {
      console.log('IndexedDB opened successfully.');
      resolve(event.target.result);
    };

    request.onupgradeneeded = (event) => {
      console.log('IndexedDB upgrade needed.');
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        // Primary key is videoId.
        // We will store video metadata, the full transcript, and an array of chunks.
        const videoStore = db.createObjectStore(STORE_VIDEOS, { keyPath: 'videoId' });
        // Example index - might be useful for querying by status later, though not strictly needed now
        videoStore.createIndex('statusIndex', 'status', { unique: false });
        console.log(`Object store '${STORE_VIDEOS}' created.`);
      }
    };
  });
  return dbPromise;
}

/**
 * @typedef {import('./transcript_chunker.js').TranscriptChunk} TranscriptChunk
 */

/**
 * @typedef {Object} VideoTranscriptData
 * @property {string} videoId
 * @property {any[]} originalTranscript - The raw transcript segments.
 * @property {TranscriptChunk[]} chunks - Array of transcript chunks.
 * @property {string} status - Overall status ('fetching', 'chunked', 'summarizing', 'summarized', 'error_fetching', 'error_processing', 'summarization_complete').
 * @property {Date} createdAt - Timestamp of creation.
 * @property {Date} updatedAt - Timestamp of last update.
 * @property {string} [fetchError] - Error message if fetching transcript failed.
 */


/**
 * Saves or updates a video's transcript data, including all its chunks.
 * @param {VideoTranscriptData} videoData - The video data to save.
 * @returns {Promise<void>}
 */
export async function saveVideoTranscript(videoData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_VIDEOS, 'readwrite');
    const store = transaction.objectStore(STORE_VIDEOS);
    // Add/update timestamps
    const now = new Date().toISOString(); // Use ISO string for consistency
    videoData.updatedAt = now;
    if (!videoData.createdAt) {
        videoData.createdAt = now;
    }

    const request = store.put(videoData);
    request.onsuccess = () => resolve();
    request.onerror = (event) => {
      console.error('Error saving video transcript:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Retrieves a video's transcript data by its ID.
 * @param {string} videoId
 * @returns {Promise<VideoTranscriptData | undefined>}
 */
export async function getVideoTranscript(videoId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_VIDEOS, 'readonly');
    const store = transaction.objectStore(STORE_VIDEOS);
    const request = store.get(videoId);
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => {
      console.error('Error getting video transcript:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Updates a specific chunk within a video's transcript data.
 * Also updates the video's overall status and updatedAt timestamp.
 * @param {string} videoId
 * @param {string} chunkId
 * @param {{ status?: string, summary?: string, error?: string }} updates
 * @returns {Promise<VideoTranscriptData | undefined>}
 */
export async function updateChunkInVideo(videoId, chunkId, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_VIDEOS, 'readwrite');
    const store = transaction.objectStore(STORE_VIDEOS);
    const getRequest = store.get(videoId);

    getRequest.onsuccess = (event) => {
      const videoData = event.target.result;
      if (videoData && videoData.chunks) {
        const chunkIndex = videoData.chunks.findIndex(c => c.id === chunkId);
        if (chunkIndex !== -1) {
          // Apply updates to the specific chunk
          if (updates.status) videoData.chunks[chunkIndex].status = updates.status;
          if (updates.summary) videoData.chunks[chunkIndex].summary = updates.summary;
          // Clear error if successful summary, or set error
          videoData.chunks[chunkIndex].error = updates.error !== undefined ? updates.error : null;


          videoData.updatedAt = new Date().toISOString();

          // Determine overall video status
          const allChunksProcessed = videoData.chunks.every(c => c.status === 'summarized' || c.status === 'error');
          if (allChunksProcessed) {
            const hasAnyError = videoData.chunks.some(c => c.status === 'error');
            videoData.status = hasAnyError ? 'error_processing' : 'summarization_complete';
          } else {
            const hasAnyInProgress = videoData.chunks.some(c => c.status === 'in-progress' || c.status === 'processing'); // Added 'processing'
            if (hasAnyInProgress) {
                videoData.status = 'summarizing';
            } else {
                // If not all processed and none in progress, it might be partially summarized or still chunked
                // This status might need more nuance, but 'summarizing' is a general state.
                 const hasAnyPending = videoData.chunks.some(c => c.status === 'pending');
                 videoData.status = hasAnyPending ? 'summarizing' : 'chunked'; // If pending, still summarizing. Else, just chunked.
            }
          }

          const putRequest = store.put(videoData);
          putRequest.onsuccess = () => resolve(videoData); // Resolve with the updated videoData
          putRequest.onerror = (event) => {
            console.error('Error updating chunk in video (put):', event.target.error);
            reject(event.target.error);
          };
        } else {
          console.warn(`Chunk ID ${chunkId} not found in video ${videoId}`);
          reject(new Error(`Chunk ID ${chunkId} not found.`));
        }
      } else {
        console.warn(`Video ID ${videoId} not found for chunk update.`);
        reject(new Error(`Video ID ${videoId} not found.`));
      }
    };
    getRequest.onerror = (event) => {
      console.error('Error getting video for chunk update (get):', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Retrieves all stored video transcript data.
 * Useful for populating a UI list.
 * @returns {Promise<VideoTranscriptData[]>}
 */
export async function getAllVideoTranscripts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_VIDEOS, 'readonly');
    const store = transaction.objectStore(STORE_VIDEOS);
    const request = store.getAll();
    request.onsuccess = (event) => resolve(event.target.result || []);
    request.onerror = (event) => {
      console.error('Error getting all video transcripts:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Deletes a video's transcript data by its ID.
 * @param {string} videoId
 * @returns {Promise<void>}
 */
export async function deleteVideoTranscript(videoId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_VIDEOS, 'readwrite');
    const store = transaction.objectStore(STORE_VIDEOS);
    const request = store.delete(videoId);
    request.onsuccess = () => resolve();
    request.onerror = (event) => {
      console.error('Error deleting video transcript:', event.target.error);
      reject(event.target.error);
    };
  });
}

// Initialize DB connection when module loads
openDB().then(() => {
  console.log("Database connection pre-warmed.");
}).catch(err => console.error("Initial DB open failed during module load:", err));
