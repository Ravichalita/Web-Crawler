import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as cheerio from "cheerio";
import PDFDocument from "pdfkit";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.post("/api/crawl-chunk", async (req, res) => {
    const { queue: initialQueue, visited: initialVisited, maxDepth = 1, maxPages = 10 } = req.body;

    if (!initialQueue || !Array.isArray(initialQueue)) {
      return res.status(400).json({ error: "Queue is required" });
    }

    const actualMaxPages = maxPages === 'unlimited' ? 5000 : maxPages;

    try {
      const queue = [...initialQueue];
      const visited = new Set<string>(initialVisited || []);
      const pagesData: { url: string; title: string; content: string }[] = [];
      const startTime = Date.now();
      const MAX_TIME_MS = 25000; // 25 seconds per chunk to leave room for a long request
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const queued = new Set<string>([...(initialVisited || []), ...queue.map(q => q.url)]);

      while (queue.length > 0) {
        if (visited.size >= actualMaxPages) break;
        if (Date.now() - startTime > MAX_TIME_MS) break;

        const currentItem = queue.shift();
        if (!currentItem) break;
        
        const { url: currentUrl, depth } = currentItem;

        if (depth > maxDepth || visited.has(currentUrl)) {
          continue;
        }
        
        visited.add(currentUrl);

        let retries = 1; // Only 1 retry to save time
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
              timeout: 15000 // 15 seconds max per request
            });
            
            success = true;
            const html = response.data;
            const $ = cheerio.load(html);
            const title = $('title').text() || currentUrl;
            
            $('script, style, nav, footer, header, aside, noscript, iframe, .sidebar, #sidebar, .menu, #menu').remove();
            
            let mainContent = $('main, article, #content, .content, .wiki-content, #mw-content-text').text();
            if (!mainContent || mainContent.trim().length < 100) {
                mainContent = $('body').text();
            }

            const content = mainContent.replace(/\s+/g, ' ').trim();
            
            if (content) {
              pagesData.push({ url: currentUrl, title, content });
            }

            if (depth < maxDepth) {
              const links: string[] = [];
              $('a[href]').each((_, el) => {
                let href = $(el).attr('href');
                if (href) {
                  try {
                    const absoluteUrl = new URL(href, currentUrl).href;
                    if (absoluteUrl.startsWith('http')) {
                      const urlWithoutHash = absoluteUrl.split('#')[0];
                      const isInvalidWikiLink = 
                        urlWithoutHash.includes('action=edit') || 
                        urlWithoutHash.includes('action=history') ||
                        urlWithoutHash.includes('title=Talk:') ||
                        urlWithoutHash.includes('title=Special:') ||
                        urlWithoutHash.includes('redlink=1');

                      if (!links.includes(urlWithoutHash) && !isInvalidWikiLink) {
                          links.push(urlWithoutHash);
                      }
                    }
                  } catch (e) {}
                }
              });

              for (const link of links) {
                if (!queued.has(link) && !visited.has(link)) {
                  queued.add(link);
                  queue.push({ url: link, depth: depth + 1 });
                }
              }
            }
          } catch (error) {
            retries--;
            if (retries === 0) {
              console.error(`Failed to crawl ${currentUrl}:`, error instanceof Error ? error.message : String(error));
            } else {
              console.warn(`Retrying ${currentUrl} due to error:`, error instanceof Error ? error.message : String(error));
              await delay(1000); // Wait 1s before retry
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
      console.error("Chunk processing error:", error);
      res.status(500).json({ error: "Failed to process chunk" });
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

      // Generate PDF
      const doc = new PDFDocument({ margin: 50 });
      
      doc.on('error', (err) => {
        console.error('PDF generation error:', err);
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="crawled_content.pdf"`);
      
      doc.pipe(res);

      doc.fontSize(24).text('Crawled Web Content', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Sources:`, { align: 'center' });
      urlsToCrawl.slice(0, 3).forEach((u: string) => {
        doc.fontSize(10).fillColor('blue').text(u, { align: 'center', link: u });
      });
      if (urlsToCrawl.length > 3) {
        doc.fillColor('black').fontSize(10).text(`...and ${urlsToCrawl.length - 3} more`, { align: 'center' });
      }
      doc.fillColor('black').fontSize(12).moveDown();
      doc.text(`Pages crawled: ${pagesData.length}`, { align: 'center' });
      doc.moveDown(2);

      const sanitizeText = (str: string) => str.replace(/[^\x00-\xFF]/g, ' ');

      for (let i = 0; i < pagesData.length; i++) {
        const page = pagesData[i];
        if (i > 0) doc.addPage();
        
        try {
          doc.fontSize(18).fillColor('black').text(sanitizeText(page.title), { underline: true });
          doc.moveDown(0.5);
          doc.fontSize(10).fillColor('blue').text(page.url, { link: page.url });
          doc.moveDown();
          
          doc.fillColor('black').fontSize(12);
          
          const maxContentLength = 5000;
          let textContent = page.content;
          if (textContent.length > maxContentLength) {
            textContent = textContent.substring(0, maxContentLength) + '... (content truncated)';
          }
          
          doc.text(sanitizeText(textContent), { align: 'justify' });
        } catch (err) {
          console.error(`Failed to add page ${page.url} to PDF:`, err);
          doc.fillColor('red').fontSize(12).text('Error rendering content for this page due to unsupported characters.');
        }
      }

      doc.end();

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
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
