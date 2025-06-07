# YouTube Transcript Summarizer Chrome Extension

This Chrome extension automatically fetches YouTube video transcripts, chunks them, and uses the free ChatGPT web interface to generate summaries for each chunk. It provides a UI to view progress, manage processing, and export summaries.

**Note:** This extension relies on the structure of the YouTube and ChatGPT websites. Significant changes to these websites may break the extension's functionality, requiring updates to the selectors and interaction logic in the content scripts.

## Features

*   **Automatic Transcript Fetching:** Retrieves full transcripts (auto-generated or user-uploaded) from YouTube video pages.
*   **Smart Chunking:** Splits transcripts into optimal paragraphs (approx. 500-700 characters), respecting sentence boundaries.
*   **ChatGPT Integration:** Uses the free ChatGPT web interface (`https://chat.openai.com`) in a background tab to summarize each chunk.
    *   Includes human-like interaction patterns (delays) to minimize detection.
    *   Handles initial ChatGPT modals and disclaimers.
    *   Implements retry logic with exponential backoff for failed summarization attempts.
*   **Persistent Storage:** Saves transcript data, chunk status (`pending`, `processing`, `summarized`, `error`), and summaries in IndexedDB, allowing processing to resume across browser restarts.
*   **React & Tailwind CSS UI:** A popup interface displays:
    *   A list of all processed videos and their overall status.
    *   A detailed view for each video showing a scrollable list of its chunks.
    *   Real-time status badges and generated summaries (or errors) for each chunk.
    *   A global progress bar for chunk processing per video.
    *   "Pause/Resume All Processing" button.
    *   "Export All Summaries" button (exports to Markdown).
*   **Compatibility:** Designed for Manifest V3, aiming for compatibility with modern Chrome versions.
*   **Environment:** Built to work with Node.js v12.22.12 and npm 6.14.16.

## Prerequisites

*   **Node.js:** Version 12.22.12
*   **npm:** Version 6.14.16
*   **Google Chrome:** A recent version that supports Manifest V3 extensions.

## Installation and Building

1.  **Clone the Repository:**
    ```bash
    git clone <repository-url>
    cd youtube-transcript-summarizer
    ```

2.  **Install Dependencies:**
    Using the specified npm version:
    ```bash
    npm install
    ```
    (This will install `npm-run-all` and other devDependencies from `package.json`.)

3.  **Build the Extension:**
    ```bash
    npm run build:all
    ```
    This command will:
    * Create the `dist` directory if it doesn't exist.
    * Compile the React/TypeScript UI into `dist/ui/`.
    * Bundle the service worker and content scripts into `dist/src/`.
    * Copy `manifest.json`, `icons/`, and `offscreen/` files to `dist/`.

4.  **Load the Unpacked Extension in Chrome:**
    *   Open Google Chrome and navigate to `chrome://extensions`.
    *   Enable "Developer mode" using the toggle switch (usually in the top right corner).
    *   Click the "Load unpacked" button.
    *   Select the `dist` directory from this project.
    *   The extension icon should appear in your Chrome toolbar.

## Usage

1.  **Pin the Extension (Recommended):** Click the puzzle piece icon in Chrome's toolbar and pin the "YouTube Transcript Summarizer" for easy access.
2.  **Log in to ChatGPT:** Before first use, or if you get logged out, open a regular tab and navigate to `https://chat.openai.com`. Log in to your account. The extension interacts with this website and relies on an active session.
3.  **Navigate to a YouTube Video:** Go to any YouTube video page that has a transcript available (most videos do).
4.  **Automatic Processing:** The extension should automatically detect the video and start fetching the transcript. The process will continue in the background.
5.  **Open the Popup UI:** Click the extension's icon in the toolbar to open the popup.
    *   **Video List:** You'll see a list of videos the extension has started processing. The status (`chunked`, `summarizing`, `summarization_complete`, `error`) will update in (near) real-time.
    *   **View Chunks:** Click on a video in the list to see its individual chunks, their statuses, and summaries as they appear. A progress bar shows the summarization progress for that video.
    *   **Pause/Resume:** Use the "Pause All" / "Resume All" button at the top of the popup to temporarily halt or restart the sending of chunks to ChatGPT. The pause state is persistent.
    *   **Export Summaries:** Once summaries are generated, click the "Export All Summaries (MD)" button to download a Markdown file containing all successful summaries. You will be prompted for a save location.
