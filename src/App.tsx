import React, { useState } from 'react';
import { Download, AlertCircle, CheckSquare, Square, ListTree, ArrowLeft, FileText, FileCode, Loader2 } from 'lucide-react';
import { Dial } from './components/Dial';
import { SitemapTree } from './components/SitemapTree';
import { GoogleGenAI, Type } from "@google/genai";

export type SitemapNode = { url: string; title: string; depth: number; parentUrl?: string; isFiltered?: boolean };

const MAX_PAGES_MAP = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 3000, 5000];

export default function App() {
  const [step, setStep] = useState<'config' | 'sitemap' | 'scraping'>('config');
  const [urls, setUrls] = useState('https://example.com\nhttps://example.com/about');
  const [maxDepth, setMaxDepth] = useState(2);
  const [maxPagesIndex, setMaxPagesIndex] = useState(2); // Maps to 20
  const [useAIFilter, setUseAIFilter] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [progressValue, setProgressValue] = useState<number>(0);
  const [progressTotal, setProgressTotal] = useState<number>(100);
  
  const [sitemapNodes, setSitemapNodes] = useState<SitemapNode[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  const handleBuildSitemap = async () => {
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
    setError(null);
    setProgressText("Building sitemap...");
    setProgressValue(0);
    setProgressTotal(MAX_PAGES_MAP[maxPagesIndex]);
    setSitemapNodes([]);
    setSelectedUrls(new Set());
    setStep('sitemap');

    try {
      let queue = urlList.map(u => ({ url: u, depth: 0 }));
      let visited: string[] = [];
      let allDiscovered: SitemapNode[] = [];
      const actualMaxPages = MAX_PAGES_MAP[maxPagesIndex];

      while (queue.length > 0 && visited.length < actualMaxPages) {
        setProgressText(`Discovered ${visited.length} pages... finding more...`);
        setProgressValue(visited.length);

        const response = await fetch('/api/sitemap-chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queue, visited, maxDepth, maxPages: actualMaxPages, useAIFilter }),
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
          throw new Error(errorData?.error || `Server error during sitemap build: ${response.status}`);
        }

        const data = await response.json();
        
        let newDiscovered = data.discovered;
        let newQueue = data.queue;
        let newVisited = data.visited;

        if (useAIFilter && process.env.GEMINI_API_KEY && newQueue.length > 0) {
          setProgressText(`Analyzing ${newQueue.length} pending links with AI...`);
          try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const linkData = newQueue.map((n: any) => ({ url: n.url, text: n.rawText || n.url }));
            
            if (linkData.length > 0) {
              let aiFilteredUrls: string[] = [];
              const chunkSize = 100;
              
              for (let i = 0; i < linkData.length; i += chunkSize) {
                const chunk = linkData.slice(i, i + chunkSize);
                const aiResponse = await ai.models.generateContent({
                  model: "gemini-3.1-flash-lite-preview",
                  contents: `Atue como um Analista Sênior de SEO e Engenheiro de Extração de Dados Web.

Seu Objetivo: Você receberá o código-fonte (HTML/Texto) de uma página web. Sua tarefa é analisar o contexto geral, identificar o assunto principal de forma inequívoca, extrair o conteúdo de valor alinhado a esse assunto e listar apenas os links que são úteis e canônicos para a composição de um Sitemap XML de alta qualidade.

Regras de Processamento e Filtragem (Siga estritamente):

Determinação de Contexto: Avalie as tags <title>, <h1>, <h2> e o corpo de texto principal. Resuma o assunto principal da página em uma ou duas frases.

Limpeza de Ruído (Noise Reduction): Ignore sumariamente e NÃO inclua na sua análise qualquer texto ou link que pertença a:
- Áreas de login, registro, "Esqueci minha senha" ou recuperação de conta.
- Painéis de usuário, dashboards ou históricos de compras/navegação.
- Seções de comentários, fóruns não moderados ou avaliações de usuários isoladas.
- Rodapés genéricos (Termos de Uso, Políticas de Privacidade), a menos que o site seja puramente jurídico.
- Elementos de interface (UI): "Clique aqui", "Leia mais", "Adicionar ao carrinho", menus de navegação repetitivos.

Extração de Conteúdo Relevante: Separe apenas os parágrafos, artigos ou descrições técnicas que entreguem valor real sobre o "Assunto Principal" identificado no passo 1.

Filtragem de Links para Sitemap: Extraia os URLs encontrados na página e filtre-os.
MANTENHA: Links para artigos, categorias de produtos, páginas de serviços, "Sobre Nós" e conteúdos indexáveis.
DESCARTE: Links com parâmetros de sessão (?sessionid=, &user=), links de paginação profunda desnecessária, links âncora (#comentarios), links de exclusão/carrinho (/cart, /checkout, /delete) e links externos irrelevantes.

Apesar das instruções completas de análise acima (que guiam o seu raciocínio), sua SAÍDA DEVE SER EXCLUSIVAMENTE UM ARRAY JSON contendo as URLs que DEVEM SER DESCARTADAS (filtradas). Retorne um array vazio [] se todos os links forem válidos.

Links para analisar:
${JSON.stringify(chunk)}`,
                  config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    },
                    temperature: 0.1
                  }
                });
                const chunkFilteredUrls = JSON.parse(aiResponse.text || "[]");
                aiFilteredUrls = [...aiFilteredUrls, ...chunkFilteredUrls];
              }

              // Move filtered items from newQueue to newDiscovered
              const itemsToFilter = newQueue.filter((q: any) => aiFilteredUrls.includes(q.url));
              
              const filteredNodes = itemsToFilter.map((q: any) => ({
                url: q.url,
                title: q.rawText || q.url,
                depth: q.depth,
                parentUrl: q.parentUrl,
                isFiltered: true
              }));

              newDiscovered = [...newDiscovered, ...filteredNodes];
              newQueue = newQueue.filter((q: any) => !aiFilteredUrls.includes(q.url));
              newVisited = [...newVisited, ...aiFilteredUrls];
            }
          } catch (e) {
            console.error("Gemini filtering failed:", e);
          }
        }

        allDiscovered = [...allDiscovered, ...newDiscovered];
        setSitemapNodes(allDiscovered); // Update nodes in real-time
        setSelectedUrls(new Set(allDiscovered.filter(n => !n.isFiltered).map(n => n.url))); // Update selection in real-time
        queue = newQueue;
        visited = newVisited;

        if (queue.length === 0 || visited.length >= actualMaxPages) break;
      }

      if (allDiscovered.length === 0) {
        throw new Error("Could not find any pages. The site might be blocking access or require JavaScript.");
      }

      setSitemapNodes(allDiscovered);
      setSelectedUrls(new Set(allDiscovered.filter(n => !n.isFiltered).map(n => n.url)));
      setProgressValue(actualMaxPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsLoading(false);
      setProgressText(null);
    }
  };

  const handleGenerate = async (format: 'pdf' | 'md') => {
    if (selectedUrls.size === 0) {
      setError("Please select at least one page to extract.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setStep('scraping');
    setProgressValue(0);
    setProgressTotal(selectedUrls.size);

    try {
      const urlsToScrape: string[] = Array.from(selectedUrls);
      let queue = urlsToScrape.map(u => ({ url: u }));
      let visited: string[] = [];
      let allPagesData: any[] = [];

      while (queue.length > 0) {
        setProgressText(`Scraped ${visited.length} of ${urlsToScrape.length} pages...`);
        setProgressValue(visited.length);

        const response = await fetch('/api/scrape-chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queue, visited, format }),
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
          throw new Error(errorData?.error || `Server error during scraping: ${response.status}`);
        }

        const data = await response.json();
        allPagesData = [...allPagesData, ...data.pagesData];
        queue = data.queue;
        visited = data.visited;
      }
      
      setProgressValue(urlsToScrape.length);

      if (allPagesData.length === 0) throw new Error("Could not extract any content from the selected pages.");

      setProgressText(`Generating ${format.toUpperCase()}...`);

      const genResponse = await fetch('/api/generate-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pagesData: allPagesData, format, urlsToCrawl: urls.split('\n').filter(u=>u.trim()) }),
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
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const urlObj = new URL(urlsToScrape[0]);
      const domain = urlObj.hostname.replace('www.', '');
      a.download = `crawled_${domain}${urlsToScrape.length > 1 ? '_multiple' : ''}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);

      setStep('sitemap');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      setStep('sitemap');
    } finally {
      setIsLoading(false);
      setProgressText(null);
    }
  };

  const toggleSelection = (url: string) => {
    setSelectedUrls(prev => {
      const newSet = new Set(prev);
      if (newSet.has(url)) newSet.delete(url);
      else newSet.add(url);
      return newSet;
    });
  };

  const toggleAll = () => {
    const allSelectableUrls = sitemapNodes.map(n => n.url);
    const areAllSelected = allSelectableUrls.length > 0 && allSelectableUrls.every(url => selectedUrls.has(url));
    
    if (areAllSelected) {
      setSelectedUrls(new Set());
    } else {
      setSelectedUrls(new Set(allSelectableUrls));
    }
  };

    if (step === 'sitemap' || step === 'scraping') {
      return (
        <div className="min-h-screen p-4 md:p-8 flex flex-col items-center justify-center">
          <div className="neu-flat w-full max-w-[95vw] xl:max-w-7xl p-6 md:p-10 space-y-8 relative">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-2xl font-semibold flex items-center gap-3 text-white">
                <div className="neu-icon-btn w-10 h-10">
                  <ListTree className="w-5 h-5 text-[#00D1FF]" />
                </div>
                {isLoading && step === 'sitemap' ? 'Building Sitemap...' : 'Select Pages'}
              </h2>
              <button 
                onClick={() => {
                  setStep('config');
                  setSitemapNodes([]);
                }} 
                disabled={isLoading}
                className="neu-button px-4 py-2 text-sm text-[#8E9299] hover:text-white flex items-center gap-2 disabled:opacity-50"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            </div>

            {error && (
              <div className="p-4 neu-pressed flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-200">{error}</p>
              </div>
            )}

            {isLoading && progressText && (
              <div className="p-4 neu-pressed flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-[#00D1FF] animate-spin shrink-0" />
                <p className="text-sm text-[#00D1FF] font-medium">{progressText}</p>
              </div>
            )}
            
            {/* Visual Tree Canvas */}
            <div className="mb-6 h-[60vh] min-h-[400px]">
              <SitemapTree nodes={sitemapNodes} selectedUrls={selectedUrls} onToggleSelection={toggleSelection} />
            </div>

            {/* Selection List (only show when not building sitemap) */}
            {(!isLoading) && (() => {
              const allSelectableUrls = sitemapNodes.map(n => n.url);
              const areAllSelected = allSelectableUrls.length > 0 && allSelectableUrls.every(url => selectedUrls.has(url));
              
              return (
              <>
                <div className="flex items-center justify-between px-2">
                  <button 
                    onClick={toggleAll} 
                    disabled={isLoading}
                    className="flex items-center gap-3 text-sm font-medium text-[#8E9299] hover:text-white disabled:opacity-50 transition-colors"
                  >
                    {areAllSelected ? <CheckSquare className="w-5 h-5 text-[#00D1FF]" /> : <Square className="w-5 h-5" />}
                    {areAllSelected ? 'Deselect All' : 'Select All'}
                  </button>
                  <span className="text-sm text-[#8E9299]">{selectedUrls.size} of {allSelectableUrls.length} selected</span>
                </div>

                <div className="max-h-[300px] overflow-y-auto neu-pressed p-2">
                  {sitemapNodes.map((node, i) => (
                    <div 
                      key={i} 
                      className={`flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-colors ${isLoading ? 'opacity-50 pointer-events-none' : 'hover:bg-[#2e3239]/50'}`}
                      style={{ paddingLeft: `${Math.max(0.75, node.depth * 1.5 + 0.75)}rem` }}
                      onClick={() => toggleSelection(node.url)}
                    >
                      {selectedUrls.has(node.url) ? (
                        <CheckSquare className={`w-5 h-5 shrink-0 ${node.isFiltered ? 'text-[#00D1FF]/70' : 'text-[#00D1FF]'}`} />
                      ) : (
                        <Square className={`w-5 h-5 shrink-0 ${node.isFiltered ? 'text-[#3a404e] opacity-50' : 'text-[#8E9299]'}`} />
                      )}
                      <div className="min-w-0 flex-1 flex items-center justify-between pr-2">
                        <div className="min-w-0">
                          <p className={`text-sm font-medium truncate ${node.isFiltered ? 'text-[#8E9299] line-through' : 'text-white'}`}>{node.title}</p>
                          <p className="text-xs text-[#8E9299] truncate mt-0.5">{node.url}</p>
                        </div>
                        {node.isFiltered && (
                          <span className="text-[10px] uppercase tracking-wider bg-red-500/10 text-red-400 px-2 py-1 rounded-md border border-red-500/20 whitespace-nowrap ml-3">
                            Conteúdo filtrado
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col sm:flex-row gap-6 pt-4">
                  <button
                    type="button"
                    onClick={() => handleGenerate('pdf')}
                    disabled={isLoading || selectedUrls.size === 0}
                    className="neu-button flex-1 flex items-center justify-center gap-3 px-6 py-4 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-[#8E9299]" /> : <FileText className="w-5 h-5 text-[#8E9299]" />}
                    Download PDF
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => handleGenerate('md')}
                    disabled={isLoading || selectedUrls.size === 0}
                    className="neu-button flex-1 flex items-center justify-center gap-3 px-6 py-4 font-medium disabled:opacity-50 disabled:cursor-not-allowed text-[#00D1FF]"
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileCode className="w-5 h-5" />}
                    Download Markdown
                  </button>
                </div>
              </>
              );
            })()}
          </div>
        </div>
      );
    }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
      <header className="text-center mb-10 flex flex-col items-center">
        <div className="neu-icon-btn mb-6">
          <Download className="w-6 h-6 text-[#00D1FF]" />
        </div>
        <h1 className="text-3xl font-semibold text-white mb-3 tracking-tight">Web to Document</h1>
        <p className="text-sm text-[#8E9299] max-w-[400px] leading-relaxed">
          Enter a starting URL to discover links, select pages, and convert them into a single file.
        </p>
      </header>

      <main className="neu-flat w-full max-w-4xl p-8 md:p-12">
        <section className="mb-12">
          <label className="block mb-4 text-sm font-medium text-[#8E9299] uppercase tracking-wider pl-2">Starting URLs</label>
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={5}
            maxLength={5000}
            className="w-full neu-pressed p-6 resize-none text-white focus:outline-none focus:ring-1 focus:ring-[#00D1FF]/30 transition-all"
          />
          <div className="flex justify-end mt-2 pr-2">
            <span className="text-xs text-[#8E9299]">{urls.length} / 5000</span>
          </div>
        </section>

        <section className="flex flex-col md:flex-row justify-between items-stretch gap-8 mb-12">
          <div className="flex flex-col items-center justify-center">
            <Dial
              min={0}
              max={5}
              value={maxDepth}
              onChange={setMaxDepth}
              label="Depth"
            />
          </div>

          <div className="flex-1 flex items-center justify-center">
            {(() => {
              const maxPages = MAX_PAGES_MAP[maxPagesIndex];
              let depthText = "";
              if (maxDepth === 0) depthText = "Apenas as URLs exatas fornecidas serão rastreadas.";
              else if (maxDepth === 1) depthText = "Rastreia as URLs iniciais e os links encontrados diretamente nelas (1 clique).";
              else depthText = `Rastreia as URLs iniciais e segue links até ${maxDepth} cliques de profundidade.`;

              const urlCount = Math.max(1, urls.split('\n').filter(u=>u.trim()).length);
              let estPages = urlCount;
              if (maxDepth === 1) estPages = urlCount * 10;
              if (maxDepth === 2) estPages = urlCount * 50;
              if (maxDepth >= 3) estPages = urlCount * 200;
              
              const finalEstPages = Math.min(estPages, maxPages);
              const estSizeMB = (finalEstPages * 0.05).toFixed(1);

              return (
                <div className="w-full max-w-sm neu-pressed p-6 rounded-2xl text-center flex flex-col items-center justify-center gap-3 h-full">
                  <div className="text-[#00D1FF] mb-1">
                    <ListTree className="w-6 h-6" />
                  </div>
                  <p className="text-sm text-[#8E9299] leading-relaxed">
                    {depthText}
                  </p>
                  <div className="w-full h-px bg-[#3a404e] my-1"></div>
                  <div className="flex flex-col gap-1 w-full">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#8E9299]">Páginas estimadas:</span>
                      <strong className="text-white">{finalEstPages} a {maxPages}</strong>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#8E9299]">Tamanho do doc.:</span>
                      <strong className="text-white">~{estSizeMB} MB</strong>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="flex flex-col items-center justify-center">
            <Dial
              min={0}
              max={10}
              value={maxPagesIndex}
              onChange={setMaxPagesIndex}
              label="Pages"
              formatValue={(val) => {
                const mapped = MAX_PAGES_MAP[val];
                if (mapped >= 1000) return `${mapped / 1000}k`;
                return mapped;
              }}
            />
          </div>
        </section>

        <section className="mb-12 flex justify-center">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div className="relative">
              <input 
                type="checkbox" 
                className="sr-only" 
                checked={useAIFilter}
                onChange={(e) => setUseAIFilter(e.target.checked)}
              />
              <div className={`block w-14 h-8 rounded-full transition-colors ${useAIFilter ? 'bg-[#00D1FF]' : 'bg-[#1a1c20] border border-[#2e3239]'}`}></div>
              <div className={`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${useAIFilter ? 'transform translate-x-6' : ''}`}></div>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-white group-hover:text-[#00D1FF] transition-colors">Smart AI Filtering (Gemini)</span>
              <span className="text-xs text-[#8E9299]">Uses AI to intelligently filter out irrelevant utility pages (login, logs, etc.)</span>
            </div>
          </label>
        </section>

        {error && (
          <div className="mb-8 p-5 neu-pressed flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        {progressText && (
          <div className="mb-8 p-5 neu-pressed flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-[#00D1FF] animate-spin shrink-0" />
              <p className="text-sm text-[#00D1FF] font-medium">{progressText}</p>
            </div>
            <div className="w-full bg-[#1a1c20] rounded-full h-2 mt-1 overflow-hidden border border-[#2e3239]">
              <div 
                className="bg-[#00D1FF] h-full rounded-full transition-all duration-300 ease-out" 
                style={{ width: `${Math.min(100, Math.max(2, (progressValue / progressTotal) * 100))}%` }}
              ></div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleBuildSitemap}
          disabled={isLoading || !urls.trim()}
          className="neu-button w-full p-5 font-semibold text-lg flex items-center justify-center gap-3 text-[#00D1FF]"
        >
          {isLoading ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <ListTree className="w-6 h-6" />
          )}
          {isLoading ? 'Processing...' : 'Build Sitemap'}
        </button>
      </main>
    </div>
  );
}

