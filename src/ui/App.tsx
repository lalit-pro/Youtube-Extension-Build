// src/ui/App.tsx
import React, { useEffect, useState, useCallback } from 'react';
import type { VideoTranscriptData } from '../utils/indexeddb_helper'; // Adjust path if needed
import ChunkList from './components/ChunkList'; // Adjust path if needed

/**
 * Main application component for the popup UI.
 * Displays a list of processed videos and their summarization status.
 * Allows users to view chunks and their summaries for a selected video.
 * Provides controls for pausing/resuming processing and exporting summaries.
 */
const App: React.FC = () => {
  /** State for storing all video transcript data objects. */
  const [videos, setVideos] = useState<VideoTranscriptData[]>([]);
  /** State for the ID of the currently selected video for detail view. */
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  /** State to indicate if data is currently being loaded. */
  const [loading, setLoading] = useState<boolean>(true);
  /** State to store any error messages for display. */
  const [error, setError] = useState<string | null>(null);
  /** State to track if background processing is paused. */
  const [isPaused, setIsPaused] = useState<boolean>(false);

  /**
   * Fetches all video transcript data from the background script.
   * Updates the `videos` state and handles loading/error states.
   */
  const fetchAllVideoData = useCallback(() => {
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: "GET_ALL_VIDEO_DATA" }, (response) => {
        setLoading(false);
        if (chrome.runtime.lastError) {
          console.error("Error getting all video data:", chrome.runtime.lastError.message);
          setError("Error fetching data: " + chrome.runtime.lastError.message);
          return;
        }
        if (response && response.status === "success") {
          setVideos((response.data || []).sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
          setError(null); // Clear previous errors on success
        } else if (response && response.status === "error"){
          setError(response.message || "Unknown error from background getting all video data.");
        } else {
          setError("Invalid response from background script when getting all video data.");
        }
      });
    } else {
      setError("Chrome runtime not available. Run as extension.");
      setLoading(false);
      // Mock data for development outside extension environment
      /*
      setVideos([
        { videoId: 'mock1', status: 'summarized', chunks: [
          {id: 'c1', text: 'Original text 1', startingTimestamp: '0:00', status: 'summarized', summary: 'Summary 1', originalSegments:[]},
          {id: 'c2', text: 'Original text 2', startingTimestamp: '0:10', status: 'pending', originalSegments:[]},
        ], originalTranscript: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), fetchError: undefined },
        { videoId: 'mock2', status: 'error_processing', chunks: [
          {id: 'c1', text: 'Original text 3', startingTimestamp: '0:00', status: 'error', error: 'Failed to summarize', originalSegments:[]},
        ], originalTranscript: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), fetchError: undefined }
      ]);
      setLoading(false);
      */
    }
  }, []);

  /**
   * Effect hook to fetch initial data and set up message listeners for real-time updates.
   * Also fetches the initial pause state.
   */
  useEffect(() => {
    setLoading(true);
    fetchAllVideoData();

    // Fetch initial pause state
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: "GET_PROCESSING_PAUSE_STATE" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Could not get pause state:", chrome.runtime.lastError.message);
          return;
        }
        if (response && response.status === "success") {
          setIsPaused(response.isPaused);
        }
      });
    }

    const messageListener = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      console.log("App.tsx: Received message from background:", message);
      if (message.type === "VIDEO_DATA_UPDATED" && message.videoId && message.videoData) {
        console.log(`App.tsx: Received VIDEO_DATA_UPDATED for ${message.videoId}`);
        setVideos(prevVideos => {
            const existingVideoIndex = prevVideos.findIndex(video => video.videoId === message.videoId);
            let newVideos;
            if (existingVideoIndex !== -1) {
                newVideos = [...prevVideos];
                newVideos[existingVideoIndex] = message.videoData;
            } else {
                newVideos = [...prevVideos, message.videoData];
            }
            return newVideos.sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        });
        // If the updated video is the currently selected one, ensure its view is implicitly updated
      } else if (message.type === "CHUNK_UPDATE" && message.videoId && message.chunk) {
        // This provides a more granular update, but VIDEO_DATA_UPDATED is more robust if chunk updates also change video-level status
        console.log(`App.tsx: Received CHUNK_UPDATE for ${message.videoId}, chunk ${message.chunk.id}`);
        setVideos(prevVideos =>
          prevVideos.map(video =>
            video.videoId === message.videoId
              ? {
                  ...video,
                  chunks: video.chunks.map(c =>
                    c.id === message.chunk.id ? message.chunk : c
                  ),
                  status: message.videoData?.status || video.status, // Use videoData.status if available
                  updatedAt: message.videoData?.updatedAt || new Date().toISOString()
                }
              : video
          ).sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        );
      } else if (message.type === "PROCESSING_PAUSE_STATE_CHANGED") {
        console.log("App.tsx: Received PROCESSING_PAUSE_STATE_CHANGED", message.isPaused);
        setIsPaused(message.isPaused);
      }
      // Note: sendResponse is not called here as this listener is for UI updates, not direct responses to these messages.
    };

    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(messageListener);
    }

    return () => {
      if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.removeListener(messageListener);
      }
    };
  }, [fetchAllVideoData]);

  const selectedVideo = videos.find(v => v.videoId === selectedVideoId);

  if (loading) {
    return <div className="p-4 text-center text-gray-600">Loading video data...</div>;
  }

  if (error && videos.length === 0) {
    return <div className="p-4 text-red-600 bg-red-100 rounded-md text-center">Error: {error}</div>;
  }

  const togglePause = () => {
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: "TOGGLE_PROCESSING_PAUSE" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error toggling pause:", chrome.runtime.lastError.message);
          // Optionally update error state in UI
          return;
        }
        if (response && response.status === "success") {
          setIsPaused(response.isPaused);
        }
      });
    }
  };

  const selectedVideo = videos.find(v => v.videoId === selectedVideoId);

  if (loading) {
    return <div className="p-4 text-center text-gray-600">Loading video data...</div>;
  }

  if (error && videos.length === 0) { // Show error prominently if no data at all
    return <div className="p-4 text-red-600 bg-red-100 rounded-md text-center">Error: {error}</div>;
  }

  return (
    <div className="p-3 space-y-3 h-full flex flex-col bg-gray-50 text-gray-800 text-sm">
      <div className="flex justify-between items-center flex-shrink-0">
        <h1 className="text-base font-bold text-blue-700">YouTube Summaries</h1>
        <div className="flex items-center space-x-2">
          <button
            onClick={togglePause}
            className={`px-2.5 py-1 text-xs font-medium rounded-md text-white transition-colors
                        ${isPaused ? 'bg-green-500 hover:bg-green-600' : 'bg-yellow-500 hover:bg-yellow-600'}`}
          >
            {isPaused ? 'Resume All' : 'Pause All'}
          </button>
          <button
            onClick={fetchAllVideoData}
            className="p-1.5 hover:bg-gray-200 rounded"
            title="Refresh video list"
        >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m-15.357-2a8.001 8.001 0 0015.357 2M9 15h4.582" />
            </svg>
        </button>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-100 p-2 rounded-md">{error}</p>}

      {videos.length === 0 && !loading && (
        <div className="flex-grow flex flex-col items-center justify-center text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p>No videos processed yet.</p>
            <p>Open a YouTube video with a transcript to start.</p>
        </div>
      )}

      {videos.length > 0 && (
        <div className="flex-grow overflow-y-auto pr-1 border rounded-md bg-white shadow-inner">
          {/* <h2 className="text-md font-semibold text-gray-700 mb-2 p-2 border-b">Processed Videos:</h2> */}
          <ul className="divide-y divide-gray-200">
            {videos.map((video) => (
              <li
                key={video.videoId}
                className={`p-2.5 cursor-pointer hover:bg-gray-100 ${selectedVideoId === video.videoId ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                onClick={() => setSelectedVideoId(prevId => prevId === video.videoId ? null : video.videoId)}
              >
                <div className="flex justify-between items-center">
                    <h3 className="font-medium text-xs text-gray-700 truncate" title={`Video ID: ${video.videoId}`}>Video: {video.videoId}</h3>
                    <span className={`px-1.5 py-0.5 text-xs font-base text-white rounded-full ${
                        video.status === 'summarization_complete' ? 'bg-green-500' :
                        video.status === 'error_processing' || video.status === 'error_fetching' ? 'bg-red-500' :
                        video.status === 'summarizing' ? 'bg-blue-500' :
                        video.status === 'processing' ? 'bg-blue-400' : // alias for in-progress
                        video.status === 'chunked' ? 'bg-yellow-500' :
                        'bg-gray-400' // pending, etc.
                    }`}>
                        {video.status.replace(/_/g, ' ')}
                    </span>
                </div>
                <p className="text-xs text-gray-500">
                  Chunks: {video.chunks?.length || 0} | {new Date(video.updatedAt).toLocaleTimeString()}
                </p>
                 {selectedVideoId === video.videoId && selectedVideo && selectedVideo.chunks && (
                    <div className="mt-2">
                        <ChunkList chunks={selectedVideo.chunks} videoId={selectedVideo.videoId} />
                    </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto pt-2 border-t border-gray-200 flex-shrink-0">
        <button
          onClick={() => {
              if (chrome.runtime && chrome.runtime.sendMessage) {
                  chrome.runtime.sendMessage({ type: "EXPORT_ALL_SUMMARIES" }, response => {
                      if (chrome.runtime.lastError) {
                          console.error("Export error:", chrome.runtime.lastError.message);
                          alert("Error initiating export: " + chrome.runtime.lastError.message);
                          return;
                      }
                      if(response && response.status === "success"){
                          alert("Exported! (Placeholder - check console for data)");
                          console.log("Export data (simulated):", response.data);
                      } else {
                          alert("Export failed: " + (response?.message || "Unknown error"));
                      }
                  });
              } else {
                  alert("Export functionality not available outside extension.");
              }
          }}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-3 rounded text-xs"
          // disabled // Enable when functionality is ready
        >
          Export All Summaries (Not Implemented)
        </button>
      </div>
    </div>
  );
};

export default App;