6.  **Background Tab:** The extension will manage a tab (usually inactive) for `https://chat.openai.com/` to perform summarizations. You can usually ignore this tab. If it's accidentally closed while processing, the extension will attempt to reopen it and resume.

## Project Structure

*   `manifest.json`: The core configuration file for the Chrome extension (source version, paths are adjusted for `dist` during copy).
*   `package.json`: Defines project scripts, dependencies, and metadata.
*   `tsconfig.json`: TypeScript compiler configuration.
*   `tailwind.config.js`, `postcss.config.js`: Configuration for Tailwind CSS.
*   `src/`: Contains all the source code.
    *   `background/service_worker.js`: Handles core background logic, transcript processing, ChatGPT communication orchestration, and IndexedDB interactions.
    *   `content_scripts/`:
        *   `youtube_transcript_fetcher.js`: Injected into YouTube pages to get transcripts.
        *   `chatgpt_interactor.js`: Injected into the ChatGPT tab to automate UI interactions.
    *   `ui/`: Contains the React components and assets for the extension's popup.
        *   `App.tsx`: Main UI component.
        *   `popup.html`, `popup.tsx`, `popup.css`: Entry points for the UI.
        *   `components/`: Reusable React components (`ChunkItem.tsx`, `ChunkList.tsx`).
    *   `utils/`: Utility modules.
        *   `transcript_chunker.js`: Logic for splitting transcripts.
        *   `indexeddb_helper.js`: Wrapper for IndexedDB operations.
    *   `offscreen/`: Contains `offscreen.html` and `offscreen.js`, currently unused but kept for potential future background DOM tasks. Copied to `dist/offscreen/`.
*   `icons/`: Extension icons in various sizes. Copied to `dist/icons/`.
*   `dist/`: The build output directory. This is the folder you load as an unpacked extension. All paths in `dist/manifest.json` are relative to the `dist` directory itself.

## Troubleshooting & Known Limitations

*   **ChatGPT UI Changes:** The most common point of failure will be changes to the ChatGPT website's HTML structure, which can break the selectors used by `chatgpt_interactor.js`. This may require updating the script.
*   **ChatGPT Login/State:** Ensure you are logged into ChatGPT in your browser. The extension relies on your existing session. If you see repeated errors, try manually visiting `chat.openai.com`, completing any captchas or new terms, and ensuring it's working normally.
*   **Rate Limiting:** While the extension tries to be respectful with delays, aggressive use might still trigger rate limiting by ChatGPT. The retry mechanism aims to handle temporary blocks.
*   **PDF Export:** Not yet implemented. Current export is Markdown.
*   **Node/npm versions:** While developed with Node v12.22.12 and npm 6.14.16 in mind for dependency compatibility, newer stable versions of Node/npm are generally recommended for development if compatibility allows. The chosen dependencies (Parcel 1, Tailwind 2) are older but were selected for this constraint.
*   **Single Active Summarization:** The extension processes one chunk at a time for summarization to manage the ChatGPT tab interaction.

## Development

1.  Follow the **Installation and Building** steps 1 & 2.
2.  **UI Development (Live Reloading):**
    ```bash
    npm run dev
    ```
    This starts Parcel's development server for the UI (`src/ui/popup.html`). Changes to React components will auto-reload the popup if it's open (or on next open).
3.  **Background & Content Script Development (Auto-Rebuild):**
    ```bash
    npm run watch:js
    ```
    This command uses `npm-run-all` to watch the service worker and content script entry points. When changes are detected, Parcel will rebuild the respective file(s) in `dist/src/`.
    **Important:** After these files are rebuilt, you need to manually reload the extension in `chrome://extensions` for the changes to take effect in the background context or for content scripts to be re-injected on matching pages.
4.  **Full Build:**
    ```bash
    npm run build:all
    ```
    This performs a production build of all parts of the extension.
5.  **Loading in Chrome:** After any build (`build:all` or after `watch:js` has output files), go to `chrome://extensions`, ensure your extension is enabled, and click its "Reload" button (the circular arrow icon). If you made changes to content scripts, also refresh the YouTube/ChatGPT pages they run on.

(This README provides a comprehensive overview. Further details on specific functions or advanced debugging could be added if necessary.)
```
