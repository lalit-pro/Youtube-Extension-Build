# YouTube Transcript Summarizer Chrome Extension

This Chrome extension automatically fetches YouTube video transcripts, chunks them, and uses ChatGPT to generate summaries.

## Features (Planned)

*   Fetches full YouTube video transcripts.
*   Chunks transcripts into optimal paragraphs.
*   Uses ChatGPT (free web interface) to summarize chunks.
*   Persists chunk state and summaries in IndexedDB.
*   React/Svelte + Tailwind CSS sidebar UI with:
    *   Scrollable list of chunks and summaries.
    *   Real-time status badges.
    *   Global progress bar.
    *   Pause/Resume functionality.
    *   Export summaries (Markdown, PDF, plain-text).
*   Mimics human behavior to interact with ChatGPT.
*   Works on Windows 7 with Node v12.22.12 and npm 6.14.16.
*   Written in TypeScript with JSDoc/TSDoc comments.

## Project Structure

*   `manifest.json`: Extension manifest file.
*   `src/`: Source code
    *   `background/`: Background scripts (service worker, ChatGPT interaction).
    *   `content_scripts/`: Scripts injected into YouTube pages.
    *   `ui/`: React/Svelte components for the sidebar.
    *   `utils/`: Utility functions.
*   `icons/`: Extension icons.
*   `dist/`: Build output directory.
*   `package.json`: Project dependencies and scripts.
*   `README.md`: This file.

## Development

(Instructions to be added once build scripts are set up)

### Prerequisites

*   Node.js v12.22.12
*   npm 6.14.16
*   Google Chrome

### Installation (Manual for now)

1.  Clone this repository.
2.  (Build steps will go here)
3.  Open Chrome and navigate to `chrome://extensions`.
4.  Enable "Developer mode".
5.  Click "Load unpacked" and select the `dist` (or root, pre-build) directory.

## Usage

(Instructions to be added)
