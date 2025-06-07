// src/ui/components/ChunkList.tsx
import React from 'react';
import type { TranscriptChunk } from '../../utils/transcript_chunker'; // Adjust path
import ChunkItem from './ChunkItem';

interface ChunkListProps {
  chunks: TranscriptChunk[];
  videoId: string;
}

const ChunkList: React.FC<ChunkListProps> = ({ chunks, videoId }) => {
  if (!chunks || chunks.length === 0) {
    return <p className="text-gray-500">No chunks available for this video or transcript is empty.</p>;
  }

  // Calculate progress
  const summarizedCount = chunks.filter(c => c.status === 'summarized').length;
  const errorCount = chunks.filter(c => c.status === 'error').length;
  const totalProcessed = summarizedCount + errorCount; // Chunks that are definitively done (either success or error)
  const progressPercentage = chunks.length > 0 ? (totalProcessed / chunks.length) * 100 : 0;

  return (
    <div className="mt-4">
      <h3 className="text-md font-semibold mb-2">
        Chunks for Video: {videoId}
      </h3>
      {/* Global Progress Bar for this video's chunks */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 mb-1 dark:bg-gray-700">
        <div
          className="bg-blue-600 h-2.5 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progressPercentage}%` }}
        ></div>
      </div>
      <p className="text-xs text-gray-600 mb-2">
        Progress: {totalProcessed} / {chunks.length} processed ({Math.round(progressPercentage)}%)
        {errorCount > 0 && <span className="text-red-500 ml-2">({errorCount} errors)</span>}
      </p>
      <div className="max-h-60 overflow-y-auto space-y-1 pr-1"> {/* Scrollable area for chunks */}
        {chunks.map((chunk) => (
          <ChunkItem key={chunk.id} chunk={chunk} />
        ))}
      </div>
    </div>
  );
};

export default ChunkList;
