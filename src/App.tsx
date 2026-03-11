import React, { useState } from 'react';
import { Download, Globe, FileText, FileCode, Loader2, AlertCircle } from 'lucide-react';

export default function App() {
  const [urls, setUrls] = useState('');
  const [maxDepth, setMaxDepth] = useState(2);
  const [maxPages, setMaxPages] = useState<number | 'unlimited'>(5);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingFormat, setLoadingFormat] = useState<'pdf' | 'md' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);

  const handleGenerate = async (format: 'pdf' | 'md') => {
    const urlList = urls.split('\n').map(u => u.trim()).filter(u => u);
    if (urlList.length === 0) {
      setError("Please enter at least one valid URL");
      return;
    }

    for (const u of urlList) {
      try {
        new URL(u);
      } catch (e) {
        setError(`Invalid URL format: ${u}`);
        return;
      }
    }

    setIsLoading(true);
    setLoadingFormat(format);
    setError(null);
    setProgressText("Starting crawl...");

    try {
      let queue = urlList.map(u => ({ url: u, depth: 0 }));
      let visited: string[] = [];
      let allPagesData: any[] = [];
      const actualMaxPages = maxPages === 'unlimited' ? 5000 : maxPages;

      while (queue.length > 0 && visited.length < actualMaxPages) {
        setProgressText(`Crawled ${visited.length} pages... finding more...`);

        const response = await fetch('/api/crawl-chunk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ queue, visited, maxDepth, maxPages: actualMaxPages }),
        });

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
          const text = await response.text();
          if (text.includes('Starting Server') || text.includes('Please wait')) {
            throw new Error("The connection timed out or the server restarted. Please try again with a smaller batch.");
          }
          throw new Error("Received an invalid HTML response instead of JSON. The server might have restarted.");
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(errorData?.error || `Server error during crawl: ${response.status}`);
        }

        const data = await response.json();
        
        allPagesData = [...allPagesData, ...data.pagesData];
        queue = data.queue;
        visited = data.visited;

        if (queue.length === 0 || visited.length >= actualMaxPages) {
          break;
        }
      }

      if (allPagesData.length === 0) {
        throw new Error("Could not extract any content from the provided URLs.");
      }

      setProgressText(`Generating ${format.toUpperCase()} with ${allPagesData.length} pages...`);

      const genResponse = await fetch('/api/generate-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pagesData: allPagesData, format, urlsToCrawl: urlList }),
      });

      const genContentType = genResponse.headers.get('content-type');
      if (genContentType && genContentType.includes('text/html')) {
        const text = await genResponse.text();
        if (text.includes('Starting Server') || text.includes('Please wait')) {
          throw new Error("The connection timed out while generating the file. The document might be too large.");
        }
        throw new Error("Received an invalid HTML response instead of the generated file.");
      }

      if (!genResponse.ok) {
        const errorData = await genResponse.json().catch(() => null);
        throw new Error(errorData?.error || `Server error during generation: ${genResponse.status}`);
      }

      const blob = await genResponse.blob();
      
      // Create a download link and trigger it
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const urlObj = new URL(urlList[0]);
      const domain = urlObj.hostname.replace('www.', '');
      a.download = `crawled_${domain}${urlList.length > 1 ? '_multiple' : ''}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsLoading(false);
      setLoadingFormat(null);
      setProgressText(null);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
        <div className="flex items-center justify-center w-12 h-12 bg-indigo-50 rounded-xl mb-6 mx-auto">
          <Globe className="w-6 h-6 text-indigo-600" />
        </div>
        
        <h1 className="text-2xl font-semibold text-center text-neutral-900 mb-2">
          Web to PDF Crawler
        </h1>
        <p className="text-sm text-center text-neutral-500 mb-8">
          Extract content from multiple websites and their linked pages into a clean document.
        </p>

        <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
          <div>
            <label htmlFor="urls" className="block text-sm font-medium text-neutral-700 mb-1">
              Starting URLs (one per line)
            </label>
            <textarea
              id="urls"
              required
              rows={4}
              placeholder="https://example.com&#10;https://example.com/about"
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              className="w-full px-4 py-2 border border-neutral-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors font-mono text-sm resize-y"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="maxDepth" className="block text-sm font-medium text-neutral-700 mb-1">
                Link Depth
              </label>
              <select
                id="maxDepth"
                value={maxDepth}
                onChange={(e) => setMaxDepth(Number(e.target.value))}
                className="w-full px-4 py-2 border border-neutral-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors bg-white"
              >
                <option value={0}>0 (Only this page)</option>
                <option value={1}>1 (Follow direct links)</option>
                <option value={2}>2 (Follow links of links)</option>
                <option value={3}>3 (Deep crawl)</option>
              </select>
            </div>
            
            <div>
              <label htmlFor="maxPages" className="block text-sm font-medium text-neutral-700 mb-1">
                Max Pages
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  id="maxPages"
                  min={1}
                  max={100}
                  disabled={maxPages === 'unlimited'}
                  value={maxPages === 'unlimited' ? '' : maxPages}
                  onChange={(e) => setMaxPages(Number(e.target.value))}
                  className="w-full px-4 py-2 border border-neutral-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors disabled:bg-neutral-100 disabled:text-neutral-400"
                />
                <label className="flex items-center gap-2 text-sm text-neutral-600 whitespace-nowrap cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={maxPages === 'unlimited'}
                    onChange={(e) => setMaxPages(e.target.checked ? 'unlimited' : 5)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  Unlimited
                </label>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {progressText && (
            <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-indigo-600 animate-spin shrink-0" />
              <p className="text-sm text-indigo-700 font-medium">{progressText}</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => handleGenerate('pdf')}
              disabled={isLoading || !urls.trim()}
              className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-4 rounded-xl font-medium transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading && loadingFormat === 'pdf' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileText className="w-5 h-5" />
                  Generate PDF
                </>
              )}
            </button>
            
            <button
              type="button"
              onClick={() => handleGenerate('md')}
              disabled={isLoading || !urls.trim()}
              className="flex-1 flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-900 text-white py-3 px-4 rounded-xl font-medium transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading && loadingFormat === 'md' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileCode className="w-5 h-5" />
                  Generate MD
                </>
              )}
            </button>
          </div>
        </form>
        
        <div className="mt-6 pt-6 border-t border-neutral-100 text-xs text-center text-neutral-400">
          Note: Crawling many pages may take a minute. Some websites may block automated access.
        </div>
      </div>
    </div>
  );
}
