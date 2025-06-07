// src/ui/components/ChunkItem.tsx
import React from 'react';
import type { TranscriptChunk } from '../../utils/transcript_chunker'; // Adjust path as needed

interface ChunkItemProps {
  chunk: TranscriptChunk;
}

const ChunkItem: React.FC<ChunkItemProps> = ({ chunk }) => {
  let statusColor = 'bg-gray-400';
  let statusText = chunk.status;

  switch (chunk.status) {
    case 'pending':
      statusColor = 'bg-yellow-400';
      statusText = 'Pending';
      break;
    case 'in-progress':
    case 'processing': // Handle 'processing' if used by background
      statusColor = 'bg-blue-400';
      statusText = 'In Progress';
      break;
    case 'summarized':
      statusColor = 'bg-green-500';
      statusText = 'Summarized';
      break;
    case 'error':
      statusColor = 'bg-red-500';
      statusText = 'Error';
      break;
  }

  return (
    <div className="p-3 my-2 border border-gray-300 rounded-lg shadow-sm">
      <div className="flex justify-between items-center mb-1">
        <h4 className="text-sm font-semibold text-gray-700">
          Chunk {chunk.id} (Start: {chunk.startingTimestamp})
        </h4>
        <span className={`px-2 py-0.5 text-xs font-medium text-white rounded-full ${statusColor}`}>
          {statusText}
        </span>
      </div>
      <p className="text-xs text-gray-600 mb-2 truncate" title={chunk.text}>
        Original: {chunk.text.substring(0, 100)}{chunk.text.length > 100 ? '...' : ''}
      </p>
      {chunk.status === 'summarized' && chunk.summary && (
        <div className="mt-1 p-2 bg-green-50 border border-green-200 rounded">
          <p className="text-xs text-gray-800">{chunk.summary}</p>
        </div>
      )}
      {chunk.status === 'error' && chunk.error && (
        <div className="mt-1 p-2 bg-red-50 border border-red-200 rounded">
          <p className="text-xs text-red-700">Error: {chunk.error}</p>
        </div>
      )}
    </div>
  );
};

export default ChunkItem;
