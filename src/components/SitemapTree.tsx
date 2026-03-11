import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export type SitemapNode = { url: string; title: string; depth: number; parentUrl?: string; isFiltered?: boolean };

interface SitemapTreeProps {
  nodes: SitemapNode[];
  selectedUrls: Set<string>;
  onToggleSelection: (url: string) => void;
}

export function SitemapTree({ nodes, selectedUrls, onToggleSelection }: SitemapTreeProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentTransformRef = useRef<d3.ZoomTransform | null>(null);

  useEffect(() => {
    if (!svgRef.current || !wrapperRef.current) return;
    
    if (nodes.length === 0) {
      currentTransformRef.current = null;
      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      return;
    }

    // Convert flat list to hierarchy
    const nodeMap = new Map<string, any>();
    nodes.forEach(n => {
      nodeMap.set(n.url, { ...n, children: [] });
    });

    const roots: any[] = [];
    nodes.forEach(n => {
      const node = nodeMap.get(n.url);
      if (n.parentUrl && nodeMap.has(n.parentUrl)) {
        nodeMap.get(n.parentUrl).children.push(node);
      } else {
        roots.push(node);
      }
    });

    let rootData;
    if (roots.length === 1) {
      rootData = roots[0];
    } else {
      rootData = { url: 'root', title: 'Start', children: roots, depth: 0 };
    }

    const root = d3.hierarchy(rootData);
    
    // Vertical tree layout with increased spacing to prevent overlap
    const verticalTree = d3.tree()
      .nodeSize([220, 140])
      .separation((a, b) => a.parent === b.parent ? 1 : 1.2);
    
    verticalTree(root);

    // Calculate bounding box to center/pan
    let x0 = Infinity;
    let x1 = -x0;
    let y0 = Infinity;
    let y1 = -y0;
    root.each((d: any) => {
      if (d.x > x1) x1 = d.x;
      if (d.x < x0) x0 = d.x;
      if (d.y > y1) y1 = d.y;
      if (d.y < y0) y0 = d.y;
    });

    const svgWidth = Math.max(wrapperRef.current.clientWidth, x1 - x0 + 200);
    const svgHeight = Math.max(wrapperRef.current.clientHeight, y1 - y0 + 100);

    const svg = d3.select(svgRef.current)
      .attr("width", svgWidth)
      .attr("height", svgHeight);
    
    svg.selectAll("*").remove();

        // Add zoom support
        const zoom = d3.zoom()
          .scaleExtent([0.1, 3])
          .on("zoom", (event) => {
            g.attr("transform", event.transform);
            currentTransformRef.current = event.transform;
          });

        svg.call(zoom as any);

        const g = svg.append("g");

        // Initial transform to center the tree or restore previous
        if (currentTransformRef.current) {
          svg.call(zoom.transform as any, currentTransformRef.current);
          g.attr("transform", currentTransformRef.current as any);
        } else {
          const initialX = svgWidth / 2 - (x0 + x1) / 2;
          const initialY = -y0 + 60;
          const initialTransform = d3.zoomIdentity.translate(initialX, initialY).scale(0.8); // Start slightly zoomed out
          svg.call(zoom.transform as any, initialTransform);
          g.attr("transform", initialTransform as any);
          currentTransformRef.current = initialTransform;
        }

    // Links
    g.selectAll(".link")
      .data(root.links())
      .enter().append("path")
      .attr("class", "link")
      .attr("fill", "none")
      .attr("stroke", "#3a404e")
      .attr("stroke-width", 2)
      .attr("d", d3.linkVertical()
        .x((d: any) => d.x)
        .y((d: any) => d.y) as any
      );

        // Nodes
        const node = g.selectAll(".node")
          .data(root.descendants())
          .enter().append("g")
          .attr("class", "node")
          .attr("transform", (d: any) => `translate(${d.x},${d.y})`);

        // Scale group based on depth
        const getScale = (depth: number) => Math.max(0.65, 1.1 - depth * 0.15);

        const nodeGroup = node.append("g")
          .attr("transform", (d: any) => `scale(${getScale(d.depth)})`);

        // Node boxes (Neumorphism style)
        nodeGroup.append("rect")
          .attr("width", 180)
          .attr("height", 70)
          .attr("x", -90)
          .attr("y", -35)
          .attr("rx", 10)
          .attr("fill", (d: any) => d.data.isFiltered ? "#1a1c20" : "#22252A")
          .attr("stroke", (d: any) => d.data.isFiltered ? "#2e3239" : "#3a404e")
          .attr("stroke-width", 1)
          .style("filter", (d: any) => d.data.isFiltered ? "none" : "drop-shadow(4px 4px 8px #16181b) drop-shadow(-4px -4px 8px #2e3239)")
          .style("cursor", "pointer")
          .on("click", (event, d: any) => {
            if (d.data.url !== 'root') {
              onToggleSelection(d.data.url);
            }
          });

        // Colorful top bar
        const colors = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6"];
        nodeGroup.append("path")
          .attr("d", "M -90 -25 Q -90 -35 -80 -35 L 80 -35 Q 90 -35 90 -25 L 90 -18 L -90 -18 Z")
          .attr("fill", (d: any) => d.data.isFiltered ? "#3a404e" : colors[d.depth % colors.length])
          .style("pointer-events", "none");

        // Checkbox (Interactive)
        const checkbox = nodeGroup.append("g")
          .attr("class", "checkbox-group")
          .attr("transform", "translate(-80, -28)")
          .style("cursor", "pointer")
          .style("display", (d: any) => d.data.url === 'root' ? "none" : "block")
          .on("click", (event, d: any) => {
            event.stopPropagation();
            onToggleSelection(d.data.url);
          });

        checkbox.append("rect")
          .attr("class", "checkbox-bg")
          .attr("width", 12)
          .attr("height", 12)
          .attr("rx", 3)
          .attr("fill", (d: any) => d.data.isFiltered ? "#3a404e" : "#22252A")
          .attr("stroke", (d: any) => d.data.isFiltered ? "#4b5563" : "#FFFFFF")
          .attr("stroke-width", 1);

        checkbox.append("path")
          .attr("class", "checkbox-mark")
          .attr("d", "M 3 6 L 5 8 L 9 3")
          .attr("stroke", "#22252A")
          .attr("stroke-width", 2)
          .attr("fill", "none")
          .attr("opacity", 0); // Set by second useEffect

        // External Link Icon
        const extLink = nodeGroup.append("g")
          .attr("transform", "translate(68, -28)")
          .style("cursor", "pointer")
          .style("display", (d: any) => d.data.url === 'root' ? "none" : "block")
          .on("click", (event, d: any) => {
            event.stopPropagation();
            if (d.data.url && d.data.url !== 'root') {
              window.open(d.data.url, '_blank');
            }
          });

        extLink.append("rect")
          .attr("width", 14)
          .attr("height", 14)
          .attr("fill", "transparent");
          
        extLink.append("path")
          .attr("d", "M 8 3 L 11 3 L 11 6 M 11 3 L 6 8 M 4 5 L 3 5 C 2.447 5 2 5.447 2 6 L 2 11 C 2 11.553 2.447 12 3 12 L 8 12 C 8.553 12 9 11.553 9 11 L 9 10")
          .attr("stroke", "#FFFFFF")
          .attr("stroke-width", 1.5)
          .attr("fill", "none")
          .attr("opacity", 0.7);

        // Node title
        nodeGroup.append("text")
          .attr("dy", -3)
          .attr("text-anchor", "middle")
          .attr("fill", (d: any) => d.data.isFiltered ? "#6b7280" : "#FFFFFF")
          .style("font-size", "11px")
          .style("font-weight", "600")
          .style("text-decoration", (d: any) => d.data.isFiltered ? "line-through" : "none")
          .style("font-family", "Inter, sans-serif")
          .style("pointer-events", "none")
          .text((d: any) => {
            const title = d.data.title || d.data.url;
            return title.length > 22 ? title.substring(0, 19) + "..." : title;
          });

        // Node URL
        nodeGroup.append("text")
          .attr("dy", 12)
          .attr("text-anchor", "middle")
          .attr("fill", "#8E9299")
          .style("font-size", "9px")
          .style("font-family", "Inter, sans-serif")
          .style("pointer-events", "none")
          .text((d: any) => {
            if (d.data.url === 'root') return '';
            try {
                const u = new URL(d.data.url);
                let path = u.pathname;
                if (path === '/') path = u.hostname;
                return path.length > 28 ? path.substring(0, 25) + "..." : path;
            } catch {
                return d.data.url.length > 28 ? d.data.url.substring(0, 25) + "..." : d.data.url;
            }
          });
          
        // Decorative lines inside the node to mimic the image
        nodeGroup.append("rect")
          .attr("width", 150)
          .attr("height", 4)
          .attr("x", -75)
          .attr("y", 20)
          .attr("rx", 2)
          .attr("fill", "#3a404e")
          .style("pointer-events", "none");
          
        nodeGroup.append("rect")
          .attr("width", 90)
          .attr("height", 4)
          .attr("x", -75)
          .attr("y", 28)
          .attr("rx", 2)
          .attr("fill", "#3a404e")
          .style("pointer-events", "none");
          
        // Filtered Label
        nodeGroup.each(function(d: any) {
          if (d.data.isFiltered) {
            d3.select(this).append("text")
              .attr("dy", 27)
              .attr("text-anchor", "middle")
              .attr("fill", "#EF4444")
              .style("font-size", "8px")
              .style("font-weight", "800")
              .style("font-family", "Inter, sans-serif")
              .style("pointer-events", "none")
              .text("FILTRADO");
          }
        });

      }, [nodes]); // Only re-run when nodes change

      // Second useEffect: Update selection state visually without re-rendering the whole tree
      useEffect(() => {
        if (!svgRef.current) return;
        const svg = d3.select(svgRef.current);
        
        svg.selectAll(".node").each(function(d: any) {
          if (d.data.url === 'root') return;
          
          const isSelected = selectedUrls.has(d.data.url);
          const node = d3.select(this);
          
          node.select(".checkbox-bg")
            .attr("fill", isSelected ? (d.data.isFiltered ? "#00D1FF80" : "#00D1FF") : (d.data.isFiltered ? "#3a404e" : "#22252A"))
            .attr("stroke", isSelected ? "#00D1FF" : (d.data.isFiltered ? "#4b5563" : "#8E9299"));
            
          node.select(".checkbox-mark")
            .attr("opacity", isSelected ? 1 : 0);
            
          node.select("rect") // Main background border
            .attr("stroke", isSelected ? (d.data.isFiltered ? "#00D1FF80" : "#00D1FF") : (d.data.isFiltered ? "#2e3239" : "#3a404e"))
            .attr("stroke-width", isSelected ? 2 : 1);
        });
      }, [selectedUrls]);

      return (
        <div ref={wrapperRef} className="w-full h-full overflow-hidden neu-pressed rounded-2xl relative cursor-grab active:cursor-grabbing">
          <svg ref={svgRef} className="w-full h-full"></svg>
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[#8E9299] text-sm">
          Waiting for nodes...
        </div>
      )}
    </div>
  );
}
