import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer, { Browser } from "puppeteer";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString } from "pdf-lib";
import TurndownService from "turndown";
// @ts-ignore
import { gfm } from "turndown-plugin-gfm";

let browserInstance: Browser | null = null;
const getBrowser = async () => {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
  }
  return browserInstance;
};

const normalizeUrl = (urlStr: string) => {
  try {
    const u = new URL(urlStr);
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return `${u.origin}${pathname}${u.search}`;
  } catch {
    return urlStr;
  }
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.post("/api/sitemap-chunk", async (req, res) => {
    const { queue: initialQueue, visited: initialVisited, maxDepth = 1, maxPages = 10 } = req.body;

    if (!initialQueue || !Array.isArray(initialQueue)) {
      return res.status(400).json({ error: "Queue is required" });
    }

    const actualMaxPages = maxPages === 'unlimited' ? 5000 : maxPages;

    try {
      const queue = [...initialQueue];
      const visited = new Set<string>((initialVisited || []).map(normalizeUrl));
      const discovered: { url: string; title: string; depth: number; parentUrl?: string; isFiltered?: boolean }[] = [];
      const startTime = Date.now();
      const MAX_TIME_MS = 25000;
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const queued = new Set<string>([
        ...(initialVisited || []).map(normalizeUrl), 
        ...queue.map(q => normalizeUrl(q.url))
      ]);

      while (queue.length > 0) {
        if (visited.size >= actualMaxPages) break;
        if (Date.now() - startTime > MAX_TIME_MS) break;

        const currentItem = queue.shift();
        if (!currentItem) break;
        
        const { url: currentUrl, depth, parentUrl } = currentItem;
        const normalizedCurrentUrl = normalizeUrl(currentUrl);

        if (depth > maxDepth || visited.has(normalizedCurrentUrl)) {
          continue;
        }
        
        visited.add(normalizedCurrentUrl);

        let retries = 1;
        let success = false;

        while (retries >= 0 && !success) {
          try {
            if (visited.size > 1) {
              await delay(250);
            }

            const response = await axios.get(currentUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
              },
              timeout: 15000
            });
            
            success = true;
            const html = response.data;
            const $ = cheerio.load(html);
            const title = $('title').text() || currentUrl;
            
            discovered.push({ url: currentUrl, title, depth, parentUrl });

            if (depth < maxDepth) {
              const links: {url: string, text: string, isFiltered: boolean, rawText?: string}[] = [];
              const extractedLinks: {url: string, text: string, rawText: string, normalizedUrl: string}[] = [];
              
              $('a[href]').each((_, el) => {
                let href = $(el).attr('href');
                let linkText = $(el).text().toLowerCase().trim();
                let rawText = $(el).text().trim();
                if (href) {
                  try {
                    const absoluteUrl = new URL(href, currentUrl).href;
                    if (absoluteUrl.startsWith('http')) {
                      const urlWithoutHash = absoluteUrl.split('#')[0];
                      const normalizedUrl = normalizeUrl(urlWithoutHash);
                      
                      if (!extractedLinks.some(l => l.normalizedUrl === normalizedUrl)) {
                        extractedLinks.push({ url: absoluteUrl, text: linkText, rawText, normalizedUrl });
                      }
                    }
                  } catch (e) {}
                }
              });

              for (const link of extractedLinks) {
                const { normalizedUrl, text, rawText } = link;
                
                const irrelevantUrlPatterns = [
                  /\/login\/?/i, /\/signin\/?/i, /\/signup\/?/i, /\/register\/?/i, /\/auth\/?/i, /\/logout\/?/i,
                  /\/profile\/?/i, /\/account\/?/i, /\/settings\/?/i, /\/dashboard\/?/i,
                  /\/privacy/i, /\/terms/i, /\/disclaimer/i, /\/about/i, /\/contact/i, /\/faq/i,
                  /comment/i, /reply/i, /share/i, /cart/i, /checkout/i,
                  /action=edit/i, /action=history/i, /title=Talk:/i, /title=Special:/i, /redlink=1/i,
                  /\/history\/?/i, /\/historico\/?/i, /\/logs?\/?/i, /\/users?\/?/i, /\/usuarios?\/?/i,
                  /\/password\/?/i, /\/senha\/?/i, /\/forgot\/?/i, /\/esqueci\/?/i, /\/reset\/?/i, /\/recover\/?/i, /\/recuperar\/?/i
                ];
                
                const irrelevantTextPatterns = [
                  /^log in$/i, /^sign in$/i, /^sign up$/i, /^register$/i,
                  /privacy policy/i, /terms of/i, /disclaimer/i, /^about us$/i, /^contact us$/i,
                  /^comments?$/i, /^reply$/i, /^share$/i, /^cart$/i, /^checkout$/i,
                  /histórico/i, /^history$/i, /^logs?$/i, /usuários?/i, /^users?$/i,
                  /senha/i, /password/i, /esqueci/i, /forgot/i, /recuperar/i, /recover/i,
                  /criar conta/i, /create account/i, /audit/i
                ];

                const isIrrelevant = 
                  irrelevantUrlPatterns.some(pattern => pattern.test(normalizedUrl)) ||
                  irrelevantTextPatterns.some(pattern => pattern.test(text));

                links.push({ url: normalizedUrl, text: rawText || normalizedUrl, isFiltered: isIrrelevant, rawText });
              }

              for (const link of links) {
                if (!queued.has(link.url) && !visited.has(link.url)) {
                  queued.add(link.url);
                  if (link.isFiltered) {
                    discovered.push({ url: link.url, title: link.text, depth: depth + 1, parentUrl: currentUrl, isFiltered: true, rawText: link.rawText });
                    visited.add(link.url);
                  } else {
                    queue.push({ url: link.url, depth: depth + 1, parentUrl: currentUrl, rawText: link.rawText });
                  }
                }
              }
            }
          } catch (error) {
            retries--;
            if (retries === 0) {
              console.error(`Failed to crawl sitemap ${currentUrl}:`, error instanceof Error ? error.message : String(error));
            } else {
              await delay(1000);
            }
          }
        }
      }

      res.json({
        discovered,
        queue,
        visited: Array.from(visited)
      });

    } catch (error) {
      console.error("Sitemap chunk processing error:", error);
      res.status(500).json({ error: "Failed to process sitemap chunk" });
    }
  });

  app.post("/api/scrape-chunk", async (req, res) => {
    const { queue: initialQueue, visited: initialVisited, format } = req.body;

    if (!initialQueue || !Array.isArray(initialQueue)) {
      return res.status(400).json({ error: "Queue is required" });
    }

    try {
      const queue = [...initialQueue];
      const visited = new Set<string>((initialVisited || []).map(normalizeUrl));
      const pagesData: { url: string; title: string; content: string }[] = [];
      const startTime = Date.now();
      const MAX_TIME_MS = 25000;
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      while (queue.length > 0) {
        if (Date.now() - startTime > MAX_TIME_MS) break;

        const currentItem = queue.shift();
        if (!currentItem) break;
        
        const { url: currentUrl } = currentItem;
        const normalizedCurrentUrl = normalizeUrl(currentUrl);

        if (visited.has(normalizedCurrentUrl)) {
          continue;
        }
        
        visited.add(normalizedCurrentUrl);

        let retries = 1;
        let success = false;

        while (retries >= 0 && !success) {
          try {
            if (visited.size > 1) {
              await delay(250);
            }

            if (format === 'pdf') {
              const browser = await getBrowser();
              const page = await browser.newPage();
              
              // Set viewport and user agent
              await page.setViewport({ width: 1200, height: 800 });
              await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
              
              await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 15000 });
              
              const actualUrl = normalizeUrl(page.url());
              if (actualUrl !== normalizeUrl(currentUrl)) {
                if (visited.has(actualUrl)) {
                  await page.close();
                  success = true;
                  continue; // Skip this one, it's a duplicate redirect
                }
                visited.add(actualUrl);
              }

              const title = await page.title() || currentUrl;
              
              // Fix for lazy-loaded images (gray squares)
              await page.evaluate(async () => {
                // Force eager loading
                document.querySelectorAll('img').forEach(img => {
                  img.setAttribute('loading', 'eager');
                  // Sometimes images have a data-src attribute for lazy loading scripts
                  if (img.getAttribute('data-src')) {
                    img.setAttribute('src', img.getAttribute('data-src') || '');
                  }
                });
                
                // Fast scroll to trigger IntersectionObservers
                await new Promise<void>((resolve) => {
                  let totalHeight = 0;
                  const distance = 800;
                  const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= scrollHeight) {
                      clearInterval(timer);
                      window.scrollTo(0, 0);
                      resolve();
                    }
                  }, 50);
                });
                
                // Wait for images to load
                await new Promise(resolve => setTimeout(resolve, 800));
              });
              
              // Remove irrelevant elements to clean up the PDF
              await page.evaluate(() => {
                const selectorsToRemove = [
                  'nav', 'footer', 'header', 'aside', '.sidebar', '#sidebar', '.menu', '#menu',
                  '.comments', '#comments', '#disqus_thread', '.social-share', '.share-buttons',
                  '.related-posts', '.author-bio', '.cookie-banner', '#cookie-notice', '.modal',
                  '.popup', '.login-form', 'iframe', 'form', 'input[type="password"]', 
                  '[class*="login"]', '[id*="login"]', '[class*="register"]', '[id*="register"]', 
                  '[class*="auth"]', '[id*="auth"]', '[class*="history"]', '[id*="history"]', 
                  '[class*="log"]', '[id*="log"]', '[class*="audit"]', '[id*="audit"]',
                  '[class*="user-profile"]', '[id*="user-profile"]'
                ];
                selectorsToRemove.forEach(selector => {
                  try {
                    document.querySelectorAll(selector).forEach(el => el.remove());
                  } catch (e) {} // Ignore invalid selectors
                });
              });

              const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
              });
              
              await page.close();
              
              success = true;
              pagesData.push({ 
                url: currentUrl, 
                title, 
                content: Buffer.from(pdfBuffer).toString('base64') 
              });
            } else {
              // Markdown format using Puppeteer (Lightweight Mode)
              const browser = await getBrowser();
              const page = await browser.newPage();
              
              // Enable request interception to block heavy resources
              await page.setRequestInterception(true);
              page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                  req.abort();
                } else {
                  req.continue();
                }
              });

              await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
              await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 15000 });
              
              const actualUrl = normalizeUrl(page.url());
              if (actualUrl !== normalizeUrl(currentUrl)) {
                if (visited.has(actualUrl)) {
                  await page.close();
                  success = true;
                  continue; // Skip duplicate redirect
                }
                visited.add(actualUrl);
              }

              success = true;
              const html = await page.content();
              const title = await page.title() || currentUrl;
              await page.close();

              const $ = cheerio.load(html);
              
              // Semantic Cleaning
              const selectorsToRemove = [
                'script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'iframe', 'svg', 
                'form', 'button', '.sidebar', '#sidebar', '.menu', '#menu', '.comments', '#comments', 
                '#disqus_thread', '.social-share', '.share-buttons', '.related-posts', '.author-bio', 
                '.cookie-banner', '#cookie-notice', '.modal', '.popup', '.login-form',
                '[class*="login"]', '[id*="login"]', '[class*="register"]', '[id*="register"]', 
                '[class*="auth"]', '[id*="auth"]', '[class*="history"]', '[id*="history"]', 
                '[class*="log"]', '[id*="log"]', '[class*="audit"]', '[id*="audit"]',
                '[class*="user-profile"]', '[id*="user-profile"]'
              ];
              
              selectorsToRemove.forEach(selector => {
                try {
                  $(selector).remove();
                } catch (e) {}
              });
              
              // Isolate main content
              let mainContentHtml = '';
              if ($('article').length > 0) {
                mainContentHtml = $('article').html() || '';
              } else if ($('main').length > 0) {
                mainContentHtml = $('main').html() || '';
              } else if ($('[role="main"]').length > 0) {
                mainContentHtml = $('[role="main"]').html() || '';
              } else if ($('#content, .content, .wiki-content, #mw-content-text').length > 0) {
                mainContentHtml = $('#content, .content, .wiki-content, #mw-content-text').html() || '';
              }
              
              if (!mainContentHtml || mainContentHtml.trim().length < 100) {
                  mainContentHtml = $('body').html() || '';
              }

              if (mainContentHtml) {
                const turndownService = new TurndownService({ 
                  headingStyle: 'atx', 
                  codeBlockStyle: 'fenced',
                  emDelimiter: '*'
                });
                
                // Add GFM plugin for tables and strikethrough
                turndownService.use(gfm);
                
                const markdown = turndownService.turndown(mainContentHtml);
                pagesData.push({ url: currentUrl, title, content: markdown });
              }
            }
          } catch (error) {
            retries--;
            if (retries === 0) {
              console.error(`Failed to scrape ${currentUrl}:`, error instanceof Error ? error.message : String(error));
            } else {
              await delay(1000);
            }
          }
        }
      }

      res.json({
        pagesData,
        queue,
        visited: Array.from(visited)
      });

    } catch (error) {
      console.error("Scrape chunk processing error:", error);
      res.status(500).json({ error: "Failed to process scrape chunk" });
    }
  });

  app.post("/api/generate-file", async (req, res) => {
    const { pagesData, format, urlsToCrawl } = req.body;

    if (!pagesData || pagesData.length === 0) {
      return res.status(400).json({ error: "No content extracted to generate file." });
    }

    try {
      if (format === 'md') {
        let mdContent = `# Crawled Web Content\n\n**Sources:**\n${urlsToCrawl.map((u: string) => `- ${u}`).join('\n')}\n\n**Pages crawled:** ${pagesData.length}\n\n---\n\n`;
        
        for (const page of pagesData) {
          mdContent += `## ${page.title}\n\n**URL:** ${page.url}\n\n${page.content}\n\n---\n\n`;
        }
        
        res.setHeader('Content-Type', 'text/markdown');
        res.setHeader('Content-Disposition', `attachment; filename="crawled_content.md"`);
        return res.send(mdContent);
      }

      // Generate PDF by merging the individual PDFs
      const mergedPdf = await PDFDocument.create();
      
      const urlToPageIndex = new Map<string, number>();
      let currentPageIndex = 0;

      for (const page of pagesData) {
        try {
          if (page.content) {
            const normalizedPageUrl = normalizeUrl(page.url);
            urlToPageIndex.set(normalizedPageUrl, currentPageIndex);

            const pdfBytes = Buffer.from(page.content, 'base64');
            const pageDoc = await PDFDocument.load(pdfBytes);
            const copiedPages = await mergedPdf.copyPages(pageDoc, pageDoc.getPageIndices());
            copiedPages.forEach((copiedPage) => {
              mergedPdf.addPage(copiedPage);
            });
            currentPageIndex += copiedPages.length;
          }
        } catch (err) {
          console.error(`Failed to merge PDF for ${page.url}:`, err);
        }
      }

      // Rewrite internal links
      try {
        const pages = mergedPdf.getPages();
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          const annots = page.node.Annots();
          if (annots instanceof PDFArray) {
            for (let j = 0; j < annots.size(); j++) {
              const annot = annots.lookup(j, PDFDict);
              if (annot && annot.lookup(PDFName.of('Subtype')) === PDFName.of('Link')) {
                const action = annot.lookup(PDFName.of('A'), PDFDict);
                if (action && action.lookup(PDFName.of('S')) === PDFName.of('URI')) {
                  const uriObj = action.lookup(PDFName.of('URI'));
                  let uri = '';
                  if (uriObj instanceof PDFString || uriObj instanceof PDFHexString) {
                    uri = uriObj.decodeText();
                  }
                  if (uri) {
                    const normalizedUri = normalizeUrl(uri);
                    if (urlToPageIndex.has(normalizedUri)) {
                      const targetPageIndex = urlToPageIndex.get(normalizedUri)!;
                      const targetPage = pages[targetPageIndex];
                      
                      // Create GoTo action
                      const gotoAction = mergedPdf.context.obj({
                        S: 'GoTo',
                        D: [targetPage.ref, PDFName.of('XYZ'), null, null, null]
                      });
                      annot.set(PDFName.of('A'), gotoAction);
                    }
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to rewrite internal links:", err);
      }

      const finalPdfBytes = await mergedPdf.save();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="crawled_content.pdf"`);
      return res.send(Buffer.from(finalPdfBytes));

    } catch (error) {
      console.error("Error generating file:", error);
      res.status(500).json({ error: "Failed to generate file" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    // Serve index.html for all other routes to support SPA
    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = await vite.transformIndexHtml(url, `<!DOCTYPE html><html><head></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
